using System;
using System.Drawing;
using System.Globalization;
using System.Windows.Forms;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Bestätigung einer neuen Browser-Kopplung: zeigt den Prüfcode, der auch im Browser angezeigt wird.
    /// Texte auf Deutsch oder Englisch je nach KeePass-Sprache (FerryText).
    /// </summary>
    public sealed class FerryPairingForm : Form
    {
        private readonly TextBox _name;
        private readonly string _defaultName;

        /// <summary>Name der Kopplung: die Eingabe, ohne Eingabe der vom Browser gemeldete Name</summary>
        public string ChosenName
        {
            get
            {
                string clean = FerryIdentity.CleanClientName(_name.Text);
                return clean.Length > 0 ? clean : _defaultName;
            }
        }

        public FerryPairingForm(string clientName, string code)
        {
            bool de = FerryText.German;
            string display = string.IsNullOrWhiteSpace(clientName) ? "KeePassFerry" : clientName;

            Text = de ? "KeePassFerry – Browser koppeln" : "KeePassFerry – pair browser";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            TopMost = true;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(440, 306);
            Font = new Font("Segoe UI", 9.75F);

            var intro = new Label
            {
                AutoSize = false,
                Location = new Point(20, 18),
                Size = new Size(400, 60),
                Text = de
                    ? "Die Browser-Erweiterung „" + display + "“ möchte sich mit KeePass verbinden. Verbinde nur, wenn im Browser genau derselbe Code angezeigt wird:"
                    : "The browser extension \"" + display + "\" wants to connect to KeePass. Only connect if the browser shows exactly the same code:"
            };
            var codeLabel = new Label
            {
                AutoSize = false,
                Location = new Point(20, 82),
                Size = new Size(400, 60),
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Consolas", 26F, FontStyle.Bold),
                ForeColor = Color.FromArgb(21, 73, 127),
                Text = code.Length == 6 ? code.Substring(0, 3) + " " + code.Substring(3) : code
            };
            var hint = new Label
            {
                AutoSize = false,
                Location = new Point(20, 146),
                Size = new Size(400, 36),
                ForeColor = Color.DimGray,
                Text = de
                    ? "Wenn du die Verbindung nicht selbst gestartet hast, lehne sie ab."
                    : "If you did not start this connection yourself, decline it."
            };
            var nameLabel = new Label
            {
                AutoSize = false,
                Location = new Point(20, 186),
                Size = new Size(400, 22),
                Text = de ? "Name dieser Kopplung (z. B. Chrome Laptop):" : "Name of this pairing (e.g. Chrome laptop):"
            };
            _defaultName = FerryIdentity.CleanClientName(clientName);
            _name = new TextBox { Location = new Point(20, 210), Width = 400, MaxLength = 80, Text = _defaultName };
            var accept = new Button
            {
                Text = de ? "Verbinden" : "Connect",
                DialogResult = DialogResult.OK,
                Location = new Point(214, 256),
                Size = new Size(100, 32)
            };
            var decline = new Button
            {
                Text = de ? "Ablehnen" : "Decline",
                DialogResult = DialogResult.Cancel,
                Location = new Point(320, 256),
                Size = new Size(100, 32)
            };
            Controls.AddRange(new Control[] { intro, codeLabel, hint, nameLabel, _name, accept, decline });
            // Sicherer Standard: Enter/Esc lehnen ab, Verbinden nur per bewusstem Klick
            AcceptButton = decline;
            CancelButton = decline;
            ActiveControl = decline;
            // Enter im Namensfeld lehnt nicht ab und verbindet nicht
            _name.Enter += delegate { AcceptButton = null; };
            _name.Leave += delegate { AcceptButton = decline; };
            _name.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) e.SuppressKeyPress = true; };
            FormScaling.Apply(this);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
        }
    }
}
