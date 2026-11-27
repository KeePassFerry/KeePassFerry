using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using KeePassLib;
using KeePassLib.Collections;
using KeePassLib.Security;

namespace KeePassFerry
{
    /// <summary>
    /// Zwei-Faktor-Schlüssel in beiden üblichen Formaten (#55): "otp" (otpauth-URI, KeePassXC-Format; schreiben
    /// KeePassXC, KeePassDX, Keepass2Android, KeePassium) und KeePass-eigene Felder TimeOtp-* (Strg+T, {TIMEOTP}; lesen
    /// alle genannten Apps als TimeOtp-Secret-Base32). Beim Einrichten schreibt KeePassFerry beide. Beim Öffnen und
    /// vor dem Speichern gleicht Sync sie ab: fehlt ein Format, wird es ergänzt; unterscheiden sie sich, gewinnt das
    /// geänderte (Merker am Eintrag, sonst Chronik; ganz ohne Hinweis "otp", aber nur wenn die Chronik den anderen Stand
    /// aufhebt). Nichts wird gelöscht. KeePass kann nur 6 bis 8 Stellen und keine Steam-Codes: solche bleiben in "otp".
    /// </summary>
    internal static class OtpSync
    {
        internal const string NativePrefix = "TimeOtp-";
        internal const string NativeSecretBase32 = "TimeOtp-Secret-Base32";
        internal const string NativeLength = "TimeOtp-Length";
        internal const string NativePeriod = "TimeOtp-Period";
        internal const string NativeAlgorithm = "TimeOtp-Algorithm";

        internal sealed class OtpParams
        {
            public byte[] Key;
            public int Digits = 6;
            public int Period = 30;
            public string Algorithm = "SHA1"; // SHA1, SHA256, SHA512
            public bool Steam;

            public bool SameKeyAs(OtpParams o)
            {
                return o != null && Key.SequenceEqual(o.Key) && Digits == o.Digits && Period == o.Period
                       && Algorithm == o.Algorithm && Steam == o.Steam;
            }

            // KeePass rechnet nur HMAC-SHA-1/256/512 mit 6 bis 8 Stellen (HmacOtp.Generate liefert sonst nichts)
            public bool FitsKeePass
            {
                get { return !Steam && Digits >= 6 && Digits <= 8 && (Algorithm == "SHA1" || Algorithm == "SHA256" || Algorithm == "SHA512"); }
            }
        }

        // ---------- Lesen ----------

        internal static OtpParams FromUri(string uri)
        {
            uri = (uri ?? "").Trim();
            if (!uri.StartsWith("otpauth://", StringComparison.OrdinalIgnoreCase)) return null;
            Dictionary<string, string> query = Totp.ParseQuery(uri);
            string value;
            if (!query.TryGetValue("secret", out value)) return null;
            byte[] key = Totp.Base32Decode(value);
            if (key == null || key.Length == 0) return null;
            var p = new OtpParams { Key = key };
            if (query.TryGetValue("digits", out value)) int.TryParse(value, out p.Digits);
            if (query.TryGetValue("period", out value)) int.TryParse(value, out p.Period);
            if (p.Digits < 6 || p.Digits > 10) p.Digits = 6;
            if (p.Period <= 0) p.Period = 30;
            if (query.TryGetValue("algorithm", out value)) p.Algorithm = value.Trim().ToUpperInvariant();
            p.Steam = (query.TryGetValue("encoder", out value) && value.Equals("steam", StringComparison.OrdinalIgnoreCase))
                      || uri.StartsWith("otpauth://steam/", StringComparison.OrdinalIgnoreCase);
            return p;
        }

        internal static OtpParams FromNative(ProtectedStringDictionary strings)
        {
            byte[] key = Totp.NativeSecret(strings);
            if (key == null || key.Length == 0) return null;
            var p = new OtpParams { Key = key };
            int n;
            if (int.TryParse(strings.ReadSafe(NativeLength), out n) && n >= 6 && n <= 10) p.Digits = n;
            if (int.TryParse(strings.ReadSafe(NativePeriod), out n) && n > 0) p.Period = n;
            switch (strings.ReadSafe(NativeAlgorithm).Trim().ToUpperInvariant())
            {
                case "HMAC-SHA-256": p.Algorithm = "SHA256"; break;
                case "HMAC-SHA-512": p.Algorithm = "SHA512"; break;
                default: p.Algorithm = "SHA1"; break;
            }
            return p;
        }

