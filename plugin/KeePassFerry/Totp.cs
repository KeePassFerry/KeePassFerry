using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using KeePass.Util.Spr;
using KeePassLib;

namespace KeePassFerry
{
    /// <summary>
    /// Aktueller TOTP-Code eines Eintrags
    /// </summary>
    public class TotpResult
    {
        public string code;
        public int remainingSeconds;
        public int period;
    }

    /// <summary>
    /// Berechnet TOTP-Codes (RFC 6238) aus dem Feld "otp" (otpauth-URI, KeePassXC-Format)
    /// oder aus den KeePass-eigenen Feldern TimeOtp-*
    /// </summary>
    public static class Totp
    {
        public const string OtpField = "otp";

        public static bool HasTotp(PwEntry entry)
        {
            return !string.IsNullOrEmpty(entry.Strings.ReadSafe(OtpField)) || HasNativeTimeOtp(entry);
        }

        private static bool HasNativeTimeOtp(PwEntry entry)
        {
            foreach (string suffix in new[] { "", "-Hex", "-Base32", "-Base64" })
                if (!string.IsNullOrEmpty(entry.Strings.ReadSafe("TimeOtp-Secret" + suffix)))
                    return true;
            return false;
        }

        /// <summary>
        /// Aktueller Code oder null, wenn der Eintrag kein (gültiges) TOTP hat
        /// </summary>
        public static TotpResult Compute(PwEntry entry, PwDatabase db, DateTime utcNow)
        {
            string uri = entry.Strings.ReadSafe(OtpField).Trim();
            if (uri.StartsWith("otpauth://", StringComparison.OrdinalIgnoreCase))
                return ComputeFromUri(uri, utcNow);

            if (HasNativeTimeOtp(entry))
                return ComputeNative(entry, db);

            return null;
        }

