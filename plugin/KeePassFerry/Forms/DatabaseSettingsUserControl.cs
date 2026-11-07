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
            label8.Text = FerryText.T("Platzhalter können Informationen aus deiner Datenbank an Websites weitergeben, etwa an eine manipulierte Seite. Schalte das nur ein, wenn du Platzhalter in Formularfeldern wirklich brauchst.",
                "Placeholders can pass information from your database to websites, for example to a manipulated page. Only enable this if you really need placeholders in form fields.");
            PresentDefaultPlaceholderHandling();
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            // Übersetzte Texte sind länger als die englischen Designer-Texte
            FerryLayout.Row(radioButton7.Height, radioButton8, radioButton7);
            // Erst die Erklärung, darunter der Warnhinweis
            linkLabel1.Top = label8.Top;
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
