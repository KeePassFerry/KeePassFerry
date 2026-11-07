using System;
using System.Windows.Forms;
using KeePassLib;
using KeePassFerry.Models.Shared;

namespace KeePassFerry.Forms
{
    // Was zur Datenbank gehört. Die Genauigkeit des URL-Abgleichs liegt seit 1.0.22 in den KeePassFerry-Optionen
    public partial class DatabaseSettingsUserControl : UserControl
    {
        private PwDatabase database;
        private DatabaseConfig config;
        private string configOnOpen;

        public DatabaseSettingsUserControl(PwDatabase db)
        {
            database = db;
            config = db.GetFerryConfig();
            configOnOpen = Jayrock.Json.Conversion.JsonConvert.ExportToString(config);
            InitializeComponent();
            FerryText.Localize(this);
            // Erklärung statt Link (früher Kee-Forum)
            linkLabel1.LinkArea = new LinkArea(0, 0);
            linkLabel1.AutoSize = false;
            linkLabel1.Text = FerryText.T("Steht in einem Feld ein Platzhalter wie {USERNAME}, {S:Feld} oder ein Verweis auf einen anderen Eintrag, entscheidet diese Einstellung, was der Browser bekommt:\n\nDeaktiviert: den Text genau so, wie er im Feld steht.\nAktiviert: den echten Wert, zum Beispiel das Passwort aus dem anderen Eintrag.",
                "If a field contains a placeholder such as {USERNAME}, {S:Field} or a reference to another entry, this setting decides what the browser gets:\n\nDisabled: the text exactly as it is in the field.\nEnabled: the real value, for example the password from the other entry.");
            label8.Text = FerryText.T("Lass die Einstellung deaktiviert, wenn du keine Platzhalter verwendest. Aktiviert kann eine manipulierte Seite mehr Daten aus deiner Datenbank erhalten. Für ein einzelnes Feld stellst du das im Eintrag ein (Reiter KeePassFerry).",
                "Leave this disabled if you don't use placeholders. When enabled, a manipulated page can get more data from your database. To set this for a single field, use the entry's KeePassFerry tab.");
            PresentDefaultPlaceholderHandling();
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            // Übersetzte Texte sind länger als die englischen Designer-Texte
            FerryLayout.Row(radioButton7.Height, radioButton8, radioButton7);
            // Erst die Erklärung, darunter der Warnhinweis
            linkLabel1.Top = label8.Top;
            linkLabel1.Height = linkLabel1.GetPreferredSize(new System.Drawing.Size(linkLabel1.Width, 0)).Height;
            label8.Top = linkLabel1.Bottom + linkLabel1.Font.Height;
            if (ParentForm != null)
            {
                ParentForm.FormClosing +=
                  delegate
                  {
                      if (ParentForm.DialogResult == DialogResult.OK)
                      {
                          config.DefaultPlaceholderHandling = DetermineDefaultPlaceholderHandling();
                          // Nur speichern, wenn sich etwas geändert hat (sonst bekäme jede neue Datenbank Standardwerte)
                          if (Jayrock.Json.Conversion.JsonConvert.ExportToString(config) != configOnOpen)
                              database.SetFerryConfig(config);
                      }
                  };
            }
        }

        private void PresentDefaultPlaceholderHandling()
        {
            if (config.DefaultPlaceholderHandling == PlaceholderHandling.Enabled) radioButton8.Checked = true;
            else radioButton7.Checked = true;
        }

        private PlaceholderHandling DetermineDefaultPlaceholderHandling()
        {
            if (radioButton8.Checked) return PlaceholderHandling.Enabled;
            return PlaceholderHandling.Disabled;
        }
    }
}
