using System;
using System.Globalization;
using System.Text.RegularExpressions;
using KeePassLib;

namespace KeePassFerry
{
    /// <summary>
    /// Status-Feld im Format des Plugins "HIBP Offline Check" (https://github.com/mihaifm/HIBPOfflineCheck): Name und
    /// Texte aus dessen Optionen, Standard "Have I been pwned?" = "Pwned" bzw. "Secure", mit Zusatz
    /// " (password count: N)". Geschrieben von HIBP Offline Check oder der eigenen Prüfung (HibpChecker).
    /// </summary>
    internal static class HibpStatus
    {
        private const string ConfigColumnName = "HIBPOfflineCheck.ColumnName";
        private const string ConfigInsecureText = "HIBPOfflineCheck.InsecureText";
        private const string ConfigSecureText = "HIBPOfflineCheck.SecureText";
        private const string ConfigBreachCountDetails = "HIBPOfflineCheck.BreachCountDetails";
        private const string DefaultColumnName = "Have I been pwned?";
        private const string DefaultInsecureText = "Pwned";
        private const string DefaultSecureText = "Secure";
        private static readonly Regex CountPattern = new Regex(@"password count:\s*([0-9]+)", RegexOptions.IgnoreCase);

        private static string Config(string key, string fallback)
        {
            try
            {
                string v = KeePass.Program.Config.CustomConfig.GetString(key);
                return string.IsNullOrEmpty(v) ? fallback : v;
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        internal static string ColumnName { get { return Config(ConfigColumnName, DefaultColumnName); } }
        internal static string InsecureText { get { return Config(ConfigInsecureText, DefaultInsecureText); } }
        internal static string SecureText { get { return Config(ConfigSecureText, DefaultSecureText); } }

        // Wie HIBP Offline Check: Anzahl nur, wenn dort eingeschaltet; ohne dessen Einstellung mit Anzahl
        internal static string LeakedText(int count)
        {
            bool details = Config(ConfigBreachCountDetails, "true").Equals("true", StringComparison.OrdinalIgnoreCase);
            return details ? InsecureText + " (password count: " + count.ToString(CultureInfo.InvariantCulture) + ")" : InsecureText;
        }

        // Im Browser angezeigt wird das Ergebnis nur bei eingeschalteter Prüfung von KeePassFerry (aus = für KeePassFerry
        // aus, auch wenn "HIBP Offline Check" das Feld in KeePass weiter pflegt)
        internal static bool ShowResults
        {
            get { return KeePass.Program.Config.CustomConfig.GetBool(HibpChecker.ConfigEnabled, false); }
        }

        internal static bool StatusIsLeaked(string value)
        {
            string insecure = InsecureText;
            return !string.IsNullOrEmpty(insecure) && (value ?? "").Trim().StartsWith(insecure, StringComparison.Ordinal);
        }

        // Statusfeld (nicht als eigener Zusatz anzeigen oder ändern)
        internal static bool IsStatusField(string name)
        {
            return string.Equals(name, ColumnName, StringComparison.Ordinal);
        }

        internal static bool IsLeaked(PwEntry entry, out int count)
        {
            count = 0;
            try
            {
                string value = entry.Strings.ReadSafe(ColumnName).Trim();
                if (!StatusIsLeaked(value)) return false;
                Match m = CountPattern.Match(value);
                if (m.Success) int.TryParse(m.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out count);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
