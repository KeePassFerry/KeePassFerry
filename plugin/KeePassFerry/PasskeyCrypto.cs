using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace KeePassFerry
{
    /// <summary>
    /// Passkey-Bausteine ohne KeePass-Abhängigkeit: authenticatorData, COSE-Schlüssel, Attestation "none",
    /// SubjectPublicKeyInfo, PEM und ES256-Signatur (Tests: tests/KeePassFerry.Tests)
    /// </summary>
    internal static class PasskeyCrypto
    {
        internal static byte[] BuildAuthData(string rpId, byte flags, byte[] credentialId, byte[] coseKey)
        {
            using (var ms = new MemoryStream())
            {
                byte[] rpIdHash = FerryCrypto.Sha256(Encoding.UTF8.GetBytes(rpId));
                ms.Write(rpIdHash, 0, 32);
                ms.WriteByte(flags);
                ms.Write(new byte[4], 0, 4); // Zähler 0 (wie KeePassXC; passt zu synchronisierten Passkeys)
                if (credentialId != null)
                {
                    ms.Write(new byte[16], 0, 16); // AAGUID (keine Attestation)
                    ms.WriteByte((byte)(credentialId.Length >> 8));
                    ms.WriteByte((byte)credentialId.Length);
                    ms.Write(credentialId, 0, credentialId.Length);
                    ms.Write(coseKey, 0, coseKey.Length);
                }
                return ms.ToArray();
            }
        }

        // COSE_Key ES256: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
        internal static byte[] CoseKeyEs256(byte[] rawPub)
        {
            using (var ms = new MemoryStream())
            {
                ms.Write(new byte[] { 0xA5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20 }, 0, 10);
                ms.Write(rawPub, 1, 32);
                ms.Write(new byte[] { 0x22, 0x58, 0x20 }, 0, 3);
                ms.Write(rawPub, 33, 32);
                return ms.ToArray();
            }
        }

        // {"fmt": "none", "attStmt": {}, "authData": bytes}
        internal static byte[] AttestationObjectNone(byte[] authData)
        {
            using (var ms = new MemoryStream())
            {
                ms.WriteByte(0xA3);
                WriteCborText(ms, "fmt");
                WriteCborText(ms, "none");
                WriteCborText(ms, "attStmt");
                ms.WriteByte(0xA0);
                WriteCborText(ms, "authData");
                WriteCborHead(ms, 2, authData.Length);
                ms.Write(authData, 0, authData.Length);
                return ms.ToArray();
            }
        }

        private static void WriteCborText(Stream s, string text)
        {
            byte[] b = Encoding.UTF8.GetBytes(text);
            WriteCborHead(s, 3, b.Length);
            s.Write(b, 0, b.Length);
        }

        private static void WriteCborHead(Stream s, int majorType, int length)
        {
            int mt = majorType << 5;
            if (length < 24) s.WriteByte((byte)(mt | length));
            else if (length < 256) { s.WriteByte((byte)(mt | 24)); s.WriteByte((byte)length); }
            else { s.WriteByte((byte)(mt | 25)); s.WriteByte((byte)(length >> 8)); s.WriteByte((byte)length); }
        }

        // SubjectPublicKeyInfo für P-256 (für getPublicKey() der Seite)
        internal static byte[] SpkiP256(byte[] rawPub)
        {
            byte[] prefix =
            {
                0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
                0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
            };
            return Concat(prefix, rawPub);
        }

        // ECDSA-Signatur r||s (P1363) → ASN.1 DER, wie WebAuthn es für ES256 verlangt
        internal static byte[] P1363ToDer(byte[] sig)
        {
            int half = sig.Length / 2;
            byte[] r = DerInteger(sig, 0, half);
            byte[] s = DerInteger(sig, half, half);
            var result = new byte[2 + r.Length + s.Length];
            result[0] = 0x30;
            result[1] = (byte)(r.Length + s.Length);
            Buffer.BlockCopy(r, 0, result, 2, r.Length);
            Buffer.BlockCopy(s, 0, result, 2 + r.Length, s.Length);
            return result;
        }

        private static byte[] DerInteger(byte[] src, int offset, int length)
        {
            int start = offset;
            while (start < offset + length - 1 && src[start] == 0) start++;
            int len = offset + length - start;
            bool pad = (src[start] & 0x80) != 0;
            var r = new byte[2 + len + (pad ? 1 : 0)];
            r[0] = 0x02;
            r[1] = (byte)(len + (pad ? 1 : 0));
            Buffer.BlockCopy(src, start, r, 2 + (pad ? 1 : 0), len);
            return r;
        }

        internal static string ToPem(byte[] pkcs8)
        {
            string b64 = Convert.ToBase64String(pkcs8);
            var sb = new StringBuilder("-----BEGIN PRIVATE KEY-----\n");
            for (int i = 0; i < b64.Length; i += 64) sb.Append(b64, i, Math.Min(64, b64.Length - i)).Append('\n');
            sb.Append("-----END PRIVATE KEY-----\n");
            return sb.ToString();
        }

        internal static CngKey ImportPrivateKey(string pem)
        {
            var sb = new StringBuilder();
            foreach (string line in pem.Replace("\r", "").Split('\n'))
                if (!line.StartsWith("-----")) sb.Append(line.Trim());
            byte[] der = Convert.FromBase64String(sb.ToString());
            try
            {
                return CngKey.Import(der, CngKeyBlobFormat.Pkcs8PrivateBlob);
            }
            finally
            {
                Array.Clear(der, 0, der.Length);
            }
        }

        // ES256-Signatur über authenticatorData || clientDataHash, DER-kodiert (WebAuthn)
        internal static byte[] Sign(string privateKeyPem, byte[] authData, byte[] clientDataHash)
        {
            using (CngKey key = ImportPrivateKey(privateKeyPem))
            using (var ecdsa = new ECDsaCng(key))
            {
                ecdsa.HashAlgorithm = CngAlgorithm.Sha256;
                return P1363ToDer(ecdsa.SignData(Concat(authData, clientDataHash)));
            }
        }

        private static byte[] Concat(byte[] a, byte[] b)
        {
            var r = new byte[a.Length + b.Length];
            Buffer.BlockCopy(a, 0, r, 0, a.Length);
            Buffer.BlockCopy(b, 0, r, a.Length, b.Length);
            return r;
        }
    }
}
