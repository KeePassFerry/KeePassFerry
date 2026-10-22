using System;
using System.Drawing;
using System.Windows.Forms;
using KeePassLib;
using KeePassLib.Utility;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Reiter "KeePassFerry" im Gruppendialog: Welche Gruppe der Browser sieht (freigegebene Gruppe, früher Kee "Home group").
    /// Gespeichert wird sie in der Datenbank (KPRPC-Konfiguration, RootUUID).
    /// </summary>
    public sealed class FerryGroupUserControl : UserControl
    {
        private enum Visibility { Shared, Inside, Outside, RecycleBin }

        private readonly KeePassFerryExt _plugin;
        private readonly PwGroup _group;
        private readonly Label _status;
        private readonly Button _share;

        public FerryGroupUserControl(KeePassFerryExt plugin, PwGroup group)
        {
            _plugin = plugin;
            _group = group;
            Padding = new Padding(12);

            var layout = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true
            };
            var explanation = new Label
            {
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 12),
                Text = FerryText.T(
                    "KeePassFerry zeigt im Browser nur Einträge aus der freigegebenen Gruppe und ihren Untergruppen. Ohne eigene Auswahl ist das die ganze Datenbank.",
                    "KeePassFerry only offers entries from the shared group and its subgroups in the browser. Unless you choose a group, this is the whole database.")
            };
            _status = new Label { AutoSize = true, Margin = new Padding(0, 0, 0, 12), Font = new Font(Font, FontStyle.Bold) };
            _share = new Button
            {
                AutoSize = true,
                Text = IsDatabaseRoot
                    ? FerryText.T("Ganze Datenbank freigeben", "Share the whole database")
                    : FerryText.T("Diese Gruppe für den Browser freigeben", "Share this group with the browser")
            };
            _share.Click += OnShareClick;

            layout.Controls.Add(explanation);
            layout.Controls.Add(_status);
            layout.Controls.Add(_share);
            Controls.Add(layout);

            // Zeilenumbruch der Texte an die Breite des Reiters anpassen
            layout.Resize += delegate
            {
                int width = Math.Max(200, layout.ClientSize.Width - 8);
                explanation.MaximumSize = new Size(width, 0);
                _status.MaximumSize = new Size(width, 0);
            };
            UpdateStatus();
        }

        private bool IsDatabaseRoot
        {
            get { return _group == _plugin._host.Database.RootGroup; }
        }

        private Visibility CurrentVisibility()
        {
            PwDatabase db = _plugin._host.Database;
            PwGroup shared = _plugin.RPCService.GetRootPwGroup(db);
            PwUuid recycleBin = db.RecycleBinUuid;
            if (shared.Uuid.Equals(_group.Uuid)) return Visibility.Shared;
            if (recycleBin != null && !ReferenceEquals(recycleBin, PwUuid.Zero)
                && _group.IsOrIsContainedIn(db.RootGroup.FindGroup(recycleBin, true)))
                return Visibility.RecycleBin;
            // true auch für die Wurzelgruppe, wenn eine eigene Gruppe freigegeben ist
            if (_group.IsContainedIn(shared)) return Visibility.Inside;
            return Visibility.Outside;
        }

        private void UpdateStatus()
        {
            switch (CurrentVisibility())
            {
                case Visibility.Shared:
                    _status.Text = IsDatabaseRoot
                        ? FerryText.T("Die ganze Datenbank ist für den Browser freigegeben.", "The whole database is shared with the browser.")
                        : FerryText.T("Diese Gruppe ist für den Browser freigegeben – samt allen Untergruppen und Einträgen.",
                            "This group is shared with the browser, including all subgroups and entries.");
                    _share.Enabled = false;
                    break;
                case Visibility.Inside:
                    _status.Text = FerryText.T("Der Browser sieht diese Gruppe (sie liegt in der freigegebenen Gruppe).",
                        "The browser can see this group (it is inside the shared group).");
                    _share.Enabled = true;
                    break;
                case Visibility.Outside:
                    _status.Text = FerryText.T("Der Browser sieht diese Gruppe nicht, weil sie außerhalb der freigegebenen Gruppe liegt.",
                        "The browser cannot see this group because it is outside the shared group.");
                    _share.Enabled = true;
                    break;
                case Visibility.RecycleBin:
                    _status.Text = FerryText.T("Der Browser sieht diese Gruppe nicht, weil sie im Papierkorb liegt.",
                        "The browser cannot see this group because it is in the recycle bin.");
                    _share.Enabled = false;
                    break;
            }
        }

        private void OnShareClick(object sender, EventArgs e)
        {
            PwDatabase db = _plugin._host.Database;
            var conf = db.GetKPRPCConfig();
            // Oberste Gruppe: Auswahl löschen, dann gilt wieder die ganze Datenbank
            conf.RootUUID = IsDatabaseRoot ? null : MemUtil.ByteArrayToHexString(_group.Uuid.UuidBytes);
            db.SetKPRPCConfig(conf);
            UpdateStatus();
            _plugin._host.MainWindow.UpdateUI(false, null, true, null, true, null, true);
        }
    }
}
