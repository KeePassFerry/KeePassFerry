using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Forms;
using Jayrock.Json.Conversion;
using KeePassLib;
using KeePassLib.Collections;
using KeePassFerry.Models;
using KeePassFerry.Models.Persistent;
using KeePassFerry.Models.Shared;

namespace KeePassFerry
{
    public static class Extensions
    {
        /// <summary>
        /// Zusätzliche Adressen aus Zeichenfolgenfeldern des Eintrags (Issue #41), wie andere KeePass-Programme sie
        /// ablegen: "KP2A_URL", "KP2A_URL_1" … (Keepass2Android, KeePassXC) und Felder, deren Name mit "URL" beginnt
        /// (KeePassNatMsg, z. B. "URL2"). Das Standardfeld "URL" selbst zählt nicht dazu. Nur Werte ohne Leerraum.
        /// </summary>
        public static List<string> AdditionalUrlStrings(this PwEntry entry)
        {
            var result = new List<string>();
            foreach (KeyValuePair<string, KeePassLib.Security.ProtectedString> field in entry.Strings)
            {
                string name = field.Key;
                if (name == PwDefs.UrlField) continue;
                if (!name.StartsWith("KP2A_URL", StringComparison.OrdinalIgnoreCase)
                    && !name.StartsWith("URL", StringComparison.OrdinalIgnoreCase))
                    continue;
                string value = field.Value.ReadString().Trim();
                if (value.Length == 0 || value.Any(char.IsWhiteSpace)) continue;
                if (!result.Contains(value)) result.Add(value);
            }
            return result;
        }

        // Speicherorte von KeePassFerry: Einstellungen je Eintrag und je Datenbank (benutzerdefinierte Daten)
        internal const string EntryConfigKey = "KeePassFerry.Entry";
        internal const string DatabaseConfigKey = "KeePassFerry.Config";

        // Einmalige Übernahme aus Kee/KeePassRPC (Vorlage dieses Projekts). Die Kee-Daten werden nur hier gelesen und
        // nie verändert. Kann in einer späteren Version samt ImportKeeSettingsOnce entfallen.
        private const string KeeEntryConfigKey = "KPRPC JSON";
        private const string KeeDatabaseConfigKey = "KeePassRPC.Config";
        private const string KeeRootUuidKey = "KeePassRPC.KeeFox.rootUUID";
        private const string KeeImportedKey = "KeePassFerry.KeeImported";
        private const string KeeCheckedFlag = "KEEFOX_CHECKED_FLAG_";

        // Wert angehakter Kontrollkästchen in Formularfeldern; von Kee übernommene Werte werden beim Lesen übersetzt
        private static string NormaliseCheckedFlags(string json)
        {
            return json.IndexOf(KeeCheckedFlag, StringComparison.Ordinal) < 0 ? json : json.Replace(KeeCheckedFlag, "KEEPASSFERRY_CHECKED_");
        }

        // Hat der Eintrag eigene Einstellungen?
        public static bool HasFerryConfig(this PwEntry entry, StringDictionaryEx customData = null)
        {
            return (customData ?? entry.CustomData).Exists(EntryConfigKey);
        }

