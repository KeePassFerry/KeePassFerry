using System;
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
        private const int MaxMessageBytes = 64 * 1024 * 1024;

        // Browser nimmt vom Host höchstens 1 MB pro Nachricht an; größere Nachrichten gehen in Stücken (Base64)
        private const int MaxDirectBytes = 900 * 1024;
        private const int ChunkRawBytes = 600 * 1024;

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

        // Steuerbefehl der Erweiterung an den Host selbst: {"keepassferryHost":"<befehl>"}
        private static bool IsHostCommand(byte[] message, string command)
        {
            if (message.Length > 100) return false;
            string text = Encoding.UTF8.GetString(message).Replace(" ", "");
            return text == "{\"keepassferryHost\":\"" + command + "\"}";
        }

        private static int Main()
        {
            _browserOut = Console.OpenStandardOutput();
            Stream browserIn = Console.OpenStandardInput();

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
                    while ((message = ReadFrame(pipe)) != null)
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
                while ((message = ReadFrame(browserIn)) != null)
                {
                    if (IsHostCommand(message, "allowForeground"))
                    {
                        AllowKeePassForeground();
                        continue;
                    }
                    lock (PipeLock)
                    {
                        if (_pipe == null) continue; // KeePass nicht verbunden: verwerfen, die Erweiterung kennt den Status
                        try
                        {
                            WriteFrame(_pipe, message);
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
                if (message.Length <= MaxDirectBytes)
                {
                    WriteFrame(_browserOut, message);
                    return;
                }

                int id = ++_nextChunkId;
                int count = (message.Length + ChunkRawBytes - 1) / ChunkRawBytes;
                for (int i = 0; i < count; i++)
                {
                    int offset = i * ChunkRawBytes;
                    string data = Convert.ToBase64String(message, offset, Math.Min(ChunkRawBytes, message.Length - offset));
                    string chunk = "{\"keepassferryHost\":\"chunk\",\"id\":" + id + ",\"index\":" + i +
                                   ",\"count\":" + count + ",\"data\":\"" + data + "\"}";
                    WriteFrame(_browserOut, Encoding.UTF8.GetBytes(chunk));
                }
            }
        }

        private static byte[] ReadFrame(Stream stream)
        {
            var header = new byte[4];
            if (!ReadExactly(stream, header, true))
                return null;
            int length = BitConverter.ToInt32(header, 0);
            if (length < 0 || length > MaxMessageBytes)
                throw new InvalidDataException("Invalid message length " + length);
            var body = new byte[length];
            ReadExactly(stream, body, false);
            return body;
        }

        private static bool ReadExactly(Stream stream, byte[] buffer, bool allowEof)
        {
            int read = 0;
            while (read < buffer.Length)
            {
                int n = stream.Read(buffer, read, buffer.Length - read);
                if (n == 0)
                {
                    if (allowEof && read == 0) return false;
                    throw new EndOfStreamException();
                }
                read += n;
            }
            return true;
        }

        private static void WriteFrame(Stream stream, byte[] message)
        {
            stream.Write(BitConverter.GetBytes(message.Length), 0, 4);
            stream.Write(message, 0, message.Length);
            stream.Flush();
        }
    }
}
