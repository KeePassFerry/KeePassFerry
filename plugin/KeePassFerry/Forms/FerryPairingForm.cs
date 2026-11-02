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
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            ClientSize = new Size(440, 250);
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
                Size = new Size(400, 40),
                ForeColor = Color.DimGray,
                Text = de
                    ? "Wenn du die Verbindung nicht selbst gestartet hast, lehne sie ab."
                    : "If you did not start this connection yourself, decline it."
            };
            var accept = new Button
            {
                Text = de ? "Verbinden" : "Connect",
                DialogResult = DialogResult.OK,
                Location = new Point(214, 200),
                Size = new Size(100, 32)
            };
            var decline = new Button
            {
                Text = de ? "Ablehnen" : "Decline",
                DialogResult = DialogResult.Cancel,
                Location = new Point(320, 200),
                Size = new Size(100, 32)
            };
            Controls.AddRange(new Control[] { intro, codeLabel, hint, accept, decline });
            // Sicherer Standard: Enter/Esc lehnen ab, Verbinden nur per bewusstem Klick
            AcceptButton = decline;
            CancelButton = decline;
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
        }
    }
}