        public static EntryConfigv2 GetFerryConfigNormalised(this PwEntry entry, ref List<string> configErrors, MatchAccuracyMethod mam)
        {
            string json = entry.CustomData.Get(EntryConfigKey);
            if (string.IsNullOrEmpty(json)) return new EntryConfigv1(mam).ConvertToV2(new GuidService());
            json = NormaliseCheckedFlags(json);
            try
            {
                return (EntryConfigv2)JsonConvert.Import(typeof(EntryConfigv2), json);
            }
            catch (Exception)
            {
                var url = entry.Strings.ReadSafe("URL");
                if (string.IsNullOrEmpty(url))
                    url = "<unknown>";
                if (configErrors != null)
                {
                    string entryUserName = entry.Strings.ReadSafe(PwDefs.UserNameField);
                    configErrors.Add("Username: " + entryUserName + ". URL: " + url);
                }
                else
                {
                    Utils.ShowMonoSafeMessageBox(FerryText.T("Die KeePassFerry-Einstellungen dieses Eintrags sind fehlerhaft (benutzerdefinierte Daten „" + EntryConfigKey + "“). Bitte korrigiere sie oder melde das Problem auf https://github.com/KeePassFerry/KeePassFerry/issues. URL des Eintrags: ", "The KeePassFerry settings of this entry are invalid (custom data '" + EntryConfigKey + "'). Please correct them or report the problem at https://github.com/KeePassFerry/KeePassFerry/issues. URL of the entry: ") + url + FerryText.T(" – Daten: ", " – data: ") + json, FerryText.T("KeePassFerry: fehlerhafte Einstellungen", "KeePassFerry: invalid settings"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return null;
            }
        }

        public static EntryConfigv2 GetFerryConfigNormalised(this PwEntry entry, MatchAccuracyMethod mam)
        {
            List<string> dummy = null;
            return entry.GetFerryConfigNormalised(ref dummy, mam);
        }

        // Aufrufe aus der Zeit, als Einstellungen auch im Textfeld des Eintrags lagen (Textfelder spielen keine Rolle mehr)
        public static EntryConfigv2 GetFerryConfigNormalised(this PwEntry entry, ProtectedStringDictionary strings,
            ref List<string> configErrors, MatchAccuracyMethod mam)
        {
            return entry.GetFerryConfigNormalised(ref configErrors, mam);
        }

        public static EntryConfigv2 GetFerryConfigNormalised(this PwEntry entry, ProtectedStringDictionary strings, MatchAccuracyMethod mam)
        {
            List<string> dummy = null;
            return entry.GetFerryConfigNormalised(ref dummy, mam);
        }

        public static void SetFerryConfig(this PwEntry entry, EntryConfigv1 newConfig)
        {
            entry.SetFerryConfig(newConfig.ConvertToV2(new GuidService()));
        }

        public static void SetFerryConfig(this PwEntry entry, EntryConfigv2 newConfig)
        {
            entry.CustomData.Set(EntryConfigKey, JsonConvert.ExportToString(newConfig));
        }

        // Mit schon gelesener Eintragskonfiguration (Suche über viele Adressen: nicht je Adresse neu einlesen)
        public static MatchAccuracyMethod GetMatchAccuracyMethod(EntryConfigv2 conf, URLSummary urlsum)
        {
            MatchAccuracyMethod overridenMethod;
            if (urlsum.Domain != null && urlsum.Domain.RegistrableDomain != null &&
                MatchAccuracySettings.TryGetOverride(urlsum.Domain.RegistrableDomain, out overridenMethod))
                return overridenMethod;
            return conf.MatcherConfigs.First(mc => mc.MatcherType == EntryMatcherType.Url).UrlMatchMethod ?? MatchAccuracyMethod.Domain;
        }

        // Einstellungen der Datenbank, sonst Standard (Lesen ändert nichts)
        public static DatabaseConfig GetFerryConfig(this PwDatabase db)
        {
            string json = db.CustomData.Get(DatabaseConfigKey);
            if (string.IsNullOrEmpty(json)) return new DatabaseConfig();
            try
            {
                return (DatabaseConfig)JsonConvert.Import(typeof(DatabaseConfig), json);
            }
            catch (Exception)
            {
                // Beschädigt: Standard (wird beim nächsten Speichern der Einstellungen ersetzt)
                return new DatabaseConfig();
            }
        }

        public static void SetFerryConfig(this PwDatabase db, DatabaseConfig newConfig)
        {
            db.CustomData.Set(DatabaseConfigKey, JsonConvert.ExportToString(newConfig));
        }

        /// <summary>
        /// Einmal je Datenbank: Einstellungen aus Kee/KeePassRPC in die eigenen Felder kopieren (Eintrag: "KPRPC JSON" als
        /// benutzerdefinierte Daten oder altes Textfeld; Datenbank: "KeePassRPC.Config" bzw. die freigegebene Gruppe aus
        /// KeeFox). Kee-Daten bleiben unverändert, vorhandene eigene Einstellungen gewinnen, Chronik wird nicht berührt.
        /// true, wenn die Datenbank dadurch geändert wurde (Merker gesetzt, ggf. Einstellungen übernommen).
        /// summary: Ergebnis als JSON für das Diagnoseprotokoll (Datenbank-Einstellungen, Zahl der Einträge).
        /// </summary>
        internal static bool ImportKeeSettingsOnce(PwDatabase db, out string summary)
        {
            summary = null;
            if (db == null || !db.IsOpen || db.CustomData.Exists(KeeImportedKey)) return false;

            string dbResult = "keine";
            if (db.CustomData.Exists(DatabaseConfigKey))
            {
                dbResult = "eigene vorhanden";
            }
            else
            {
                string keeDb = db.CustomData.Get(KeeDatabaseConfigKey);
                if (!string.IsNullOrEmpty(keeDb))
                {
                    try
                    {
                        db.SetFerryConfig((DatabaseConfig)JsonConvert.Import(typeof(DatabaseConfig), keeDb));
                        dbResult = "übernommen";
                    }
                    catch (Exception)
                    {
                        // beschädigt: Standard
                        dbResult = "fehlerhaft";
                    }
                }
                else if (db.CustomData.Exists(KeeRootUuidKey))
                {
                    db.SetFerryConfig(new DatabaseConfig { RootUUID = db.CustomData.Get(KeeRootUuidKey) });
                    dbResult = "freigegebene Gruppe übernommen";
                }
            }

            int imported = 0, alreadyOwn = 0, invalid = 0, total = 0;

            foreach (PwEntry entry in db.RootGroup.GetEntries(true))
            {
                total++;
                if (entry.CustomData.Exists(EntryConfigKey))
                {
                    alreadyOwn++;
                    continue;
                }
                try
                {
                    string v2 = entry.CustomData.Get(KeeEntryConfigKey);
                    if (!string.IsNullOrEmpty(v2))
                    {
                        entry.SetFerryConfig((EntryConfigv2)JsonConvert.Import(typeof(EntryConfigv2), NormaliseCheckedFlags(v2)));
                        imported++;
                        continue;
                    }
                    string v1 = entry.Strings.ReadSafe(KeeEntryConfigKey);
                    if (!string.IsNullOrEmpty(v1))
                    {
                        entry.SetFerryConfig((EntryConfigv1)JsonConvert.Import(typeof(EntryConfigv1), NormaliseCheckedFlags(v1)));
                        imported++;
                    }
                }
                catch (Exception)
                {
                    // beschädigte Kee-Daten: Eintrag behält die Standardeinstellungen
                    invalid++;
                }
            }

            db.CustomData.Set(KeeImportedKey, DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture));
            summary = "{\"datenbank\":\"" + System.IO.Path.GetFileName(db.IOConnectionInfo.Path).Replace("\\", "\\\\").Replace("\"", "\\\"")
                + "\",\"dbEinstellungen\":\"" + dbResult + "\",\"eintraege\":" + total + ",\"uebernommen\":" + imported
                + ",\"schonEigene\":" + alreadyOwn + ",\"fehlerhaft\":" + invalid + "}";
            return true;
        }

        public static bool IsOrIsContainedIn(this PwGroup gp, PwGroup hostGroup)
        {
            if (gp == hostGroup) return true;
            return gp.IsContainedIn(hostGroup);
        }

    }
}
