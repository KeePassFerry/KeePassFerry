using System;
using System.Drawing;
using System.Windows.Forms;
using KeePass.Plugins;
using KeePass.UI;
using KeePassFerry.Properties;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Optionen des Plugins (Menü KeePassFerry → Optionen): Verhalten beim Speichern, gekoppelte Browser, Version und Update.
    /// Die meisten Einstellungen liegen in der Browser-Erweiterung.
    /// </summary>
    public sealed class OptionsForm : Form
    {
        internal const string KeyAutoSave = "KeePassFerry.AutoSave";
        internal const string KeyEditNewEntries = "KeePassFerry.EditNewEntries";
        internal const string KeyBackupGeneratedPasswords = "KeePassFerry.BackupGeneratedPasswords";

        private readonly IPluginHost _host;
        private readonly KeePassFerryExt _plugin;
        private readonly CheckBox _autoSave;
        private readonly CheckBox _editNewEntries;
        private readonly CheckBox _backupPasswords;
        private readonly ListView _clients;
        private readonly Button _unpair;

        public OptionsForm(IPluginHost host, KeePassFerryExt plugin)
        {
            _host = host;
            _plugin = plugin;

            Text = FerryText.T("KeePassFerry – Optionen", "KeePassFerry – Options");
            Icon = Resources.KPRPCico;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterParent;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(560, 476);
            Font = new Font("Segoe UI", 9F);

            var hint = new Label
            {
                AutoSize = false,
                Location = new Point(16, 14),
                Size = new Size(528, 34),
                ForeColor = Color.DimGray,
                Text = FerryText.T("Die meisten Einstellungen findest du in der Browser-Erweiterung (Symbol in der Symbolleiste → Einstellungen).",
                    "Most settings are in the browser extension (toolbar icon → Settings).")
            };

            var general = new GroupBox
            {
                Text = FerryText.T("Allgemein", "General"),
                Location = new Point(16, 52),
                Size = new Size(528, 132)
            };
            _autoSave = NewCheckBox(general, 24,
                FerryText.T("Datenbank automatisch speichern, wenn KeePassFerry etwas ändert", "Save the database automatically when KeePassFerry changes it"));
            _editNewEntries = NewCheckBox(general, 52,
                FerryText.T("Im Browser angelegte Einträge sofort in KeePass zum Bearbeiten öffnen", "Open entries created in the browser for editing in KeePass right away"));
            _backupPasswords = NewCheckBox(general, 80,
                FerryText.T("Im Browser erzeugte Passwörter zusätzlich in KeePass sichern",
                    "Also keep a backup of passwords generated in the browser"));
            new ToolTip().SetToolTip(_backupPasswords, FerryText.T("Gruppe „KeePassFerry – generierte Passwörter“",
                "Group \"KeePassFerry – generated passwords\""));
            _autoSave.Checked = host.CustomConfig.GetBool(KeyAutoSave, true);
            _editNewEntries.Checked = host.CustomConfig.GetBool(KeyEditNewEntries, false);
            _backupPasswords.Checked = host.CustomConfig.GetBool(KeyBackupGeneratedPasswords, true);

            var paired = new GroupBox
            {
                Text = FerryText.T("Gekoppelte Browser", "Paired browsers"),
                Location = new Point(16, 194),
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
            _clients.Columns.Add(FerryText.T("Browser", "Browser"), 310);
            _clients.Columns.Add(FerryText.T("Gekoppelt am", "Paired on"), 170);
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
                Location = new Point(16, 408),
                Text = "KeePassFerry " + FerryUpdater.InstalledVersion
            };
            var update = new Button
            {
                Text = FerryText.T("Nach Updates suchen …", "Check for updates …"),
                AutoSize = true,
                Location = new Point(160, 402)
            };
            update.Click += delegate { _plugin.OnCheckForUpdates(this, EventArgs.Empty); };

            var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Location = new Point(362, 436), Size = new Size(88, 28) };
            var cancel = new Button
            {
                Text = FerryText.T("Abbrechen", "Cancel"),
                DialogResult = DialogResult.Cancel,
                Location = new Point(456, 436),
                Size = new Size(88, 28)
            };
            ok.Click += OnOk;

            Controls.AddRange(new Control[] { hint, general, paired, version, update, ok, cancel });
            AcceptButton = ok;
            CancelButton = cancel;
            ShowPairedClients();
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
                var item = new ListViewItem(new[] { name, pairedAt }) { Tag = client.Id };
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
            foreach (KeePassRPCClientConnection connection in _plugin.GetConnectedRPCClients())
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
            _host.CustomConfig.SetBool(KeyBackupGeneratedPasswords, _backupPasswords.Checked);
            _host.MainWindow.Invoke((MethodInvoker)delegate { _host.MainWindow.SaveConfig(); });
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
