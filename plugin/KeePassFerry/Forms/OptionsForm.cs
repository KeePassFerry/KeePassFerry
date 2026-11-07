using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using KeePass.Plugins;
using KeePass.UI;
using KeePassLib;
using KeePassFerry.Properties;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Optionen des Plugins (Extras → KeePassFerry-Optionen, auch per Knopf aus der Erweiterung): alles, was in KeePass
    /// wirkt und für alle Browser gilt – Speichern, Datenlecks-Prüfung, abgelaufene Einträge, Adressabgleich, gekoppelte
    /// Browser, Update.
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
        private readonly Button _rename;
        private readonly CheckedListBox _hibpDbs;
        private readonly RadioButton _accuracyDomain;
        private readonly RadioButton _accuracyHostname;
        private readonly RadioButton _accuracyExact;
        private readonly ListView _accuracyOverrides;
        private readonly Button _overrideEdit;
        private readonly Button _overrideDelete;

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
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(560, 640);
            Font = new Font("Segoe UI", 9F);

            var hint = new Label
            {
                AutoSize = false,
                Location = new Point(16, 14),
                Size = new Size(528, 36),
                ForeColor = Color.DimGray,
                Text = FerryText.T("Hier stellst du ein, was in KeePass wirkt und für alle Browser gilt. Einstellungen für Webseiten (Ausfüllen, Feldsymbole …) findest du in der Browser-Erweiterung.",
                    "Settings that take effect in KeePass and apply to all browsers. Settings for websites (filling, field icons …) are in the browser extension.")
            };

            var tabs = new TabControl { Location = new Point(8, 52), Size = new Size(544, 510) };
            var tabGeneral = new TabPage(FerryText.T("Allgemein", "General")) { UseVisualStyleBackColor = true };
            var tabAddresses = new TabPage(FerryText.T("Adressen und Browser", "Addresses and browsers")) { UseVisualStyleBackColor = true };
            tabs.TabPages.Add(tabGeneral);
            tabs.TabPages.Add(tabAddresses);

            var general = new GroupBox
            {
                Text = FerryText.T("Allgemein", "General"),
                Location = new Point(4, 8),
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
                Location = new Point(4, 122),
                Size = new Size(528, 216)
            };
            _hibp = NewCheckBox(breaches, 24,
                FerryText.T("Passwörter auf Datenlecks prüfen", "Check passwords for data breaches"));
            _hibp.Checked = _plugin.Hibp != null && _plugin.Hibp.Enabled;
            _hibp.Enabled = _plugin.Hibp != null;
            breaches.Controls.Add(NewHint(48, 54, FerryText.T(
                "KeePass prüft neue und geänderte Passwörter bei „Have I Been Pwned“ und alle anderen gelegentlich erneut. Gesendet werden nur die ersten 5 Zeichen einer Prüfsumme, nie das Passwort.",
                "KeePass checks new and changed passwords at \"Have I Been Pwned\" and re-checks all others from time to time. Only the first 5 characters of a checksum are sent, never the password.")));
            breaches.Controls.Add(NewHint(102, 30, HibpProgressText()));
            // Pro Datenbank: neue Datenbanken sind nicht eingeschaltet; schreibgeschützte lassen sich nicht prüfen
            breaches.Controls.Add(new Label
            {
                Text = FerryText.T("Für diese Datenbanken (gilt für diesen PC):", "For these databases (on this PC):"),
                AutoSize = true,
                Location = new Point(30, 132)
            });
            _hibpDbs = new CheckedListBox { Location = new Point(30, 152), Size = new Size(486, 56), CheckOnClick = true, IntegralHeight = false };
            foreach (PwDocument doc in host.MainWindow.DocumentManager.Documents)
            {
                PwDatabase db = doc.Database;
                if (db == null || !db.IsOpen || host.MainWindow.IsFileLocked(doc)) continue;
                bool readOnly = FerryService.IsDatabaseReadOnly(db);
                string label = HibpChecker.DisplayName(db) + (readOnly ? FerryText.T(" (nur lesen)", " (read-only)") : "");
                bool on = !readOnly && _plugin.Hibp != null && _plugin.Hibp.IsDatabaseEnabled(db, false);
                _hibpDbs.Items.Add(new HibpDbItem { Db = db, Label = label, ReadOnly = readOnly }, on);
            }
            _hibpDbs.ItemCheck += (s, e) =>
            {
                if (((HibpDbItem)_hibpDbs.Items[e.Index]).ReadOnly) e.NewValue = CheckState.Unchecked;
            };
            _hibpDbs.Enabled = _plugin.Hibp != null;
            breaches.Controls.Add(_hibpDbs);

            var expiry = new GroupBox
            {
                Text = FerryText.T("Abgelaufene Einträge", "Expired entries"),
                Location = new Point(4, 346),
                Size = new Size(528, 128)
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
            expiry.Controls.Add(NewHint(84, 36, FerryText.T(
                "Gilt nur für Einträge mit Ablaufdatum („Gültig bis“). „Erinnern“ füllt weiter aus und weist auf einen Passwortwechsel hin; „Ausblenden“ schlägt sie im Browser nicht mehr vor.",
                "Only applies to entries with an expiry date (\"Expires\"). \"Remind\" keeps filling them in and suggests changing the password; \"Hide\" no longer offers them in the browser.")));

            var accuracy = new GroupBox
            {
                Text = FerryText.T("Adressen abgleichen", "Address matching"),
                Location = new Point(4, 8),
                Size = new Size(528, 262)
            };
            accuracy.Controls.Add(new Label { Text = FerryText.T("Standard für neue Einträge:", "Default for new entries:"), AutoSize = true, Location = new Point(12, 26) });
            _accuracyDomain = new RadioButton { Text = FerryText.L("Domain"), AutoSize = true, Location = new Point(190, 24) };
            _accuracyHostname = new RadioButton { Text = FerryText.L("Hostname"), AutoSize = true, Location = new Point(280, 24) };
            _accuracyExact = new RadioButton { Text = FerryText.L("Exact"), AutoSize = true, Location = new Point(380, 24) };
            accuracy.Controls.AddRange(new Control[] { _accuracyDomain, _accuracyHostname, _accuracyExact });
            _accuracyDomain.Checked = MatchAccuracySettings.Default == MatchAccuracyMethod.Domain;
            _accuracyHostname.Checked = MatchAccuracySettings.Default == MatchAccuracyMethod.Hostname;
            _accuracyExact.Checked = MatchAccuracySettings.Default == MatchAccuracyMethod.Exact;
            accuracy.Controls.Add(NewHint(50, 36, FerryText.T(
                "Domain: Subdomains zählen mit (login.example.com passt auf www.example.com). Hostname: Die Subdomain muss stimmen. Exakt: Die ganze Adresse muss stimmen.",
                "Domain: subdomains count too (login.example.com matches www.example.com). Hostname: the subdomain must match. Exact: the whole address must match.")));
            accuracy.Controls.Add(new Label
            {
                Text = FerryText.T("Ausnahmen je Domain (haben Vorrang vor der Einstellung am Eintrag):", "Exceptions per domain (take priority over the entry's setting):"),
                AutoSize = true,
                Location = new Point(12, 92)
            });
            _accuracyOverrides = new ListView
            {
                View = View.Details,
                FullRowSelect = true,
                HideSelection = false,
                MultiSelect = false,
                HeaderStyle = ColumnHeaderStyle.Nonclickable,
                Location = new Point(12, 112),
                Size = new Size(410, 106)
            };
            _accuracyOverrides.Columns.Add(FerryText.T("Domain", "Domain"), 270);
            _accuracyOverrides.Columns.Add(FerryText.T("Genauigkeit", "Accuracy"), 115);
            foreach (KeyValuePair<string, MatchAccuracyMethod> item in MatchAccuracySettings.CopyOverrides())
                AddOverrideRow(item.Key, item.Value);
            _accuracyOverrides.SelectedIndexChanged += delegate { UpdateOverrideButtons(); };
            _accuracyOverrides.DoubleClick += delegate { EditOverride(); };
            var overrideAdd = new Button { Text = FerryText.T("Hinzufügen", "Add"), Location = new Point(430, 112), Size = new Size(88, 28) };
            _overrideEdit = new Button { Text = FerryText.T("Bearbeiten", "Edit"), Location = new Point(430, 146), Size = new Size(88, 28), Enabled = false };
            _overrideDelete = new Button { Text = FerryText.T("Entfernen", "Remove"), Location = new Point(430, 180), Size = new Size(88, 28), Enabled = false };
            overrideAdd.Click += delegate { AddOverride(); };
            _overrideEdit.Click += delegate { EditOverride(); };
            _overrideDelete.Click += delegate { DeleteOverride(); };
            accuracy.Controls.AddRange(new Control[] { _accuracyOverrides, overrideAdd, _overrideEdit, _overrideDelete });
            accuracy.Controls.Add(NewHint(222, 36, FerryText.T(
                "Gilt für alle Datenbanken auf diesem PC. Für einen einzelnen Eintrag stellst du die Genauigkeit im Eintrag ein (Reiter KeePassFerry).",
                "Applies to all databases on this PC. For a single entry, set the accuracy in the entry (KeePassFerry tab).")));

            var paired = new GroupBox
            {
                Text = FerryText.T("Gekoppelte Browser", "Paired browsers"),
                Location = new Point(4, 278),
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
            _clients.SelectedIndexChanged += delegate
            {
                _rename.Enabled = _unpair.Enabled = _clients.SelectedItems.Count > 0;
            };
            _clients.DoubleClick += delegate { OnRename(); };
            _rename = new Button
            {
                Text = FerryText.T("Umbenennen", "Rename"),
                Location = new Point(12, 156),
                Size = new Size(100, 28),
                Enabled = false
            };
            _rename.Click += delegate { OnRename(); };
            _unpair = new Button
            {
                Text = FerryText.T("Kopplung aufheben", "Remove pairing"),
                Location = new Point(118, 156),
                Size = new Size(130, 28),
                Enabled = false
            };
            _unpair.Click += OnUnpair;
            var pairedHint = new Label
            {
                AutoSize = false,
                Location = new Point(256, 152),
                Size = new Size(260, 40),
                ForeColor = Color.DimGray,
                Text = FerryText.T("Nach dem Aufheben muss sich der Browser neu koppeln und den Prüfcode bestätigen.",
                    "After removing, the browser has to pair again and confirm the verification code.")
            };
            paired.Controls.AddRange(new Control[] { _clients, _rename, _unpair, pairedHint });

            var version = new Label
            {
                AutoSize = true,
                Location = new Point(16, 576),
                Text = "KeePassFerry " + FerryUpdater.InstalledVersion
            };
            var update = new Button
            {
                Text = FerryText.T("Nach Updates suchen …", "Check for updates …"),
                AutoSize = true,
                Location = new Point(160, 570)
            };
            update.Click += delegate { _plugin.OnCheckForUpdates(this, EventArgs.Empty); };

            var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Location = new Point(362, 600), Size = new Size(88, 28) };
            var cancel = new Button
            {
                Text = FerryText.T("Abbrechen", "Cancel"),
                DialogResult = DialogResult.Cancel,
                Location = new Point(456, 600),
                Size = new Size(88, 28)
            };
            ok.Click += OnOk;

            tabGeneral.Controls.AddRange(new Control[] { general, breaches, expiry });
            tabAddresses.Controls.AddRange(new Control[] { accuracy, paired });
            Controls.AddRange(new Control[] { hint, tabs, version, update, ok, cancel });
            AcceptButton = ok;
            CancelButton = cancel;
            ShowPairedClients();
            FormScaling.Apply(this, _accuracyOverrides, _clients);
        }

        private sealed class RenameForm : Form
        {
            private readonly TextBox _text;

            public string NewName { get { return FerryIdentity.CleanClientName(_text.Text); } }

            public RenameForm(string current)
            {
                Text = FerryText.T("Kopplung umbenennen", "Rename pairing");
                FormBorderStyle = FormBorderStyle.FixedDialog;
                MaximizeBox = false;
                MinimizeBox = false;
                ShowInTaskbar = false;
                StartPosition = FormStartPosition.CenterParent;
                AutoScaleMode = AutoScaleMode.None;
                ClientSize = new Size(380, 112);
                Font = new Font("Segoe UI", 9F);
                var label = new Label
                {
                    AutoSize = false,
                    Location = new Point(12, 12),
                    Size = new Size(356, 22),
                    Text = FerryText.T("Name dieser Kopplung (z. B. Chrome Laptop):", "Name of this pairing (e.g. Chrome laptop):")
                };
                _text = new TextBox { Location = new Point(12, 36), Width = 356, MaxLength = 80, Text = current };
                var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Location = new Point(186, 72), Size = new Size(88, 28) };
                var cancel = new Button
                {
                    Text = FerryText.T("Abbrechen", "Cancel"),
                    DialogResult = DialogResult.Cancel,
                    Location = new Point(280, 72),
                    Size = new Size(88, 28)
                };
                _text.TextChanged += delegate { ok.Enabled = NewName.Length > 0; };
                Controls.AddRange(new Control[] { label, _text, ok, cancel });
                AcceptButton = ok;
                CancelButton = cancel;
                FormScaling.Apply(this);
            }
        }

        private sealed class HibpDbItem
        {
            public PwDatabase Db;
            public string Label;
            public bool ReadOnly;
            public override string ToString() { return Label; }
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

        private static string AccuracyText(MatchAccuracyMethod method)
        {
            return FerryText.L(method == MatchAccuracyMethod.Exact ? "Exact" : method == MatchAccuracyMethod.Hostname ? "Hostname" : "Domain");
        }

        private void AddOverrideRow(string domain, MatchAccuracyMethod method)
        {
            _accuracyOverrides.Items.Add(new ListViewItem(new[] { domain, AccuracyText(method) }) { Tag = method });
        }

        private void UpdateOverrideButtons()
        {
            bool selected = _accuracyOverrides.SelectedItems.Count > 0;
            _overrideEdit.Enabled = selected;
            _overrideDelete.Enabled = selected;
        }

        private List<string> OverrideDomains(ListViewItem except)
        {
            var domains = new List<string>();
            foreach (ListViewItem item in _accuracyOverrides.Items)
                if (item != except) domains.Add(item.Text);
            return domains;
        }

        private void AddOverride()
        {
            using (var form = new FerryMAMOverrideForm(null, null, OverrideDomains(null)))
                if (form.ShowDialog(this) == DialogResult.OK) AddOverrideRow(form.Domain, form.MAM);
        }

        private void EditOverride()
        {
            if (_accuracyOverrides.SelectedItems.Count == 0) return;
            ListViewItem item = _accuracyOverrides.SelectedItems[0];
            using (var form = new FerryMAMOverrideForm(item.Text, (MatchAccuracyMethod)item.Tag, OverrideDomains(item)))
            {
                if (form.ShowDialog(this) != DialogResult.OK) return;
                _accuracyOverrides.Items.Remove(item);
                AddOverrideRow(form.Domain, form.MAM);
            }
            UpdateOverrideButtons();
        }

        private void DeleteOverride()
        {
            if (_accuracyOverrides.SelectedItems.Count == 0) return;
            _accuracyOverrides.Items.Remove(_accuracyOverrides.SelectedItems[0]);
            UpdateOverrideButtons();
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
            _rename.Enabled = _unpair.Enabled = false;
        }

        private void OnRename()
        {
            if (_clients.SelectedItems.Count == 0) return;
            var clientId = (string)_clients.SelectedItems[0].Tag;
            using (var form = new RenameForm(_clients.SelectedItems[0].Text))
            {
                if (form.ShowDialog(this) != DialogResult.OK) return;
                _plugin.FerryIdentity.RenameClient(clientId, form.NewName);
            }
            _host.MainWindow.Invoke((MethodInvoker)delegate { _host.MainWindow.SaveConfig(); });
            ShowPairedClients();
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
            if (_plugin.Hibp != null)
                for (int i = 0; i < _hibpDbs.Items.Count; i++)
                {
                    var item = (HibpDbItem)_hibpDbs.Items[i];
                    if (!item.ReadOnly && item.Db.IsOpen) _plugin.Hibp.SetDatabaseEnabled(item.Db, _hibpDbs.GetItemChecked(i));
                }
            _host.CustomConfig.SetBool(FerryService.HideExpiredConfigKey, _expiryMode.SelectedIndex == 1);
            _host.CustomConfig.SetLong(FerryService.ExpiryWarnDaysConfigKey, FerryService.ExpiryWarnDaysChoices[Math.Max(0, _expiryWarn.SelectedIndex)]);
            var overrides = new Dictionary<string, MatchAccuracyMethod>();
            foreach (ListViewItem item in _accuracyOverrides.Items) overrides[item.Text] = (MatchAccuracyMethod)item.Tag;
            MatchAccuracySettings.Save(
                _accuracyExact.Checked ? MatchAccuracyMethod.Exact : _accuracyHostname.Checked ? MatchAccuracyMethod.Hostname : MatchAccuracyMethod.Domain,
                overrides);
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
