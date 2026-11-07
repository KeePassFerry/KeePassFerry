using System;
using System.Drawing;
using System.Windows.Forms;

namespace KeePassFerry.Forms
{
    /// <summary>
    /// Skaliert im Code aufgebaute Dialoge passend zur DPI-Einstellung von Windows: Fenster, Abstände, Felder und
    /// Spaltenbreiten wachsen um denselben Faktor. Die Schrift ist in Punkt angegeben und wächst von selbst mit.
    /// Die Dialoge verwenden AutoScaleMode.None, damit nichts doppelt skaliert wird.
    /// </summary>
    internal static class FormScaling
    {
        internal static float Factor
        {
            get
            {
                using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                    return g.DpiX / 96F;
            }
        }

        internal static void Apply(Form form, params ListView[] lists)
        {
            float factor = Factor;
            if (factor == 1F) return;
            form.Scale(new SizeF(factor, factor));
            foreach (ListView list in lists)
                foreach (ColumnHeader column in list.Columns)
                    column.Width = (int)Math.Round(column.Width * factor);
        }
    }
}
