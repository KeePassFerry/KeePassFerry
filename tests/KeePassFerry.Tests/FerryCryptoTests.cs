using System;
using System.Security.Cryptography;
using System.Text;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Bekannte Testvektoren (RFC 5869, GCM-Spezifikation McGrew/Viega Testfälle 13–16) und Manipulationsproben
    /// gegen die echte Implementierung (HMACSHA256 bzw. Windows CNG über bcrypt.dll)
    /// </summary>
    [TestClass]
    public class FerryCryptoTests
    {
        // ---------- HKDF-SHA-256, RFC 5869 Anhang A ----------

        [TestMethod]
        public void Hkdf_Rfc5869_Case1()
        {
            byte[] okm = FerryCrypto.Hkdf(Hex.Repeat(0x0b, 22), Hex.Range(0x00, 0x0c), Hex.Range(0xf0, 0xf9), 42);
            Assert.AreEqual("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", Hex.String(okm));
        }

        [TestMethod]
        public void Hkdf_Rfc5869_Case2_LongInputs()
        {
            byte[] okm = FerryCrypto.Hkdf(Hex.Range(0x00, 0x4f), Hex.Range(0x60, 0xaf), Hex.Range(0xb0, 0xff), 82);
            Assert.AreEqual(
                "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87",
                Hex.String(okm));
        }

        [TestMethod]
        public void Hkdf_Rfc5869_Case3_EmptySaltAndInfo()
        {
            const string expected = "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8";
            Assert.AreEqual(expected, Hex.String(FerryCrypto.Hkdf(Hex.Repeat(0x0b, 22), new byte[0], new byte[0], 42)));
            // Ohne Salt: RFC 5869 verlangt HashLen Null-Bytes; ergibt dasselbe
            Assert.AreEqual(expected, Hex.String(FerryCrypto.Hkdf(Hex.Repeat(0x0b, 22), null, new byte[0], 42)));
        }

        // ---------- AES-256-GCM über CNG ----------

        private static readonly byte[] K15 = Hex.Bytes("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308");
        private static readonly byte[] Iv15 = Hex.Bytes("cafebabefacedbaddecaf888");
        private static readonly byte[] P15 = Hex.Bytes(
            "d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255");
        private const string C15 =
            "522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad";
        private static readonly byte[] Aad16 = Hex.Bytes("feedfacedeadbeeffeedfacedeadbeefabaddad2");

        [TestMethod]
        public void Gcm_TestCase13_EmptyPlaintext()
        {
            byte[] c = FerryCrypto.GcmEncrypt(new byte[32], new byte[12], new byte[0], null);
            Assert.AreEqual("530f8afbc74536b9a963b4f1c4cb738b", Hex.String(c));
            Assert.AreEqual(0, FerryCrypto.GcmDecrypt(new byte[32], new byte[12], c, null).Length);
        }

        [TestMethod]
        public void Gcm_TestCase14_OneBlock()
        {
            byte[] c = FerryCrypto.GcmEncrypt(new byte[32], new byte[12], new byte[16], null);
            Assert.AreEqual("cea7403d4d606b6e074ec5d3baf39d18" + "d0d1c8a799996bf0265b98b5d48ab919", Hex.String(c));
        }

        [TestMethod]
        public void Gcm_TestCase15_FourBlocks()
        {
            byte[] c = FerryCrypto.GcmEncrypt(K15, Iv15, P15, null);
            Assert.AreEqual(C15 + "b094dac5d93471bdec1a502270e3cc6c", Hex.String(c));
            CollectionAssert.AreEqual(P15, FerryCrypto.GcmDecrypt(K15, Iv15, c, null));
        }

        [TestMethod]
        public void Gcm_TestCase16_WithAad()
        {
            byte[] p = new byte[60];
            Buffer.BlockCopy(P15, 0, p, 0, 60);
            byte[] c = FerryCrypto.GcmEncrypt(K15, Iv15, p, Aad16);
            Assert.AreEqual(C15.Substring(0, 120) + "76fc6ece0f4e1768cddf8853bb2d551b", Hex.String(c));
            CollectionAssert.AreEqual(p, FerryCrypto.GcmDecrypt(K15, Iv15, c, Aad16));
        }

        [TestMethod]
        public void Gcm_RejectsEveryModifiedByte()
        {
            byte[] c = FerryCrypto.GcmEncrypt(K15, Iv15, Encoding.UTF8.GetBytes("{\"jsonrpc\":\"2.0\",\"id\":1}"), Aad16);
            for (int i = 0; i < c.Length; i++)
            {
                var bad = (byte[])c.Clone();
                bad[i] ^= 0x01;
                Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(K15, Iv15, bad, Aad16), "Byte " + i);
            }
        }

        [TestMethod]
        public void Gcm_RejectsWrongKeyNonceAadAndTruncation()
        {
            byte[] c = FerryCrypto.GcmEncrypt(K15, Iv15, P15, Aad16);
            var otherKey = (byte[])K15.Clone();
            otherKey[31] ^= 0x80;
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(otherKey, Iv15, c, Aad16));
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(K15, FerryCrypto.CounterNonce(2), c, Aad16));
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(K15, Iv15, c, null));
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(K15, Iv15, c, Encoding.ASCII.GetBytes("KeePassFerry v2")));
            var truncated = new byte[c.Length - 1];
            Buffer.BlockCopy(c, 0, truncated, 0, truncated.Length);
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(K15, Iv15, truncated, Aad16));
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.GcmDecrypt(K15, Iv15, new byte[15], Aad16));
        }

        [TestMethod]
        public void Gcm_RejectsInvalidKeyOrNonceLength()
        {
            Assert.ThrowsException<ArgumentException>(() => FerryCrypto.GcmEncrypt(new byte[16], new byte[12], new byte[1], null));
            Assert.ThrowsException<ArgumentException>(() => FerryCrypto.GcmEncrypt(new byte[32], new byte[16], new byte[1], null));
            Assert.ThrowsException<ArgumentException>(() => FerryCrypto.GcmEncrypt(null, new byte[12], new byte[1], null));
        }

        [TestMethod]
        public void Gcm_RoundTripsVariousLengths()
        {
            var rng = new Random(1);
            foreach (int length in new[] { 1, 15, 16, 17, 255, 4096, 1 << 20 })
            {
                var key = new byte[32];
                var plain = new byte[length];
                rng.NextBytes(key);
                rng.NextBytes(plain);
                byte[] c = FerryCrypto.GcmEncrypt(key, FerryCrypto.CounterNonce((ulong)length), plain, Aad16);
                Assert.AreEqual(length + FerryCrypto.GcmTagBytes, c.Length);
                CollectionAssert.AreEqual(plain, FerryCrypto.GcmDecrypt(key, FerryCrypto.CounterNonce((ulong)length), c, Aad16));
            }
        }

        // ---------- Nonce, Schlüsselformate, Vergleich ----------

        [TestMethod]
        public void CounterNonce_IsFourZeroBytesAndBigEndianCounter()
        {
            Assert.AreEqual("000000000000000000000001", Hex.String(FerryCrypto.CounterNonce(1)));
            Assert.AreEqual("000000000102030405060708", Hex.String(FerryCrypto.CounterNonce(0x0102030405060708UL)));
            Assert.AreEqual("00000000ffffffffffffffff", Hex.String(FerryCrypto.CounterNonce(ulong.MaxValue)));
        }

        [TestMethod]
        public void RawPublicKey_RoundTripsThroughCng()
        {
            using (CngKey key = CngKey.Create(CngAlgorithm.ECDsaP256, null,
                       new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport }))
            {
                byte[] raw = FerryCrypto.RawFromCngPublicBlob(key.Export(CngKeyBlobFormat.EccPublicBlob));
                Assert.AreEqual(65, raw.Length);
                Assert.AreEqual(0x04, raw[0]);
                byte[] data = Encoding.ASCII.GetBytes("KeePassFerry");
                byte[] sig;
                using (var signer = new ECDsaCng(key)) sig = signer.SignData(data);
                using (CngKey imported = FerryCrypto.ImportRawPublicKey(raw, true))
                using (var verifier = new ECDsaCng(imported))
                    Assert.IsTrue(verifier.VerifyData(data, sig));
            }
        }

        [TestMethod]
        public void RawPublicKey_RejectsMalformedKeys()
        {
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.ImportRawPublicKey(new byte[64], true));
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.ImportRawPublicKey(new byte[65], false)); // ohne 0x04
            var notOnCurve = new byte[65];
            notOnCurve[0] = 0x04;
            notOnCurve[64] = 1;
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.ImportRawPublicKey(notOnCurve, false));
            Assert.ThrowsException<CryptographicException>(() => FerryCrypto.RawFromCngPublicBlob(new byte[71]));
        }

        [TestMethod]
        public void FixedTimeEquals_ComparesContentAndLength()
        {
            Assert.IsTrue(FerryCrypto.FixedTimeEquals(new byte[] { 1, 2, 3 }, new byte[] { 1, 2, 3 }));
            Assert.IsFalse(FerryCrypto.FixedTimeEquals(new byte[] { 1, 2, 3 }, new byte[] { 1, 2, 4 }));
            Assert.IsFalse(FerryCrypto.FixedTimeEquals(new byte[] { 1, 2, 3 }, new byte[] { 1, 2 }));
            Assert.IsFalse(FerryCrypto.FixedTimeEquals(null, new byte[0]));
        }

        // ---------- Gemeinsame Vektoren mit der Erweiterung (extension/src/tests/channelVectors.test.ts) ----------

        internal static readonly byte[] VectorTh = FerryCrypto.Sha256(Encoding.ASCII.GetBytes("KeePassFerry test transcript"));
        internal static readonly byte[] VectorSasNonce = Hex.Range(1, 32);

        [TestMethod]
        public void ChannelVectors_KeysPairingCodesAndFirstMessage()
        {
            Assert.AreEqual("1d7e5f699c9de44a204af57b685d184b1dc7ca000b2e812e79f3d571232b294f", Hex.String(VectorTh));
            byte[] zHash = FerryCrypto.Sha256(Encoding.ASCII.GetBytes("KeePassFerry test shared secret"));
            byte[] okm = FerryCrypto.Hkdf(zHash, VectorTh, Encoding.ASCII.GetBytes("KeePassFerry keys v1"), 64);
            Assert.AreEqual(
                "d79bd7c04075e7e462cff4e54feb071e740f7753d83c9d865ae999687aa77eb5df8549054f0fd8280bb3ef9c9bc99b2bfbd41d56af713eaea7ca2bb47720370e",
                Hex.String(okm));

            var clientToServer = new byte[32];
            Buffer.BlockCopy(okm, 0, clientToServer, 0, 32);
            byte[] c = FerryCrypto.GcmEncrypt(clientToServer, FerryCrypto.CounterNonce(1), Encoding.UTF8.GetBytes("{\"ferry\":\"ready\"}"),
                Encoding.ASCII.GetBytes("KeePassFerry v1"));
            Assert.AreEqual("dc0a5fdb2169488008d4c7468d6039c641" + "d4c3c659b15b2f5adbd8e78cdc33ad9c", Hex.String(c));

            Assert.AreEqual("247676", SecureChannel.PairingCode(VectorTh));
            Assert.AreEqual("289347", SecureChannel.PairingCodeV2(VectorTh, VectorSasNonce));
            Assert.AreEqual("1dcc57d5001a3a480113186dada105cb690ff5d35d49f52125f45af333caaadf",
                Hex.String(FerryCrypto.Sha256(Encoding.ASCII.GetBytes("KeePassFerry SAS commit v2"), VectorSasNonce)));
        }

        [TestMethod]
        public void PairingCode_IsAlwaysSixDigits()
        {
            var rng = new Random(2);
            for (int i = 0; i < 2000; i++)
            {
                var th = new byte[32];
                rng.NextBytes(th);
                string code = SecureChannel.PairingCodeV2(th, VectorSasNonce);
                Assert.AreEqual(6, code.Length);
                foreach (char ch in code) Assert.IsTrue(ch >= '0' && ch <= '9');
            }
        }
    }
}
