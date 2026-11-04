using System;
using System.Drawing;
using System.Windows.Forms;
using KeePass.Plugins;
using KeePass.UI;
using KeePassFerry.Properties;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Optionen des Plugins (Extras → KeePassFerry-Optionen, auch per Knopf aus der Erweiterung): alles, was in KeePass
    /// wirkt und für alle Browser gilt – Speichern, Datenlecks-Prüfung, abgelaufene Einträge, gekoppelte Browser, Update.
    /// Was nur auf Webseiten wirkt (Ausfüllen, Feldsymbole …), liegt in der Browser-Erweiterung.
    /// </summary>
    public sealed class OptionsForm : Form
    {
        internal const string KeyAutoSave = "KeePassFerry.AutoSave";
        internal const string KeyEditNewEntries = "KeePassFerry.EditNewEntries";

        private readonly IPluginHost _host;
        private readonly KeePassFerryExt _plugin;
        private readonly CheckBox _autoSave;
        private readonly CheckBox _editNewEntries;
        private readonly CheckBox _hibp;
        private readonly ComboBox _expiryMode;
        private readonly ComboBox _expiryWarn;
        private readonly ListView _clients;
        private readonly Button _unpair;

        public OptionsForm(IPluginHost host, KeePassFerryExt plugin)
        {
            _host = host;
            _plugin = plugin;

            Text = FerryText.T("KeePassFerry – Optionen", "KeePassFerry – Options");
            Icon = Resources.FerryIcon;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterParent;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(560, 716);
            Font = new Font("Segoe UI", 9F);

            var hint = new Label
            {
                AutoSize = false,
                Location = new Point(16, 14),
                Size = new Size(528, 34),
                ForeColor = Color.DimGray,
                Text = FerryText.T("Hier stellst du ein, was in KeePass wirkt und für alle Browser gilt. Einstellungen für Webseiten (Ausfüllen, Feldsymbole …) findest du in der Browser-Erweiterung.",
                    "Settings that take effect in KeePass and apply to all browsers. Settings for websites (filling, field icons …) are in the browser extension.")
            };

            var general = new GroupBox
            {
                Text = FerryText.T("Allgemein", "General"),
                Location = new Point(16, 52),
                Size = new Size(528, 104)
            };
            _autoSave = NewCheckBox(general, 24,
                FerryText.T("Datenbank automatisch speichern, wenn KeePassFerry etwas ändert", "Save the database automatically when KeePassFerry changes it"));
            _editNewEntries = NewCheckBox(general, 52,
                FerryText.T("Im Browser angelegte Einträge sofort in KeePass zum Bearbeiten öffnen", "Open entries created in the browser for editing in KeePass right away"));
            _autoSave.Checked = host.CustomConfig.GetBool(KeyAutoSave, true);
            _editNewEntries.Checked = host.CustomConfig.GetBool(KeyEditNewEntries, false);

            var breaches = new GroupBox
            {
                Text = FerryText.T("Datenlecks", "Data breaches"),
                Location = new Point(16, 166),
                Size = new Size(528, 120)
            };
            _hibp = NewCheckBox(breaches, 24,
                FerryText.T("Passwörter auf Datenlecks prüfen", "Check passwords for data breaches"));
            _hibp.Checked = _plugin.Hibp != null && _plugin.Hibp.Enabled;
            _hibp.Enabled = _plugin.Hibp != null;
            breaches.Controls.Add(NewHint(48, 34, FerryText.T(
                "KeePass prüft neue und geänderte Passwörter bei „Have I Been Pwned“ und alle anderen gelegentlich erneut. Gesendet werden nur die ersten 5 Zeichen einer Prüfsumme, nie das Passwort.",
                "KeePass checks new and changed passwords at \"Have I Been Pwned\" and re-checks all others from time to time. Only the first 5 characters of a checksum are sent, never the password.")));
            breaches.Controls.Add(NewHint(86, 28, HibpProgressText()));

            var expiry = new GroupBox
            {
                Text = FerryText.T("Abgelaufene Einträge", "Expired entries"),
                Location = new Point(16, 296),
                Size = new Size(528, 120)
            };
            expiry.Controls.Add(new Label { Text = FerryText.T("Verhalten:", "Behaviour:"), AutoSize = true, Location = new Point(12, 27) });
            _expiryMode = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(150, 24), Width = 250 };
            _expiryMode.Items.AddRange(new object[] {
                FerryText.T("An Passwortwechsel erinnern", "Remind me to change the password"),
                FerryText.T("Ausblenden", "Hide") });
            _expiryMode.SelectedIndex = FerryService.HideExpired ? 1 : 0;
            expiry.Controls.Add(new Label { Text = FerryText.T("Vorwarnung:", "Advance warning:"), AutoSize = true, Location = new Point(12, 58) });
            _expiryWarn = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(150, 55), Width = 250 };
            foreach (int days in FerryService.ExpiryWarnDaysChoices)
                _expiryWarn.Items.Add(days == 0 ? FerryText.T("Keine Vorwarnung", "No advance warning")
                    : FerryText.T(days + " Tage vorher", days + " days before"));
            _expiryWarn.SelectedIndex = Array.IndexOf(FerryService.ExpiryWarnDaysChoices, FerryService.ExpiryWarnDays);
            expiry.Controls.AddRange(new Control[] { _expiryMode, _expiryWarn });
            expiry.Controls.Add(NewHint(84, 32, FerryText.T(
                "Gilt nur für Einträge mit Ablaufdatum („Gültig bis“). „Erinnern“ füllt weiter aus und weist auf einen Passwortwechsel hin; „Ausblenden“ schlägt sie im Browser nicht mehr vor.",
                "Only applies to entries with an expiry date (\"Expires\"). \"Remind\" keeps filling them in and suggests changing the password; \"Hide\" no longer offers them in the browser.")));

            var paired = new GroupBox
            {
                Text = FerryText.T("Gekoppelte Browser", "Paired browsers"),
                Location = new Point(16, 426),
                Size = new Size(528, 196)
            };
            _clients = new ListView
            {
                View = View.Details,
                FullRowSelect = true,
                HideSelection = false,
                MultiSelect = false,
                HeaderStyle = ColumnHeaderStyle.Nonclickable,
                Location = new Point(12, 24),
                Size = new Size(504, 124)
            };
            _clients.Columns.Add(FerryText.T("Browser", "Browser"), 220);
            _clients.Columns.Add(FerryText.T("Gekoppelt am", "Paired on"), 130);
            _clients.Columns.Add(FerryText.T("Zuletzt verbunden", "Last connected"), 130);
            _clients.SelectedIndexChanged += delegate { _unpair.Enabled = _clients.SelectedItems.Count > 0; };
            _unpair = new Button
            {
                Text = FerryText.T("Kopplung aufheben", "Remove pairing"),
                Location = new Point(12, 156),
                AutoSize = true,
                Enabled = false
            };
            _unpair.Click += OnUnpair;
            var pairedHint = new Label
            {
                AutoSize = false,
                Location = new Point(160, 152),
                Size = new Size(356, 36),
                ForeColor = Color.DimGray,
                Text = FerryText.T("Der Browser muss sich danach neu koppeln und den Prüfcode bestätigen.",
                    "The browser then has to pair again and confirm the verification code.")
            };
            paired.Controls.AddRange(new Control[] { _clients, _unpair, pairedHint });

            var version = new Label
            {
                AutoSize = true,
                Location = new Point(16, 638),
                Text = "KeePassFerry " + FerryUpdater.InstalledVersion
            };
            var update = new Button
            {
                Text = FerryText.T("Nach Updates suchen …", "Check for updates …"),
                AutoSize = true,
                Location = new Point(160, 632)
            };
            update.Click += delegate { _plugin.OnCheckForUpdates(this, EventArgs.Empty); };

            var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Location = new Point(362, 676), Size = new Size(88, 28) };
            var cancel = new Button
            {
                Text = FerryText.T("Abbrechen", "Cancel"),
                DialogResult = DialogResult.Cancel,
                Location = new Point(456, 676),
                Size = new Size(88, 28)
            };
            ok.Click += OnOk;

            Controls.AddRange(new Control[] { hint, general, breaches, expiry, paired, version, update, ok, cancel });
            AcceptButton = ok;
            CancelButton = cancel;
            ShowPairedClients();
        }

        private static Label NewHint(int top, int height, string text)
        {
            return new Label { AutoSize = false, Location = new Point(30, top), Size = new Size(486, height), ForeColor = Color.DimGray, Text = text };
        }

        // Stand der Prüfung beim Öffnen des Dialogs (Anzahlen, letzte Prüfung, Verbindungsproblem)
        private string HibpProgressText()
        {
            HibpChecker hibp = _plugin.Hibp;
            if (hibp == null || !hibp.Enabled) return "";
            int total, done, leaked;
            bool running;
            DateTime lastPass, lastFailure;
            try
            {
                hibp.Progress(out total, out done, out leaked, out running, out lastPass, out lastFailure);
            }
            catch (InvalidOperationException)
            {
                return "";
            }
            if (total == 0) return "";
            string text = FerryText.T("Geprüft: " + done + " von " + total, "Checked: " + done + " of " + total);
            if (leaked > 0) text += FerryText.T(" · " + leaked + " in Datenlecks", " · " + leaked + " in data breaches");
            if (lastPass > DateTime.MinValue)
                text += FerryText.T(" · zuletzt geprüft: ", " · last checked: ") + lastPass.ToLocalTime().ToString("g");
            if (lastFailure > lastPass)
                text += Environment.NewLine + FerryText.T("Keine Verbindung zu „Have I Been Pwned“, neuer Versuch läuft automatisch.",
                    "No connection to \"Have I Been Pwned\", retrying automatically.");
            return text;
        }

        private static CheckBox NewCheckBox(GroupBox parent, int top, string text)
        {
            var box = new CheckBox { Text = text, AutoSize = true, Location = new Point(12, top), MaximumSize = new Size(500, 0) };
            parent.Controls.Add(box);
            return box;
        }

        private void ShowPairedClients()
        {
            _clients.Items.Clear();
            foreach (FerryIdentity.PairedClient client in _plugin.FerryIdentity.PairedClients())
            {
                string name = string.IsNullOrEmpty(client.Name) ? client.Id : client.Name;
                string pairedAt = client.PairedAt.HasValue ? client.PairedAt.Value.ToString("g") : "";
                // Vor Plugin 1.0.19 gekoppelt und seitdem nicht verbunden: kein Datum
                string lastSeen = client.LastSeen.HasValue ? client.LastSeen.Value.ToString("d") : "–";
                var item = new ListViewItem(new[] { name, pairedAt, lastSeen }) { Tag = client.Id };
                _clients.Items.Add(item);
            }
            _unpair.Enabled = false;
        }

        private void OnUnpair(object sender, EventArgs e)
        {
            if (_clients.SelectedItems.Count == 0) return;
            var clientId = (string)_clients.SelectedItems[0].Tag;
            string name = _clients.SelectedItems[0].Text;
            if (MessageBox.Show(this,
                    FerryText.T("Kopplung mit „" + name + "“ aufheben?", "Remove the pairing with \"" + name + "\"?"),
                    "KeePassFerry", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                return;

            _plugin.FerryIdentity.RemoveClient(clientId);
            // Bestehende Verbindung dieses Browsers trennen; beim nächsten Verbinden wird neu gekoppelt
            foreach (FerryClientConnection connection in _plugin.GetConnectedRPCClients())
            {
                var channel = connection.Transport as SecureChannel;
                if (channel != null && channel.ClientId == clientId)
                    connection.Transport.Close();
            }
            _host.MainWindow.Invoke((MethodInvoker)delegate { _host.MainWindow.SaveConfig(); });
            ShowPairedClients();
        }

        private void OnOk(object sender, EventArgs e)
        {
            _host.CustomConfig.SetBool(KeyAutoSave, _autoSave.Checked);
            _host.CustomConfig.SetBool(KeyEditNewEntries, _editNewEntries.Checked);
            if (_plugin.Hibp != null && _plugin.Hibp.Enabled != _hibp.Checked) _plugin.Hibp.Enabled = _hibp.Checked;
            _host.CustomConfig.SetBool(FerryService.HideExpiredConfigKey, _expiryMode.SelectedIndex == 1);
            _host.CustomConfig.SetLong(FerryService.ExpiryWarnDaysConfigKey, FerryService.ExpiryWarnDaysChoices[Math.Max(0, _expiryWarn.SelectedIndex)]);
            _host.MainWindow.Invoke((MethodInvoker)delegate { _host.MainWindow.SaveConfig(); });
            // Verbundene Browser laden Einträge und Vorwarnung neu
            _plugin.SignalAllManagedRPCClients(KeePassFerry.Models.DataExchange.Signal.DATABASE_SELECTED);
        }

        protected override void OnLoad(EventArgs e)
        {
            GlobalWindowManager.AddWindow(this);
            base.OnLoad(e);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            GlobalWindowManager.RemoveWindow(this);
            base.OnFormClosed(e);
        }
    }
}
