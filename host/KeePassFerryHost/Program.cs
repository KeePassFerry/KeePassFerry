using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace KeePassFerryHost
{
    /// <summary>
    /// Native-Messaging-Host: reicht Nachrichten zwischen Browser (stdin/stdout) und
    /// KeePass-Plugin (Named Pipe des aktuellen Windows-Benutzers) durch.
    /// Beide Seiten: 4-Byte-Länge (little endian) + UTF-8-JSON.
    /// Eigene Statusmeldungen an den Browser: {"keepassferryHost":"connected" | "disconnected" | "chunk", ...}
    /// </summary>
    internal static class Program
    {
        private const string PipeBaseName = "keepassferry";

        private static readonly object BrowserWriteLock = new object();
        private static readonly object PipeLock = new object();
        private static Stream _browserOut;
        private static NamedPipeClientStream _pipe;
        private static int _nextChunkId;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint serverProcessId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool AllowSetForegroundWindow(uint processId);

        // Der Browser (Vordergrundprogramm) hat diesen Host gestartet; deshalb darf der Host dem KeePass-Prozess
        // hinter der Pipe erlauben, ein Fenster in den Vordergrund zu bringen (z. B. die Windows-Hello-Abfrage)
        private static void AllowKeePassForeground()
        {
            lock (PipeLock)
            {
                if (_pipe == null) return;
                uint pid;
                if (GetNamedPipeServerProcessId(_pipe.SafePipeHandle.DangerousGetHandle(), out pid) && pid != 0)
                    AllowSetForegroundWindow(pid);
            }
        }

        // KeePass.exe im eigenen Ordner oder bis zu drei Ebenen darüber (Host liegt im Plugins-Ordner von KeePass).
        // Der Pfad kommt nie von außen: Die Erweiterung kann nur "startKeePass" sagen, nicht was gestartet wird.
        private static string FindKeePassExe()
        {
            try
            {
                var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
                for (int i = 0; i < 4 && dir != null; i++, dir = dir.Parent)
                {
                    string candidate = Path.Combine(dir.FullName, "KeePass.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }
            catch (Exception)
            {
            }
            return null;
        }

        private static DateTime _lastStart = DateTime.MinValue;

        // Nur wenn KeePass nicht verbunden ist; nicht mehrfach kurz hintereinander (Doppelklick, langsamer Start)
        private static void StartKeePass()
        {
            lock (PipeLock)
            {
                if (_pipe != null) return;
            }
            if (DateTime.UtcNow - _lastStart < TimeSpan.FromSeconds(15)) return;
            string exe = FindKeePassExe();
            if (exe == null) return;
            _lastStart = DateTime.UtcNow;
            try
            {
                Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) });
            }
            catch (Exception)
            {
            }
        }

        private static int Main()
        {
            _browserOut = Console.OpenStandardOutput();
            Stream browserIn = Console.OpenStandardInput();
            if (FindKeePassExe() != null) SendStatus("canStartKeePass");

            var browserReader = new Thread(() => ReadFromBrowser(browserIn));
            browserReader.IsBackground = true;
            browserReader.Start();

            string pipeName = PipeBaseName + "-" + WindowsIdentity.GetCurrent().User.Value;
            bool announcedDisconnected = false;

            while (true)
            {
                var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                try
                {
                    pipe.Connect(2000);
                }
                catch (Exception)
                {
                    pipe.Dispose();
                    if (!announcedDisconnected)
                    {
                        SendStatus("disconnected");
                        announcedDisconnected = true;
                    }
                    Thread.Sleep(1000);
                    continue;
                }

                lock (PipeLock) _pipe = pipe;
                announcedDisconnected = false;
                SendStatus("connected");

                try
                {
                    byte[] message;
                    while ((message = Framing.ReadFrame(pipe)) != null)
                        SendToBrowser(message);
                }
                catch (Exception)
                {
                }

                lock (PipeLock) _pipe = null;
                pipe.Dispose();
                SendStatus("disconnected");
                announcedDisconnected = true;
            }
        }

        private static void ReadFromBrowser(Stream browserIn)
        {
            try
            {
                byte[] message;
                while ((message = Framing.ReadFrame(browserIn)) != null)
                {
                    if (Framing.IsHostCommand(message, "allowForeground"))
                    {
                        AllowKeePassForeground();
                        continue;
                    }
                    if (Framing.IsHostCommand(message, "startKeePass"))
                    {
                        StartKeePass();
                        continue;
                    }
                    lock (PipeLock)
                    {
                        if (_pipe == null) continue; // KeePass nicht verbunden: verwerfen, die Erweiterung kennt den Status
                        try
                        {
                            Framing.WriteFrame(_pipe, message);
                        }
                        catch (Exception)
                        {
                        }
                    }
                }
            }
            catch (Exception)
            {
            }
            // Browser hat die Verbindung beendet
            Environment.Exit(0);
        }

        private static void SendStatus(string status)
        {
            SendToBrowser(Encoding.UTF8.GetBytes("{\"keepassferryHost\":\"" + status + "\"}"));
        }

        private static void SendToBrowser(byte[] message)
        {
            lock (BrowserWriteLock)
            {
                int chunkId = message.Length > Framing.MaxDirectBytes ? ++_nextChunkId : 0;
                foreach (byte[] frame in Framing.ForBrowser(message, chunkId))
                    Framing.WriteFrame(_browserOut, frame);
            }
        }
    }
}
