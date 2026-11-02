using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows.Forms;

namespace KeePassFerry
{
    /// <summary>
    /// Sichtbare Texte des Plugins in Deutsch oder Englisch.
    /// Maßgeblich ist die Sprache von KeePass, ohne Übersetzung die Windows-Sprache.
    /// Fenster aus dem Designer enthalten die englischen Texte; Localize ersetzt sie bei deutscher Sprache.
    /// </summary>
    internal static class FerryText
    {
        internal static bool German
        {
            get
            {
                try
                {
                    string kp = KeePass.Program.Translation != null && KeePass.Program.Translation.Properties != null
                        ? KeePass.Program.Translation.Properties.Iso6391Code
                        : null;
                    if (!string.IsNullOrEmpty(kp)) return kp.Equals("de", StringComparison.OrdinalIgnoreCase);
                }
                catch (Exception)
                {
                    // ältere KeePass-Versionen: Windows-Sprache
                }
                return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de";
            }
        }

        internal static string T(string de, string en)
        {
            return German ? de : en;
        }

        /// <summary>Deutsche Fassung eines englischen Textes (bei englischer Sprache oder ohne Eintrag unverändert)</summary>
        internal static string L(string en)
        {
            string de;
            if (en != null && German && GermanTexts.TryGetValue(en, out de)) return de;
            return en;
        }

        /// <summary>Übersetzt Texte, Spaltenköpfe und Listeneinträge eines Fensters samt aller enthaltenen Steuerelemente</summary>
        internal static void Localize(Control root)
        {
            if (root == null || !German) return;
            root.Text = L(root.Text);
            var tabPage = root as TabPage;
            if (tabPage != null) tabPage.ToolTipText = L(tabPage.ToolTipText);
            var listView = root as ListView;
            if (listView != null)
                foreach (ColumnHeader column in listView.Columns)
                    column.Text = L(column.Text);
            var comboBox = root as ComboBox;
            if (comboBox != null)
                for (int i = 0; i < comboBox.Items.Count; i++)
                {
                    var item = comboBox.Items[i] as string;
                    if (item != null) comboBox.Items[i] = L(item);
                }
            foreach (Control child in root.Controls)
                Localize(child);
        }

