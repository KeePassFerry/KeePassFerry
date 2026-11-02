using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

namespace KeePassFerry
{
    /// <summary>
    /// Registrierbare Domain eines Hostnamens nach der Public Suffix List (Mozilla, https://publicsuffix.org,
    /// MPL-2.0): login.amazon.co.uk → amazon.co.uk, max.github.io bleibt max.github.io.
    /// Dieselbe Datei wie in der Erweiterung (extension/src/common/siteData/public_suffix_list.dat), beim Bauen
    /// eingebettet; aktualisiert mit extension/scripts/update-public-suffix-list.ts. Kein Download zur Laufzeit.
    /// Ersetzt DomainPublicSuffix.dll (gleiche Schnittstelle: TryParse, Hostname, RegistrableDomain).
    /// </summary>
    public sealed class DomainName
    {
        private const string ResourceName = "KeePassFerry.public_suffix_list.dat";

        /// <summary>Hostname in Kleinbuchstaben (wie übergeben, auch mit abschließendem Punkt)</summary>
        public string Hostname { get; private set; }

        /// <summary>Öffentliche Endung plus ein Label; null bei IP-Adressen</summary>
        public string RegistrableDomain { get; private set; }

        private DomainName(string hostname, string registrableDomain)
        {
            Hostname = hostname;
            RegistrableDomain = registrableDomain;
        }

        private static readonly object Sync = new object();
        private static HashSet<string> _rules;
        private static HashSet<string> _wildcards;
        private static HashSet<string> _exceptions;
        private static readonly IdnMapping Idn = new IdnMapping();

        /// <summary>
        /// false: leer, ungültig oder selbst eine öffentliche Endung (z. B. "co.uk", "github.io"). IP-Adressen ergeben
        /// ein Ergebnis ohne registrierbare Domain (die frühere DLL lieferte etwa "0.1" für 192.168.0.1, womit Einträge
        /// für verschiedene IP-Adressen auf Domain-Ebene als gleich galten).
        /// </summary>
        public static bool TryParse(string hostname, out DomainName result)
        {
            result = null;
            if (string.IsNullOrWhiteSpace(hostname)) return false;
            string host = hostname.Trim().ToLowerInvariant();
            bool trailingDot = host.EndsWith(".");
            string bare = host.TrimEnd('.');
            if (bare.Length == 0) return false;

            IPAddress ip;
            if (bare.StartsWith("[") || IPAddress.TryParse(bare, out ip))
            {
                result = new DomainName(host, null);
                return true;
            }

            string[] labels = bare.Split('.');
            foreach (string label in labels)
                if (label.Length == 0) return false;

            // Einzelner Name ohne Punkt (localhost, Rechnername): gültig, aber ohne registrierbare Domain (wie die DLL)
            if (labels.Length == 1)
            {
                result = new DomainName(host, null);
                return true;
            }

            string[] ascii = new string[labels.Length];
            for (int i = 0; i < labels.Length; i++) ascii[i] = ToAscii(labels[i]);

            int suffixLabels = PublicSuffixLabelCount(ascii);
            if (suffixLabels >= labels.Length) return false;

            string registrable = string.Join(".", labels, labels.Length - suffixLabels - 1, suffixLabels + 1);
            result = new DomainName(host, trailingDot ? registrable + "." : registrable);
            return true;
        }

        // Anzahl der Labels der vorherrschenden Regel (https://publicsuffix.org/list/ → Algorithm):
        // eine passende Ausnahme (!) gewinnt immer, sonst die längste passende Regel, sonst "*" (ein Label)
        private static int PublicSuffixLabelCount(string[] labels)
        {
            EnsureLoaded();
            int n = labels.Length;
            for (int i = 0; i < n; i++)
            {
                if (_exceptions.Contains(Join(labels, i))) return n - i - 1;
            }
            int best = 1;
            for (int i = 0; i < n; i++)
            {
                int length = n - i;
                if (length <= best) break;
                if (_rules.Contains(Join(labels, i)) || (i + 1 < n && _wildcards.Contains(Join(labels, i + 1))))
                    best = length;
            }
            return best;
        }

        private static string Join(string[] labels, int from)
        {
            return string.Join(".", labels, from, labels.Length - from);
        }

        private static string ToAscii(string label)
        {
            foreach (char c in label)
            {
                if (c > 127)
                {
                    try
                    {
                        return Idn.GetAscii(label);
                    }
                    catch (ArgumentException)
                    {
                        return label;
                    }
                }
            }
            return label;
        }

        private static void EnsureLoaded()
        {
            if (_rules != null) return;
            lock (Sync)
            {
                if (_rules != null) return;
                var rules = new HashSet<string>(StringComparer.Ordinal);
                var wildcards = new HashSet<string>(StringComparer.Ordinal);
                var exceptions = new HashSet<string>(StringComparer.Ordinal);
                using (Stream stream = typeof(DomainName).Assembly.GetManifestResourceStream(ResourceName))
                {
                    if (stream != null)
                    {
                        using (var reader = new StreamReader(stream, Encoding.UTF8))
                        {
                            string line;
                            while ((line = reader.ReadLine()) != null)
                            {
                                line = line.Trim();
                                if (line.Length == 0 || line.StartsWith("//")) continue;
                                int space = line.IndexOfAny(new[] { ' ', '\t' });
                                string rule = (space > 0 ? line.Substring(0, space) : line).ToLowerInvariant();
                                if (rule.StartsWith("!"))
                                    exceptions.Add(RuleToAscii(rule.Substring(1)));
                                else if (rule.StartsWith("*."))
                                    wildcards.Add(RuleToAscii(rule.Substring(2)));
                                else
                                    rules.Add(RuleToAscii(rule));
                            }
                        }
                    }
                }
                _wildcards = wildcards;
                _exceptions = exceptions;
                _rules = rules;
            }
        }

        private static string RuleToAscii(string rule)
        {
            string[] parts = rule.Split('.');
            for (int i = 0; i < parts.Length; i++) parts[i] = ToAscii(parts[i]);
            return string.Join(".", parts);
        }

        /// <summary>Anzahl der geladenen Regeln (für Tests und das Diagnoseprotokoll)</summary>
        public static int RuleCount
        {
            get
            {
                EnsureLoaded();
                return _rules.Count + _wildcards.Count + _exceptions.Count;
            }
        }
    }
}
