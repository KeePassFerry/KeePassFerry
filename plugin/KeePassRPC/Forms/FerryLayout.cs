using System;
using System.Windows.Forms;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Passt Designer-Layouts an übersetzte (längere) Texte an. Aufruf beim Laden des Fensters,
    /// wenn die DPI-Skalierung schon angewendet ist.
    /// </summary>
    internal static class FerryLayout
    {
        /// <summary>Steuerelemente nebeneinander anordnen, beginnend beim ersten</summary>
        internal static void Row(int gap, params Control[] controls)
        {
            for (int i = 1; i < controls.Length; i++)
                controls[i].Left = controls[i - 1].Right + gap;
        }

        /// <summary>
        /// Paare aus Beschriftung und Feld: Beschriftungen links, alle Felder bündig rechts neben der längsten Beschriftung.
        /// rightEdge &gt; 0: Felder reichen bis dorthin.
        /// </summary>
        internal static void LabelColumn(int left, int gap, int rightEdge, params Control[] labelFieldPairs)
        {
            int labelWidth = 0;
            for (int i = 0; i < labelFieldPairs.Length; i += 2)
                labelWidth = Math.Max(labelWidth, labelFieldPairs[i].PreferredSize.Width);
            int fieldLeft = left + labelWidth + gap;
            for (int i = 0; i < labelFieldPairs.Length; i += 2)
            {
                Control label = labelFieldPairs[i];
                Control field = labelFieldPairs[i + 1];
                label.AutoSize = true;
                label.Left = left;
                label.Top = field.Top + (field.Height - label.PreferredSize.Height) / 2;
                field.Left = fieldLeft;
                if (rightEdge > 0) field.Width = Math.Max(60, rightEdge - fieldLeft);
            }
        }

        private static int NeededWidth(Button button)
        {
            return TextRenderer.MeasureText(button.Text, button.Font).Width + button.Padding.Horizontal + 20;
        }

        /// <summary>Knöpfe untereinander auf ihren Text verbreitern; rechte Kante bleibt, das Element links daneben wird schmaler</summary>
        internal static void WidenColumn(Control leftNeighbour, params Button[] buttons)
        {
            int need = 0;
            foreach (Button b in buttons) need = Math.Max(need, NeededWidth(b));
            int delta = need - buttons[0].Width;
            if (delta <= 0) return;
            foreach (Button b in buttons)
            {
                b.Left -= delta;
                b.Width += delta;
            }
            if (leftNeighbour != null) leftNeighbour.Width -= delta;
        }

        /// <summary>Knopfreihe (von links nach rechts) auf ihre Texte verbreitern; die rechte Kante bleibt</summary>
        internal static void WidenRow(int gap, params Button[] buttons)
        {
            int right = buttons[buttons.Length - 1].Right;
            for (int i = buttons.Length - 1; i >= 0; i--)
            {
                Button b = buttons[i];
                b.Width = Math.Max(b.Width, NeededWidth(b));
                b.Left = right - b.Width;
                right = b.Left - gap;
            }
        }
    }
}