        private static readonly Dictionary<string, string> GermanTexts = new Dictionary<string, string>
        {
            // allgemein
            { "OK", "OK" },
            { "Cancel", "Abbrechen" },
            { "Add", "Hinzufügen" },
            { "Edit", "Bearbeiten" },
            { "Delete", "Löschen" },
            { "General", "Allgemein" },
            { "Basic KeePassFerry settings for this entry", "Grundeinstellungen von KeePassFerry für diesen Eintrag" },
            { "Which URLs should this entry match or be blocked from matching?", "Auf welche URLs soll dieser Eintrag passen, auf welche nicht?" },
            { "Define the web page form fields this entry applies to", "Formularfelder der Website, die dieser Eintrag ausfüllt" },
            { "Name", "Name" },
            { "Value", "Wert" },
            { "Id", "ID" },
            { "Type", "Typ" },
            { "Page", "Seite" },
            { "Method", "Methode" },
            { "Enable", "Aktivieren" },
            { "Disable", "Deaktivieren" },
            { "Enabled", "Aktiviert" },
            { "Disabled", "Deaktiviert" },
            { "Default", "Standard" },
            { "Never", "Nie" },
            { "Always", "Immer" },

            // Eintrag: Reiter KeePassFerry
            { "Entry behaviour", "Verhalten des Eintrags" },
            { "Auto-fill:", "Automatisch ausfüllen:" },
            { "Auto-submit:", "Automatisch absenden:" },
            { "Do not offer this entry in the browser", "Diesen Eintrag im Browser nicht anbieten" },
            { "HTTP Auth Realm:", "HTTP-Anmeldebereich:" },
            { "Set this to the realm (what the \"site says\") in the HTTP authentication popup dialog box for a more accurate match",
              "Bereich (Realm), den die Seite im Anmeldefenster des Browsers nennt – für einen genaueren Abgleich" },
            { "Form fields", "Formularfelder" },
            { "Additional URLs", "Zusätzliche URLs" },
            { "URLs", "URLs" },
            { "URL / pattern", "URL / Muster" },
            { "URL / pattern:", "URL / Muster:" },
            { "Normal", "Normal" },
            { "RegEx", "RegEx" },
            { "Match", "Zulassen" },
            { "Block", "Sperren" },
            { "KeePass username", "KeePass-Benutzername" },
            { "KeePass password", "KeePass-Passwort" },
            { "Minimum URL match accuracy", "Mindestgenauigkeit beim URL-Abgleich" },
            { "Minimum URL match accuracy:", "Mindestgenauigkeit beim URL-Abgleich:" },
            { "Exact: The URL must match exactly including full path and query string.",
              "Exakt: Die ganze URL muss gleich sein, auch Pfad und Parameter." },
            { "Hostname: The URL must match the hostname (domain and subdomains) and port.",
              "Hostname: Hostname (mit Subdomain) und Port müssen gleich sein." },
            { "Domain: The URL only needs to be part of the same domain to match.",
              "Domain: Es reicht dieselbe Domain." },
            { "You may want to choose Exact when you want to limit form filling to only certain website pages, perhaps by using additional URLs below.",
              "„Exakt“ ist sinnvoll, wenn nur auf bestimmten Seiten ausgefüllt werden soll, zum Beispiel zusammen mit zusätzlichen URLs." },
            { "When more than one entry matches, KeePassFerry prefers the more accurately matching entries. A stricter setting can exclude this entry from matching in some cases.",
              "Passen mehrere Einträge, bevorzugt KeePassFerry die genauer passenden. Eine strengere Einstellung kann diesen Eintrag in manchen Fällen ganz ausschließen." },
            { "This is the default behaviour for new entries. Change in the Database Settings dialog.",
              "Das ist die Voreinstellung für neue Einträge. Ändern kannst du sie in den Datenbankeinstellungen." },

            // URL-Regel
            { "Add URL", "URL hinzufügen" },
            { "Edit URL", "URL bearbeiten" },
            { "Regular Expression", "Regulärer Ausdruck" },
            { "A rule for '{0}' has already been added.", "Für „{0}“ gibt es bereits eine Regel." },
            { "'{0}' is not a valid regular expression. Details: {1}", "„{0}“ ist kein gültiger regulärer Ausdruck. Details: {1}" },
            { "Invalid regular expression", "Ungültiger regulärer Ausdruck" },

            // Formularfeld
            { "Add a form field", "Formularfeld hinzufügen" },
            { "Edit a form field", "Formularfeld bearbeiten" },
            { "Text", "Text" },
            { "Password", "Passwort" },
            { "Existing", "Vorhanden" },
            { "Toggle", "Schalter" },
            { "DOM selector", "DOM-Selektor" },
            { "DOM type", "DOM-Typ" },
            { "Database default", "Datenbank-Standard" },
            { "To change the value of the username field, please use the main KeePass edit tab",
              "Den Benutzernamen änderst du im Hauptreiter des KeePass-Eintrags." },
            { "To change the value of the password field, please use the main KeePass edit tab",
              "Das Passwort änderst du im Hauptreiter des KeePass-Eintrags." },
            { "Please specify a value", "Bitte gib einen Wert an." },
            { "Please change the value of this form field. {USERNAME} and {PASSWORD} are reserved for internal use by KeePassFerry.",
              "Bitte ändere den Wert dieses Formularfelds. {USERNAME} und {PASSWORD} sind für KeePassFerry reserviert." },

            // Platzhalter
            { "KeePass placeholders", "KeePass-Platzhalter" },
            { "Replace KeePass placeholders such as {USERNAME} or {S:Field} in form fields with their values before filling.",
              "KeePass-Platzhalter wie {USERNAME} oder {S:Feld} in Formularfeldern vor dem Ausfüllen durch ihre Werte ersetzen." },

            // Datenbankeinstellungen
            { "This affects new entries and entries without KeePassFerry settings.",
              "Gilt für neue Einträge und für Einträge ohne eigene KeePassFerry-Einstellungen." },
            { "Domain overrides", "Ausnahmen pro Domain" },
            { "The match accuracy will be applied to all entries when a search URL matches the specified domain name.",
              "Die Genauigkeit gilt für alle Einträge, wenn die aufgerufene Adresse zur angegebenen Domain gehört." },
            { "Domain", "Domain" },
            { "Hostname", "Hostname" },
            { "Exact", "Exakt" },
            { "Domain (e.g. google.com):", "Domain (z. B. google.com):" },
            { "Add Override", "Ausnahme hinzufügen" },
            { "Edit Override", "Ausnahme bearbeiten" },
            { "An override for '{0}' has already been added. Cancel, then find and Edit the existing override.",
              "Für „{0}“ gibt es bereits eine Ausnahme. Bearbeite stattdessen die vorhandene." },
            { "Invalid domain name", "Ungültiger Domainname" }
        };
    }
}