        // Inhalt der KeePass-Felder als Text (zum Vergleich mit Chronik-Ständen)
        internal static string NativeSignature(ProtectedStringDictionary strings)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, ProtectedString> kv in strings)
                if (kv.Key.StartsWith(NativePrefix, StringComparison.Ordinal)) parts.Add(kv.Key + "=" + kv.Value.ReadString());
            parts.Sort(StringComparer.Ordinal);
            return string.Join("\n", parts);
        }

        // ---------- Schreiben ----------

        /// <summary>KeePass-Felder neu setzen (vorhandene TimeOtp-* vorher entfernen). false, wenn KeePass den Schlüssel nicht kann</summary>
        internal static bool WriteNative(ProtectedStringDictionary strings, OtpParams p)
        {
            if (p == null || !p.FitsKeePass) return false;
            RemoveNative(strings);
            strings.Set(NativeSecretBase32, new ProtectedString(true, Base32Encode(p.Key)));
            strings.Set(NativeLength, new ProtectedString(false, p.Digits.ToString()));
            strings.Set(NativePeriod, new ProtectedString(false, p.Period.ToString()));
            strings.Set(NativeAlgorithm, new ProtectedString(false, "HMAC-" + p.Algorithm.Replace("SHA", "SHA-")));
            return true;
        }

        internal static void RemoveNative(ProtectedStringDictionary strings)
        {
            var names = new List<string>();
            foreach (KeyValuePair<string, ProtectedString> kv in strings)
                if (kv.Key.StartsWith(NativePrefix, StringComparison.Ordinal)) names.Add(kv.Key);
            foreach (string name in names) strings.Remove(name);
        }

        /// <summary>otpauth-URI im KeePassXC-Format (Anbieter = Titel, Konto = Benutzername)</summary>
        internal static string BuildUri(OtpParams p, string issuer, string account)
        {
            issuer = (issuer ?? "").Trim();
            account = (account ?? "").Trim();
            string label = issuer.Length > 0 && account.Length > 0 ? issuer + ":" + account : (issuer + account);
            if (label.Length == 0) label = "KeePass";
            var sb = new StringBuilder("otpauth://totp/");
            sb.Append(Uri.EscapeDataString(label));
            sb.Append("?secret=").Append(Base32Encode(p.Key));
            if (issuer.Length > 0) sb.Append("&issuer=").Append(Uri.EscapeDataString(issuer));
            sb.Append("&period=").Append(p.Period);
            sb.Append("&digits=").Append(p.Digits);
            sb.Append("&algorithm=").Append(p.Algorithm);
            return sb.ToString();
        }

        // ---------- Abgleich ----------

        // Merker am Eintrag (CustomData, wandert mit Datei, Chronik und Synchronisieren; KeePassXC, KeePassDX,
        // Keepass2Android und KeePassium behalten ihn beim Bearbeiten): Prüfwert des zuletzt abgeglichenen Schlüssels.
        // Weicht später ein Format davon ab, wurde genau dieses geändert. Kein Schlüssel, nur ein gekürzter Hash
        internal const string SyncedKey = "KeePassFerry.OtpSynced";

        internal enum Change { None, Marked, AddedNative, AddedOtp, NativeFromOtp, OtpFromNative }

        /// <summary>Abgleich für beschreibbare, geöffnete Datenbanken</summary>
        internal static bool IsActive(PwDatabase db)
        {
            return db != null && db.IsOpen && !FerryService.IsDatabaseReadOnly(db);
        }

        internal static string Fingerprint(OtpParams p)
        {
            if (p == null) return "";
            string text = Convert.ToBase64String(p.Key) + "|" + p.Digits + "|" + p.Period + "|" + p.Algorithm + "|" + (p.Steam ? "steam" : "");
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes("KeePassFerry.OtpSynced\n" + text));
                return BitConverter.ToString(hash, 0, 12).Replace("-", "").ToLowerInvariant();
            }
        }

        /// <summary>
        /// Gleicht "otp" und TimeOtp-* eines Eintrags ab. Vor jeder Änderung eines Schlüssels eine Chronik-Version
        /// (bei Datenbanken mit Chronik). Ändert nichts, wenn keins da ist, sich ein Format nicht auswerten oder ein
        /// Schlüssel nicht übertragen lässt oder unklar bleibt, welcher neuer ist und keine Chronik die Kopie hält.
        /// </summary>
        internal static Change Sync(PwEntry entry, PwDatabase db)
        {
            if (entry == null || db == null) return Change.None;
            Change change = Decide(entry, HistoryEnabled(db));
            if (change == Change.None) return change;

            if (change != Change.Marked)
            {
                entry.CreateBackup(db);
                Apply(entry, change);
                entry.Touch(true, false);
                entry.MaintainBackups(db);
            }
            // Merker = abgeglichener Stand (beide Formate tragen jetzt denselben Schlüssel)
            OtpParams now = FromUri(entry.Strings.ReadSafe(Totp.OtpField)) ?? FromNative(entry.Strings);
            entry.CustomData.Set(SyncedKey, Fingerprint(now));
            return change;
        }

        internal static bool HistoryEnabled(PwDatabase db)
        {
            return db != null && db.HistoryMaxItems != 0;
        }

        // Was zu tun ist, ohne etwas zu ändern
        internal static Change Decide(PwEntry entry, bool historyEnabled)
        {
            string otpRaw = entry.Strings.ReadSafe(Totp.OtpField);
            OtpParams fromOtp = FromUri(otpRaw);
            OtpParams fromNative = FromNative(entry.Strings);
            if (fromOtp == null && fromNative == null) return Change.None;
            // Ein Format, das sich nicht auswerten lässt (z. B. kaputte URI), fassen wir nicht an
            if (fromOtp == null && otpRaw.Trim().Length > 0) return Change.None;
            if (fromNative == null && NativeSignature(entry.Strings).Length > 0) return Change.None;

            if (fromOtp == null) return Change.AddedOtp;
            if (fromNative == null) return fromOtp.FitsKeePass ? Change.AddedNative : Change.None;

            string synced = entry.CustomData.Get(SyncedKey) ?? "";
            if (fromOtp.SameKeyAs(fromNative))
                return synced == Fingerprint(fromOtp) ? Change.None : Change.Marked;

            // Verschieden: zuerst der Merker, dann die Chronik
            Winner winner = Winner.Unknown;
            if (synced.Length > 0)
            {
                bool otpChanged = Fingerprint(fromOtp) != synced;
                bool nativeChanged = Fingerprint(fromNative) != synced;
                if (otpChanged && !nativeChanged) winner = Winner.Otp;
                else if (nativeChanged && !otpChanged) winner = Winner.Native;
            }
            if (winner == Winner.Unknown) winner = ChangedLastInHistory(entry);
            // Unklar: nur mit Chronik (Kopie des anderen Stands) "otp" nehmen, das schreiben alle Apps
            if (winner == Winner.Unknown)
            {
                if (!historyEnabled) return Change.None;
                winner = Winner.Otp;
            }
            if (winner == Winner.Native) return Change.OtpFromNative;
            return fromOtp.FitsKeePass ? Change.NativeFromOtp : Change.None;
        }

        internal enum Winner { Unknown, Otp, Native }

        // Chronik vom neuesten Stand rückwärts: welches Format hat sich zuletzt geändert? Beide in derselben Version
        // oder keine Änderung zu finden: unbekannt
        internal static Winner ChangedLastInHistory(PwEntry entry)
        {
            string otpNow = entry.Strings.ReadSafe(Totp.OtpField);
            string nativeNow = NativeSignature(entry.Strings);
            PwObjectList<PwEntry> history = entry.History;
            for (int i = (int)history.UCount - 1; i >= 0; i--)
            {
                PwEntry old = history.GetAt((uint)i);
                bool otpDiffers = old.Strings.ReadSafe(Totp.OtpField) != otpNow;
                bool nativeDiffers = NativeSignature(old.Strings) != nativeNow;
                if (otpDiffers && nativeDiffers) return Winner.Unknown;
                if (otpDiffers) return Winner.Otp;
                if (nativeDiffers) return Winner.Native;
            }
            return Winner.Unknown;
        }

        private static void Apply(PwEntry entry, Change change)
        {
            switch (change)
            {
                case Change.AddedNative:
                case Change.NativeFromOtp:
                    WriteNative(entry.Strings, FromUri(entry.Strings.ReadSafe(Totp.OtpField)));
                    break;
                case Change.AddedOtp:
                case Change.OtpFromNative:
                    string uri = BuildUri(FromNative(entry.Strings), entry.Strings.ReadSafe(PwDefs.TitleField),
                        entry.Strings.ReadSafe(PwDefs.UserNameField));
                    entry.Strings.Set(Totp.OtpField, new ProtectedString(true, uri));
                    break;
            }
        }

        /// <summary>Alle Einträge einer Datenbank außer dem Papierkorb; Anzahl der geänderten</summary>
        internal static int SyncDatabase(PwDatabase db)
        {
            if (!IsActive(db)) return 0;
            PwGroup recycleBin = db.RecycleBinEnabled ? db.RootGroup.FindGroup(db.RecycleBinUuid, true) : null;
            int changed = 0;
            foreach (PwEntry e in db.RootGroup.GetEntries(true))
            {
                if (recycleBin != null && e.IsContainedIn(recycleBin)) continue;
                if (Sync(e, db) != Change.None) changed++;
            }
            if (changed > 0) db.Modified = true;
            return changed;
        }

        /// <summary>
        /// Stand nach dem Abgleich als Anzahlen für das Diagnoseprotokoll (keine Namen, keine Schlüssel):
        /// gleich = beide Formate mit demselben Schlüssel, nurOtp = KeePass kann ihn nicht (Steam, mehr als 8 Stellen),
        /// verschieden = offen gelassen (unklar, ohne Chronik), unlesbar = ein Format lässt sich nicht auswerten
        /// </summary>
        internal static string Summary(PwDatabase db)
        {
            int gleich = 0, nurOtp = 0, verschieden = 0, unlesbar = 0, andere = 0;
            PwGroup recycleBin = db.RecycleBinEnabled ? db.RootGroup.FindGroup(db.RecycleBinUuid, true) : null;
            foreach (PwEntry e in db.RootGroup.GetEntries(true))
            {
                if (recycleBin != null && e.IsContainedIn(recycleBin)) continue;
                string otpRaw = e.Strings.ReadSafe(Totp.OtpField);
                bool hasNative = NativeSignature(e.Strings).Length > 0;
                if (otpRaw.Trim().Length == 0 && !hasNative) continue;
                OtpParams fromOtp = FromUri(otpRaw);
                OtpParams fromNative = FromNative(e.Strings);
                if ((otpRaw.Trim().Length > 0 && fromOtp == null) || (hasNative && fromNative == null)) unlesbar++;
                else if (fromOtp != null && fromNative != null) { if (fromOtp.SameKeyAs(fromNative)) gleich++; else verschieden++; }
                else if (fromOtp != null && !fromOtp.FitsKeePass) nurOtp++;
                else andere++;
            }
            return "{\"gleich\":" + gleich + ",\"nurOtp\":" + nurOtp + ",\"verschieden\":" + verschieden
                   + ",\"unlesbar\":" + unlesbar + ",\"einFormatFehlt\":" + andere + "}";
        }

        internal static string Base32Encode(byte[] data)
        {
            const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            var sb = new StringBuilder();
            int buffer = 0, bits = 0;
            foreach (byte b in data)
            {
                buffer = (buffer << 8) | b;
                bits += 8;
                while (bits >= 5)
                {
                    sb.Append(alphabet[(buffer >> (bits - 5)) & 31]);
                    bits -= 5;
                }
            }
            if (bits > 0) sb.Append(alphabet[(buffer << (5 - bits)) & 31]);
            return sb.ToString();
        }
    }
}
