using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using KeePass.App.Configuration;
using KeePassLib;
using KeePassFerry.Models.Shared;

namespace KeePassFerry
{
    /// <summary>
    /// Genauigkeit des URL-Abgleichs: Standard für neue Einträge und Ausnahmen je Domain. Gilt für alle Datenbanken auf
    /// diesem PC (KeePass-Konfiguration, Extras → KeePassFerry-Optionen), damit eine Ausnahme nicht in jeder Datenbank
    /// gepflegt werden muss. Frühere Werte lagen in der Datenbank; sie werden je Datenbank einmal übernommen und dort nicht
    /// verändert (ältere Plugin-Versionen lesen sie weiter).
    /// </summary>
    internal static class MatchAccuracySettings
    {
        private const string KeyDefault = "KeePassFerry.MatchAccuracyDefault";
        private const string KeyOverrides = "KeePassFerry.MatchAccuracyOverrides";
        private const string KeyImportedPrefix = "KeePassFerry.MatchAccuracyImported.";

        private static AceCustomConfig _config;
        private static volatile Dictionary<string, MatchAccuracyMethod> _overrides = new Dictionary<string, MatchAccuracyMethod>();
        private static MatchAccuracyMethod _default = MatchAccuracyMethod.Domain;

        internal static void Init(AceCustomConfig config)
        {
            _config = config;
            MatchAccuracyMethod stored;
            _default = Enum.TryParse(config.GetString(KeyDefault, ""), out stored) ? stored : MatchAccuracyMethod.Domain;
            _overrides = ParseOverrides(config.GetString(KeyOverrides, ""));
        }

        internal static MatchAccuracyMethod Default
        {
            get { return _default; }
        }

        internal static bool TryGetOverride(string registrableDomain, out MatchAccuracyMethod method)
        {
            return _overrides.TryGetValue(registrableDomain, out method);
        }

        internal static Dictionary<string, MatchAccuracyMethod> CopyOverrides()
        {
            return new Dictionary<string, MatchAccuracyMethod>(_overrides);
        }

        internal static void Save(MatchAccuracyMethod defaultMethod, Dictionary<string, MatchAccuracyMethod> overrides)
        {
            _default = defaultMethod;
            _overrides = new Dictionary<string, MatchAccuracyMethod>(overrides);
            if (_config == null) return;
            _config.SetString(KeyDefault, defaultMethod.ToString());
            _config.SetString(KeyOverrides, FormatOverrides(overrides));
        }

        /// <summary>Werte dieser Datenbank einmal übernehmen; liefert die Anzahl der Änderungen</summary>
        internal static int ImportOnce(PwDatabase db)
        {
            if (_config == null) return 0;
            string key = KeyImportedPrefix + PathHash(db.IOConnectionInfo.Path);
            if (_config.GetBool(key, false)) return 0;
            _config.SetBool(key, true);

            DatabaseConfig dbConfig = db.GetFerryConfig();
            MatchAccuracyMethod mergedDefault = Stricter(_default, dbConfig.DefaultMatchAccuracy);
            Dictionary<string, MatchAccuracyMethod> merged = CopyOverrides();
            int changes = MergeOverrides(merged, dbConfig.MatchedURLAccuracyOverrides);
            if (mergedDefault != _default) changes++;
            if (changes > 0) Save(mergedDefault, merged);
            return changes;
        }

        // Die strengere Einstellung gewinnt: lieber einen Eintrag zu wenig vorschlagen als auf einer fremden Subdomain
        internal static MatchAccuracyMethod Stricter(MatchAccuracyMethod a, MatchAccuracyMethod b)
        {
            return (int)a >= (int)b ? a : b;
        }

        internal static int MergeOverrides(Dictionary<string, MatchAccuracyMethod> target, Dictionary<string, MatchAccuracyMethod> incoming)
        {
            if (incoming == null) return 0;
            int changes = 0;
            foreach (KeyValuePair<string, MatchAccuracyMethod> item in incoming)
            {
                MatchAccuracyMethod current;
                if (target.TryGetValue(item.Key, out current) && Stricter(current, item.Value) == current) continue;
                target[item.Key] = item.Value;
                changes++;
            }
            return changes;
        }

        // Domains enthalten weder "=" noch ";"
        internal static string FormatOverrides(Dictionary<string, MatchAccuracyMethod> overrides)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, MatchAccuracyMethod> item in overrides) parts.Add(item.Key + "=" + item.Value);
            return string.Join(";", parts.ToArray());
        }

        internal static Dictionary<string, MatchAccuracyMethod> ParseOverrides(string text)
        {
            var result = new Dictionary<string, MatchAccuracyMethod>();
            foreach (string part in (text ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                int separator = part.IndexOf('=');
                MatchAccuracyMethod method;
                if (separator > 0 && Enum.TryParse(part.Substring(separator + 1), out method))
                    result[part.Substring(0, separator)] = method;
            }
            return result;
        }

        private static string PathHash(string path)
        {
            using (SHA1 sha = SHA1.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes((path ?? "").ToLowerInvariant()));
                return BitConverter.ToString(hash, 0, 8).Replace("-", "");
            }
        }
    }
}
