using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace KeePassFerry
{
    /// <summary>
    /// Kryptobausteine für den KeePassFerry-Kanal: AES-256-GCM (über Windows CNG, da .NET Framework keine
    /// GCM-Klasse hat), HKDF-SHA-256, P-256-Schlüssel im Rohformat (0x04 || X || Y) wie bei WebCrypto
    /// </summary>
    public static class FerryCrypto
    {
        public const int GcmTagBytes = 16;
        public const int GcmNonceBytes = 12;

        // ---------- AES-256-GCM über bcrypt.dll ----------

        [StructLayout(LayoutKind.Sequential)]
        private struct AuthenticatedCipherModeInfo
        {
            public int cbSize;
            public int dwInfoVersion;
            public IntPtr pbNonce;
            public int cbNonce;
            public IntPtr pbAuthData;
            public int cbAuthData;
            public IntPtr pbTag;
            public int cbTag;
            public IntPtr pbMacContext;
            public int cbMacContext;
            public int cbAAD;
            public long cbData;
            public int dwFlags;
        }

        [DllImport("bcrypt.dll", CharSet = CharSet.Unicode)]
        private static extern uint BCryptOpenAlgorithmProvider(out IntPtr phAlgorithm, string pszAlgId, string pszImplementation, uint dwFlags);

        [DllImport("bcrypt.dll", CharSet = CharSet.Unicode)]
        private static extern uint BCryptSetProperty(IntPtr hObject, string pszProperty, byte[] pbInput, int cbInput, int dwFlags);

        [DllImport("bcrypt.dll")]
        private static extern uint BCryptGenerateSymmetricKey(IntPtr hAlgorithm, out IntPtr phKey, IntPtr pbKeyObject, int cbKeyObject, byte[] pbSecret, int cbSecret, uint dwFlags);

        [DllImport("bcrypt.dll")]
        private static extern uint BCryptEncrypt(IntPtr hKey, byte[] pbInput, int cbInput, ref AuthenticatedCipherModeInfo pPaddingInfo, IntPtr pbIV, int cbIV, byte[] pbOutput, int cbOutput, out int pcbResult, int dwFlags);

        [DllImport("bcrypt.dll")]
        private static extern uint BCryptDecrypt(IntPtr hKey, byte[] pbInput, int cbInput, ref AuthenticatedCipherModeInfo pPaddingInfo, IntPtr pbIV, int cbIV, byte[] pbOutput, int cbOutput, out int pcbResult, int dwFlags);

        [DllImport("bcrypt.dll")]
        private static extern uint BCryptDestroyKey(IntPtr hKey);

        [DllImport("bcrypt.dll")]
        private static extern uint BCryptCloseAlgorithmProvider(IntPtr hAlgorithm, uint dwFlags);

        private const uint StatusAuthTagMismatch = 0xC000A002;

        /// <summary>
        /// Verschlüsselt mit AES-256-GCM; Rückgabe: Chiffrat || 16-Byte-Tag (wie WebCrypto)
        /// </summary>
        public static byte[] GcmEncrypt(byte[] key, byte[] nonce, byte[] plaintext, byte[] aad)
        {
            return GcmTransform(key, nonce, plaintext, aad, true);
        }

        /// <summary>
        /// Entschlüsselt Chiffrat || Tag; wirft CryptographicException, wenn der Tag nicht passt
        /// </summary>
        public static byte[] GcmDecrypt(byte[] key, byte[] nonce, byte[] ciphertextAndTag, byte[] aad)
        {
            return GcmTransform(key, nonce, ciphertextAndTag, aad, false);
        }

        private static byte[] GcmTransform(byte[] key, byte[] nonce, byte[] input, byte[] aad, bool encrypt)
        {
            if (key == null || key.Length != 32) throw new ArgumentException("AES-256 key required");
            if (nonce == null || nonce.Length != GcmNonceBytes) throw new ArgumentException("96-bit nonce required");
            if (!encrypt && (input == null || input.Length < GcmTagBytes)) throw new CryptographicException("Ciphertext too short");
            aad = aad ?? new byte[0];

            IntPtr alg = IntPtr.Zero, hKey = IntPtr.Zero;
            GCHandle hNonce = default(GCHandle), hAad = default(GCHandle), hTag = default(GCHandle);
            try
            {
                Check(BCryptOpenAlgorithmProvider(out alg, "AES", null, 0));
                byte[] mode = Encoding.Unicode.GetBytes("ChainingModeGCM\0");
                Check(BCryptSetProperty(alg, "ChainingMode", mode, mode.Length, 0));
                Check(BCryptGenerateSymmetricKey(alg, out hKey, IntPtr.Zero, 0, key, key.Length, 0));

                int dataLength = encrypt ? input.Length : input.Length - GcmTagBytes;
                byte[] data = new byte[dataLength];
                Buffer.BlockCopy(input, 0, data, 0, dataLength);
                byte[] tag = new byte[GcmTagBytes];
                if (!encrypt) Buffer.BlockCopy(input, dataLength, tag, 0, GcmTagBytes);

                hNonce = GCHandle.Alloc(nonce, GCHandleType.Pinned);
                hAad = GCHandle.Alloc(aad, GCHandleType.Pinned);
                hTag = GCHandle.Alloc(tag, GCHandleType.Pinned);

                var info = new AuthenticatedCipherModeInfo
                {
                    cbSize = Marshal.SizeOf(typeof(AuthenticatedCipherModeInfo)),
                    dwInfoVersion = 1,
                    pbNonce = hNonce.AddrOfPinnedObject(),
                    cbNonce = nonce.Length,
                    pbAuthData = aad.Length > 0 ? hAad.AddrOfPinnedObject() : IntPtr.Zero,
                    cbAuthData = aad.Length,
                    pbTag = hTag.AddrOfPinnedObject(),
                    cbTag = GcmTagBytes
                };

                byte[] output = new byte[dataLength];
                int written;
                uint status = encrypt
                    ? BCryptEncrypt(hKey, data, data.Length, ref info, IntPtr.Zero, 0, output, output.Length, out written, 0)
                    : BCryptDecrypt(hKey, data, data.Length, ref info, IntPtr.Zero, 0, output, output.Length, out written, 0);
                if (status == StatusAuthTagMismatch) throw new CryptographicException("Authentication tag mismatch");
                Check(status);

                if (!encrypt) return output;
                byte[] result = new byte[output.Length + GcmTagBytes];
                Buffer.BlockCopy(output, 0, result, 0, output.Length);
                Buffer.BlockCopy(tag, 0, result, output.Length, GcmTagBytes);
                return result;
            }
            finally
            {
                if (hNonce.IsAllocated) hNonce.Free();
                if (hAad.IsAllocated) hAad.Free();
                if (hTag.IsAllocated) hTag.Free();
                if (hKey != IntPtr.Zero) BCryptDestroyKey(hKey);
                if (alg != IntPtr.Zero) BCryptCloseAlgorithmProvider(alg, 0);
            }
        }

        private static void Check(uint status)
        {
            if (status != 0) throw new CryptographicException("CNG error 0x" + status.ToString("X8"));
        }

        // ---------- HKDF-SHA-256 (RFC 5869) ----------

        public static byte[] Hkdf(byte[] ikm, byte[] salt, byte[] info, int length)
        {
            byte[] prk;
            using (var extract = new HMACSHA256(salt ?? new byte[32]))
                prk = extract.ComputeHash(ikm);
            var okm = new byte[length];
            var previous = new byte[0];
            int offset = 0;
            using (var expand = new HMACSHA256(prk))
            {
                for (byte counter = 1; offset < length; counter++)
                {
                    var input = new byte[previous.Length + info.Length + 1];
                    Buffer.BlockCopy(previous, 0, input, 0, previous.Length);
                    Buffer.BlockCopy(info, 0, input, previous.Length, info.Length);
                    input[input.Length - 1] = counter;
                    previous = expand.ComputeHash(input);
                    int n = Math.Min(previous.Length, length - offset);
                    Buffer.BlockCopy(previous, 0, okm, offset, n);
                    offset += n;
                }
            }
            return okm;
        }

        // ---------- P-256-Schlüssel: Rohformat <-> CNG-Blob ----------

        private static readonly byte[] MagicEcdhPublicP256 = { 0x45, 0x43, 0x4B, 0x31 }; // "ECK1"
        private static readonly byte[] MagicEcdsaPublicP256 = { 0x45, 0x43, 0x53, 0x31 }; // "ECS1"

        /// <summary>
        /// Öffentlicher Schlüssel im Rohformat 0x04 || X || Y (65 Byte) aus einem CNG-Public-Blob
        /// </summary>
        public static byte[] RawFromCngPublicBlob(byte[] blob)
        {
            if (blob == null || blob.Length != 8 + 64) throw new CryptographicException("Unexpected P-256 public blob");
            var raw = new byte[65];
            raw[0] = 0x04;
            Buffer.BlockCopy(blob, 8, raw, 1, 64);
            return raw;
        }

        public static CngKey ImportRawPublicKey(byte[] raw, bool forSignature)
        {
            if (raw == null || raw.Length != 65 || raw[0] != 0x04) throw new CryptographicException("Invalid P-256 public key");
            var blob = new byte[8 + 64];
            Buffer.BlockCopy(forSignature ? MagicEcdsaPublicP256 : MagicEcdhPublicP256, 0, blob, 0, 4);
            blob[4] = 32;
            Buffer.BlockCopy(raw, 1, blob, 8, 64);
            return CngKey.Import(blob, CngKeyBlobFormat.EccPublicBlob);
        }

        public static byte[] Sha256(params byte[][] parts)
        {
            using (var sha = SHA256.Create())
            {
                foreach (var p in parts) sha.TransformBlock(p, 0, p.Length, null, 0);
                sha.TransformFinalBlock(new byte[0], 0, 0);
                return sha.Hash;
            }
        }

        public static bool FixedTimeEquals(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        /// <summary>
        /// 96-Bit-Nonce: 4 Null-Bytes || Zähler (64 Bit, big endian)
        /// </summary>
        public static byte[] CounterNonce(ulong counter)
        {
            var nonce = new byte[GcmNonceBytes];
            for (int i = 0; i < 8; i++) nonce[11 - i] = (byte)(counter >> (8 * i));
            return nonce;
        }
    }
}
