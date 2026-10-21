using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace KeePassFerry
{
    /// <summary>
    /// Holt ein KeePass-Fenster zuverlässig in den Vordergrund (Entsperrabfrage, Windows-Hello-Dialog).
    /// Windows erlaubt SetForegroundWindow nur dem Prozess, der die letzte Benutzereingabe ausgelöst hat.
    /// Dafür wird eine Mausbewegung um 0 Pixel gesendet: zählt als Eingabe, bewegt nichts und
    /// kann (anders als simulierte Tasten) keine Taste hängen lassen.
    /// </summary>
    internal static class FerryForeground
    {
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder sb, int max);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        // INPUT mit Union: Mausdaten sind der größte Teil, daher reicht MOUSEINPUT für die Strukturgröße
        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public MOUSEINPUT mi;
        }

        [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        private const int SW_RESTORE = 9;
        private const uint INPUT_MOUSE = 0;
        private const uint MOUSEEVENTF_MOVE = 0x0001;

        /// <summary>
        /// true, wenn das Fenster danach im Vordergrund ist
        /// </summary>
        internal static bool Bring(Form form)
        {
            if (form == null || form.IsDisposed || !form.IsHandleCreated) return false;
            IntPtr h = form.Handle;
            bool wasTopMost = form.TopMost;
            form.TopMost = true;
            BringHandle(h);
            form.Activate();
            if (!wasTopMost) form.TopMost = false;
            return GetForegroundWindow() == h;
        }

        /// <summary>
        /// Holt die Windows-Hello-Abfrage nach vorne, falls sie offen ist (hat kein Taskleistensymbol und fällt sonst nicht auf).
        /// true, wenn eine gefunden wurde.
        /// </summary>
        internal static bool BringHelloPrompt()
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows((h, l) =>
            {
                if (!IsWindowVisible(h)) return true;
                var sb = new System.Text.StringBuilder(128);
                GetClassName(h, sb, sb.Capacity);
                if (sb.ToString() == "Credential Dialog Xaml Host")
                {
                    found = h;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            if (found == IntPtr.Zero) return false;
            BringHandle(found);
            return true;
        }

        private static void BringHandle(IntPtr h)
        {
            if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
            if (GetForegroundWindow() == h) return;
            NudgeInput();
            BringWindowToTop(h);
            SetForegroundWindow(h);
        }

        // Mausbewegung um 0 Pixel: macht diesen Prozess zum Absender der letzten Eingabe
        private static void NudgeInput()
        {
            var input = new INPUT { type = INPUT_MOUSE, mi = new MOUSEINPUT { dx = 0, dy = 0, dwFlags = MOUSEEVENTF_MOVE } };
            SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
        }
    }
}