        // KeePass-eigene TimeOtp-Felder selbst auswerten (RFC 6238). Bewusst ohne SprEngine ("{TIMEOTP}"):
        // dort hängen sich andere Plugins ein, was außerhalb des UI-Threads hängen bleiben kann.
        private static TotpResult ComputeNative(PwEntry entry, PwDatabase db)
        {
            byte[] key = NativeSecret(entry);
            if (key == null || key.Length == 0)
                return null;
            int digits, period;
            if (!int.TryParse(entry.Strings.ReadSafe("TimeOtp-Length"), out digits) || digits < 6 || digits > 10)
                digits = 6;
            if (!int.TryParse(entry.Strings.ReadSafe("TimeOtp-Period"), out period) || period <= 0)
                period = 30;
            string algorithm;
            switch (entry.Strings.ReadSafe("TimeOtp-Algorithm").Trim().ToUpperInvariant())
            {
                case "HMAC-SHA-256": algorithm = "SHA256"; break;
                case "HMAC-SHA-512": algorithm = "SHA512"; break;
                default: algorithm = "SHA1"; break;
            }
            DateTime utcNow = DateTime.UtcNow;
            long counter = (long)Math.Floor((utcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds / period);
            string code = GenerateHotp(key, counter, digits, algorithm);
            Array.Clear(key, 0, key.Length);
            if (code == null)
                return null;
            return new TotpResult { code = code, period = period, remainingSeconds = Remaining(utcNow, period) };
        }

        // Schlüssel aus TimeOtp-Secret (UTF-8), -Hex, -Base32 oder -Base64
        private static byte[] NativeSecret(PwEntry entry)
        {
            string s = entry.Strings.ReadSafe("TimeOtp-Secret");
            if (!string.IsNullOrEmpty(s)) return Encoding.UTF8.GetBytes(s);
            s = entry.Strings.ReadSafe("TimeOtp-Secret-Hex").Replace(" ", "");
            if (!string.IsNullOrEmpty(s))
            {
                if (s.Length % 2 != 0) return null;
                var hex = new byte[s.Length / 2];
                for (int i = 0; i < hex.Length; i++)
                    if (!byte.TryParse(s.Substring(i * 2, 2), System.Globalization.NumberStyles.HexNumber, null, out hex[i])) return null;
                return hex;
            }
            s = entry.Strings.ReadSafe("TimeOtp-Secret-Base32");
            if (!string.IsNullOrEmpty(s)) return Base32Decode(s);
            s = entry.Strings.ReadSafe("TimeOtp-Secret-Base64");
            if (!string.IsNullOrEmpty(s))
            {
                try { return Convert.FromBase64String(s.Trim()); }
                catch (FormatException) { return null; }
            }
            return null;
        }

        internal static TotpResult ComputeFromUri(string uri, DateTime utcNow)
        {
            var query = ParseQuery(uri);
            string secret;
            if (!query.TryGetValue("secret", out secret))
                return null;
            byte[] key = Base32Decode(secret);
            if (key == null || key.Length == 0)
                return null;

            int digits = 6, period = 30;
            string value;
            if (query.TryGetValue("digits", out value)) int.TryParse(value, out digits);
            if (query.TryGetValue("period", out value)) int.TryParse(value, out period);
            if (digits < 6 || digits > 10) digits = 6;
            if (period <= 0) period = 30;
            string algorithm = query.TryGetValue("algorithm", out value) ? value.ToUpperInvariant() : "SHA1";

            // Steam Guard nutzt eigenes Alphabet; im KeePassXC-Format als encoder=steam markiert
            bool steam = (query.TryGetValue("encoder", out value) && value.Equals("steam", StringComparison.OrdinalIgnoreCase))
                         || uri.StartsWith("otpauth://steam/", StringComparison.OrdinalIgnoreCase);

            long counter = (long)Math.Floor((utcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds / period);
            string code = steam ? GenerateSteam(key, counter, algorithm) : GenerateHotp(key, counter, digits, algorithm);
            if (code == null)
                return null;
            return new TotpResult { code = code, period = period, remainingSeconds = Remaining(utcNow, period) };
        }

        private static int Remaining(DateTime utcNow, int period)
        {
            long seconds = (long)(utcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
            return period - (int)(seconds % period);
        }

        private static byte[] Hmac(byte[] key, long counter, string algorithm)
        {
            byte[] msg = BitConverter.GetBytes(counter);
            if (BitConverter.IsLittleEndian) Array.Reverse(msg);
            HMAC hmac;
            switch (algorithm)
            {
                case "SHA1": hmac = new HMACSHA1(key); break;
                case "SHA256": hmac = new HMACSHA256(key); break;
                case "SHA512": hmac = new HMACSHA512(key); break;
                default: return null;
            }
            using (hmac)
                return hmac.ComputeHash(msg);
        }

        private static int Truncate(byte[] hash)
        {
            int offset = hash[hash.Length - 1] & 0x0F;
            return ((hash[offset] & 0x7F) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        }

        internal static string GenerateHotp(byte[] key, long counter, int digits, string algorithm)
        {
            byte[] hash = Hmac(key, counter, algorithm);
            if (hash == null) return null;
            long binary = Truncate(hash);
            long mod = 1;
            for (int i = 0; i < digits; i++) mod *= 10;
            return (binary % mod).ToString().PadLeft(digits, '0');
        }

        private static string GenerateSteam(byte[] key, long counter, string algorithm)
        {
            const string alphabet = "23456789BCDFGHJKMNPQRTVWXY";
            byte[] hash = Hmac(key, counter, algorithm);
            if (hash == null) return null;
            int binary = Truncate(hash);
            var sb = new StringBuilder();
            for (int i = 0; i < 5; i++)
            {
                sb.Append(alphabet[binary % alphabet.Length]);
                binary /= alphabet.Length;
            }
            return sb.ToString();
        }

        private static Dictionary<string, string> ParseQuery(string uri)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            int q = uri.IndexOf('?');
            if (q < 0) return result;
            foreach (string part in uri.Substring(q + 1).Split('&'))
            {
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                string name = Uri.UnescapeDataString(part.Substring(0, eq));
                string value = Uri.UnescapeDataString(part.Substring(eq + 1).Replace('+', ' '));
                if (!result.ContainsKey(name)) result[name] = value;
            }
            return result;
        }

        internal static byte[] Base32Decode(string input)
        {
            const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            var output = new List<byte>();
            int buffer = 0, bits = 0;
            foreach (char raw in input.ToUpperInvariant())
            {
                if (raw == '=' || raw == ' ' || raw == '-') continue;
                int val = alphabet.IndexOf(raw);
                if (val < 0) return null;
                buffer = (buffer << 5) | val;
                bits += 5;
                if (bits >= 8)
                {
                    output.Add((byte)((buffer >> (bits - 8)) & 0xFF));
                    bits -= 8;
                }
            }
            return output.ToArray();
        }
    }
}
