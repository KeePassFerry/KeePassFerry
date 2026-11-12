using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using KeePassLib;
using KeePassLib.Keys;
using KeePassLib.Security;
using KeePassLib.Serialization;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Passkeys: Registrierungsdaten unabhängig dekodiert (eigener CBOR-Leser), Anmeldesignatur unabhängig geprüft,
    /// Bindung an die RP-ID, Speichern und Laden des Schlüssels in einer Wegwerf-Datenbank
    /// </summary>
    [TestClass]
    public class PasskeyCryptoTests
    {
        private sealed class Registration
        {
            public byte[] CredentialId;
            public byte[] RawPub;
            public string PrivateKeyPem;
            public byte[] AuthData;
            public byte[] AttestationObject;
            public byte[] Spki;
        }

        // Wie FerryService.PasskeyCreate (ohne Datenbank)
        private static Registration Create(string rpId)
        {
            var r = new Registration { CredentialId = TestFerryClient.Random(32) };
            using (CngKey key = CngKey.Create(CngAlgorithm.ECDsaP256, null,
                       new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport }))
            {
                r.PrivateKeyPem = PasskeyCrypto.ToPem(key.Export(CngKeyBlobFormat.Pkcs8PrivateBlob));
                r.RawPub = FerryCrypto.RawFromCngPublicBlob(key.Export(CngKeyBlobFormat.EccPublicBlob));
            }
            r.AuthData = PasskeyCrypto.BuildAuthData(rpId, 0x5D, r.CredentialId, PasskeyCrypto.CoseKeyEs256(r.RawPub));
            r.AttestationObject = PasskeyCrypto.AttestationObjectNone(r.AuthData);
            r.Spki = PasskeyCrypto.SpkiP256(r.RawPub);
            return r;
        }

        private static byte[] Sha256(byte[] data)
        {
            using (var sha = SHA256.Create()) return sha.ComputeHash(data);
        }

        // ---------- minimaler CBOR-Leser (nur was WebAuthn hier braucht) ----------

        private sealed class Cbor
        {
            private readonly byte[] _b;
            public int Pos;
            public Cbor(byte[] b, int pos = 0) { _b = b; Pos = pos; }

            private long Arg(int info)
            {
                if (info < 24) return info;
                if (info == 24) return _b[Pos++];
                if (info == 25) { long v = (_b[Pos] << 8) | _b[Pos + 1]; Pos += 2; return v; }
                throw new InvalidDataException("Unsupported CBOR length " + info);
            }

            public object Read()
            {
                byte head = _b[Pos++];
                int major = head >> 5;
                long arg = Arg(head & 0x1F);
                switch (major)
                {
                    case 0: return arg;
                    case 1: return -1 - arg;
                    case 2: { var v = new byte[arg]; Buffer.BlockCopy(_b, Pos, v, 0, (int)arg); Pos += (int)arg; return v; }
                    case 3: { string s = Encoding.UTF8.GetString(_b, Pos, (int)arg); Pos += (int)arg; return s; }
                    case 5:
                    {
                        var map = new Dictionary<object, object>();
                        for (long i = 0; i < arg; i++) map[Read()] = Read();
                        return map;
                    }
                    default: throw new InvalidDataException("Unsupported CBOR major type " + major);
                }
            }
        }

        // ---------- Registrierung ----------

        [TestMethod]
        public void Registration_AttestationObjectAndAuthData_DecodeAsWebAuthnExpects()
        {
            Registration r = Create("example.com");
            var cbor = new Cbor(r.AttestationObject);
            var att = (Dictionary<object, object>)cbor.Read();
            Assert.AreEqual(r.AttestationObject.Length, cbor.Pos, "No trailing bytes");
            Assert.AreEqual("none", att["fmt"]);
            Assert.AreEqual(0, ((Dictionary<object, object>)att["attStmt"]).Count);
            byte[] authData = (byte[])att["authData"];
            CollectionAssert.AreEqual(r.AuthData, authData);

            CollectionAssert.AreEqual(Sha256(Encoding.UTF8.GetBytes("example.com")), Slice(authData, 0, 32), "rpIdHash");
            Assert.AreEqual(0x5D, authData[32], "UP|UV|BE|BS|AT");
            CollectionAssert.AreEqual(new byte[4], Slice(authData, 33, 4), "signCount");
            CollectionAssert.AreEqual(new byte[16], Slice(authData, 37, 16), "AAGUID");
            int credLen = (authData[53] << 8) | authData[54];
            Assert.AreEqual(32, credLen);
            CollectionAssert.AreEqual(r.CredentialId, Slice(authData, 55, credLen));

            var coseReader = new Cbor(authData, 55 + credLen);
            var cose = (Dictionary<object, object>)coseReader.Read();
            Assert.AreEqual(authData.Length, coseReader.Pos, "COSE key ends the authData (no extensions)");
            Assert.AreEqual(2L, cose[1L], "kty EC2");
            Assert.AreEqual(-7L, cose[3L], "alg ES256");
            Assert.AreEqual(1L, cose[-1L], "crv P-256");
            CollectionAssert.AreEqual(Slice(r.RawPub, 1, 32), (byte[])cose[-2L]);
            CollectionAssert.AreEqual(Slice(r.RawPub, 33, 32), (byte[])cose[-3L]);
        }

        [TestMethod]
        public void Registration_SpkiMatchesCoseKey()
        {
            Registration r = Create("example.com");
            Assert.AreEqual(91, r.Spki.Length);
            Assert.AreEqual("3059301306072a8648ce3d020106082a8648ce3d030107034200", Hex.String(Slice(r.Spki, 0, 26)));
            CollectionAssert.AreEqual(r.RawPub, Slice(r.Spki, 26, 65));
        }

        [TestMethod]
        public void Pem_IsWrappedPkcs8()
        {
            Registration r = Create("example.com");
            string[] lines = r.PrivateKeyPem.TrimEnd('\n').Split('\n');
            Assert.AreEqual("-----BEGIN PRIVATE KEY-----", lines[0]);
            Assert.AreEqual("-----END PRIVATE KEY-----", lines[lines.Length - 1]);
            for (int i = 1; i < lines.Length - 1; i++) Assert.IsTrue(lines[i].Length <= 64);
        }

        // ---------- Anmeldung ----------

        // DER-Signatur → r||s (unabhängig von PasskeyCrypto.P1363ToDer)
        private static byte[] DerToP1363(byte[] der)
        {
            Assert.AreEqual(0x30, der[0]);
            Assert.AreEqual(der.Length - 2, der[1]);
            int pos = 2;
            var result = new byte[64];
            for (int part = 0; part < 2; part++)
            {
                Assert.AreEqual(0x02, der[pos++]);
                int len = der[pos++];
                Assert.IsTrue(len >= 1 && len <= 33);
                if (len == 33) Assert.AreEqual(0, der[pos], "Padding byte only before a high bit");
                if (len > 1 && der[pos] == 0) Assert.IsTrue((der[pos + 1] & 0x80) != 0, "Minimal encoding");
                int skip = len == 33 ? 1 : 0;
                Buffer.BlockCopy(der, pos + skip, result, part * 32 + (32 - (len - skip)), len - skip);
                pos += len;
            }
            Assert.AreEqual(der.Length, pos);
            return result;
        }

        private static bool Verify(byte[] rawPub, byte[] authData, byte[] clientDataHash, byte[] derSig)
        {
            var data = new byte[authData.Length + clientDataHash.Length];
            authData.CopyTo(data, 0);
            clientDataHash.CopyTo(data, authData.Length);
            using (CngKey key = FerryCrypto.ImportRawPublicKey(rawPub, true))
            using (var ecdsa = new ECDsaCng(key) { HashAlgorithm = CngAlgorithm.Sha256 })
                return ecdsa.VerifyData(data, DerToP1363(derSig));
        }

        [TestMethod]
        public void Assertion_SignatureVerifies_ForManyKeysAndChallenges()
        {
            // Viele Durchläufe, damit r/s mit führenden Nullen und gesetztem Hochbit vorkommen
            for (int i = 0; i < 64; i++)
            {
                Registration r = Create("login.example.com");
                byte[] authData = PasskeyCrypto.BuildAuthData("login.example.com", 0x1D, null, null);
                Assert.AreEqual(37, authData.Length);
                byte[] cdh = TestFerryClient.Random(32);
                byte[] sig = PasskeyCrypto.Sign(r.PrivateKeyPem, authData, cdh);
                Assert.IsTrue(Verify(r.RawPub, authData, cdh, sig), "Iteration " + i);
                Assert.IsFalse(Verify(r.RawPub, authData, TestFerryClient.Random(32), sig), "Other challenge");
            }
        }

        [TestMethod]
        public void Assertion_IsBoundToRpId()
        {
            Registration r = Create("example.com");
            byte[] cdh = TestFerryClient.Random(32);
            byte[] sig = PasskeyCrypto.Sign(r.PrivateKeyPem, PasskeyCrypto.BuildAuthData("example.com", 0x1D, null, null), cdh);
            byte[] otherRp = PasskeyCrypto.BuildAuthData("example.com.evil.test", 0x1D, null, null);
            Assert.IsFalse(Verify(r.RawPub, otherRp, cdh, sig));
            CollectionAssert.AreNotEqual(Slice(otherRp, 0, 32), Sha256(Encoding.UTF8.GetBytes("example.com")));
        }

        [TestMethod]
        public void Assertion_WithOtherKey_DoesNotVerify()
        {
            Registration a = Create("example.com");
            Registration b = Create("example.com");
            byte[] authData = PasskeyCrypto.BuildAuthData("example.com", 0x1D, null, null);
            byte[] cdh = TestFerryClient.Random(32);
            Assert.IsFalse(Verify(b.RawPub, authData, cdh, PasskeyCrypto.Sign(a.PrivateKeyPem, authData, cdh)));
        }

        [TestMethod]
        public void P1363ToDer_EdgeCases()
        {
            var sig = new byte[64];
            sig[31] = 0x01;           // r = 1 (31 führende Nullen)
            sig[32] = 0x80;           // s mit Hochbit → Füllbyte
            byte[] der = PasskeyCrypto.P1363ToDer(sig);
            Assert.AreEqual("3026" + "020101" + "022100" + "80" + new string('0', 62), Hex.String(der));
            CollectionAssert.AreEqual(sig, DerToP1363(der));

            byte[] zero = PasskeyCrypto.P1363ToDer(new byte[64]);
            Assert.AreEqual("3006020100020100", Hex.String(zero));
        }

        // ---------- Wegwerf-Datenbank ----------

        [TestMethod]
        public void PrivateKey_SurvivesSaveAndReloadOfDisposableDatabase()
        {
            Registration r = Create("example.com");
            string path = Path.Combine(Path.GetTempPath(), "kpf-test-" + Guid.NewGuid().ToString("N") + ".kdbx");
            var key = new CompositeKey();
            key.AddUserKey(new KcpPassword(Convert.ToBase64String(TestFerryClient.Random(24)))); // erzeugt, nirgends gespeichert
            try
            {
                var db = new PwDatabase();
                db.New(IOConnectionInfo.FromPath(path), key);
                var entry = new PwEntry(true, true);
                entry.Strings.Set("KPEX_PASSKEY_PRIVATE_KEY_PEM", new ProtectedString(true, r.PrivateKeyPem));
                entry.Strings.Set("KPEX_PASSKEY_CREDENTIAL_ID", new ProtectedString(true, Convert.ToBase64String(r.CredentialId)));
                entry.Strings.Set("KPEX_PASSKEY_RELYING_PARTY", new ProtectedString(false, "example.com"));
                db.RootGroup.AddEntry(entry, true);
                db.Save(null);
                db.Close();

                var reopened = new PwDatabase();
                reopened.Open(IOConnectionInfo.FromPath(path), key, null);
                PwEntry loaded = reopened.RootGroup.FindEntry(entry.Uuid, true);
                Assert.IsNotNull(loaded);
                Assert.IsTrue(loaded.Strings.Get("KPEX_PASSKEY_PRIVATE_KEY_PEM").IsProtected);
                string pem = loaded.Strings.ReadSafe("KPEX_PASSKEY_PRIVATE_KEY_PEM");
                reopened.Close();

                byte[] authData = PasskeyCrypto.BuildAuthData("example.com", 0x1D, null, null);
                byte[] cdh = TestFerryClient.Random(32);
                Assert.IsTrue(Verify(r.RawPub, authData, cdh, PasskeyCrypto.Sign(pem, authData, cdh)));
                // Windows-Zeilenenden (z. B. nach Bearbeiten in KeePass) stören nicht
                Assert.IsTrue(Verify(r.RawPub, authData, cdh, PasskeyCrypto.Sign(pem.Replace("\n", "\r\n"), authData, cdh)));
            }
            finally
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }

        private static byte[] Slice(byte[] b, int offset, int length)
        {
            var r = new byte[length];
            Buffer.BlockCopy(b, offset, r, 0, length);
            return r;
        }
    }
}
