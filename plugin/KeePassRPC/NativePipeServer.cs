using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace KeePassFerry
{
    /// <summary>
    /// Named-Pipe-Server für den Native-Messaging-Host: eine Pipe pro Windows-Benutzer,
    /// jede Nachricht mit 4-Byte-Längenpräfix (little endian) und UTF-8-JSON
    /// </summary>
    public class NativePipeServer
    {
        public const string PipeBaseName = "keepassferry";
        internal const int MaxMessageBytes = 64 * 1024 * 1024;

        private readonly KeePassRPCService _service;
        private readonly KeePassFerryExt _plugin;
        private readonly string _pipeName;
        private readonly Thread _listenThread;
        private Mutex _instanceMutex;
        private volatile bool _stopping;

        /// <summary>
        /// Pipe-Name des aktuellen Windows-Benutzers (Basisname + SID)
        /// </summary>
        public static string PipeNameForCurrentUser()
        {
            return PipeBaseName + "-" + WindowsIdentity.GetCurrent().User.Value;
        }

        /// <summary>
        /// Startet den Server. Wirft InvalidOperationException, wenn für diesen Benutzer schon eine KeePass-Instanz lauscht.
        /// </summary>
        public NativePipeServer(KeePassRPCService service, KeePassFerryExt plugin)
        {
            _service = service;
            _plugin = plugin;
            _pipeName = PipeNameForCurrentUser();

            bool createdNew;
            _instanceMutex = new Mutex(true, @"Global\" + _pipeName, out createdNew);
            if (!createdNew)
            {
                _instanceMutex.Dispose();
                _instanceMutex = null;
                throw new InvalidOperationException("Another KeePass instance of this Windows user is already serving " + _pipeName);
            }

            _listenThread = new Thread(ListenLoop);
            _listenThread.IsBackground = true;
            _listenThread.Name = "KeePassFerryPipeListener";
            _listenThread.Start();
            Log("Pipe server listening on " + _pipeName);
        }

        /// <summary>
        /// Beendet das Warten auf neue Verbindungen
        /// </summary>
        public void Stop()
        {
            _stopping = true;
            // Wartendes WaitForConnection mit einer Dummy-Verbindung aufwecken
            try
            {
                using (var wake = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut))
                    wake.Connect(500);
            }
            catch (Exception)
            {
            }
            if (_instanceMutex != null)
            {
                try { _instanceMutex.ReleaseMutex(); } catch (Exception) { }
                _instanceMutex.Dispose();
                _instanceMutex = null;
            }
        }

        private static PipeSecurity CreatePipeSecurity()
        {
            var security = new PipeSecurity();
            // Keine geerbten Rechte, nur der aktuelle Benutzer, kein Zugriff über das Netzwerk
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.NetworkSid, null),
                PipeAccessRights.FullControl, AccessControlType.Deny));
            security.AddAccessRule(new PipeAccessRule(
                WindowsIdentity.GetCurrent().User,
                PipeAccessRights.FullControl, AccessControlType.Allow));
            return security;
        }

        private void ListenLoop()
        {
            while (!_stopping)
            {
                NamedPipeServerStream pipe;
                try
                {
                    // Asynchron (overlapped), damit Lesen und Schreiben auf derselben Pipe parallel laufen können
                    pipe = new NamedPipeServerStream(_pipeName, PipeDirection.InOut,
                        NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous, 65536, 65536, CreatePipeSecurity());
                }
                catch (Exception ex)
                {
                    Log("Creating pipe instance failed: " + ex.Message);
                    Thread.Sleep(1000);
                    continue;
                }

                try
                {
                    pipe.WaitForConnection();
                }
                catch (Exception ex)
                {
                    pipe.Dispose();
                    if (_stopping) return;
                    Log("Waiting for pipe connection failed: " + ex.Message);
                    continue;
                }

                if (_stopping)
                {
                    pipe.Dispose();
                    return;
                }

                string clientExe;
                if (!ClientIsAllowed(pipe, out clientExe))
                {
                    Log("Pipe client rejected: " + (clientExe ?? "unknown process"));
                    pipe.Dispose();
                    continue;
                }

                var transport = new PipeClientTransport(pipe);
                var clientThread = new Thread(() => ServeClient(transport));
                clientThread.IsBackground = true;
                clientThread.Name = "KeePassFerryPipeClient";
                clientThread.Start();
            }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        private const uint ProcessQueryLimitedInformation = 0x1000;

        /// <summary>
        /// Zusätzlich zur Kopplung: Nur der registrierte KeePassFerryHost.exe darf die Pipe benutzen.
        /// Weitere erlaubte Programme (nur für Entwicklung/Tests) in der KeePass-Konfiguration unter
        /// KeePassFerry.AdditionalPipeClients, mehrere Pfade mit ";" getrennt.
        /// </summary>
        private bool ClientIsAllowed(NamedPipeServerStream pipe, out string clientExe)
        {
            clientExe = null;
            uint pid;
            if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out pid)) return false;
            IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, pid);
            if (process == IntPtr.Zero) return false;
            try
            {
                var sb = new StringBuilder(1024);
                uint size = (uint)sb.Capacity;
                if (!QueryFullProcessImageName(process, 0, sb, ref size)) return false;
                clientExe = sb.ToString();
            }
            finally
            {
                CloseHandle(process);
            }

            var allowed = new System.Collections.Generic.List<string>();
            string host = NativeHostRegistration.FindHostExe();
            if (host != null) allowed.Add(host);
            string extra = _plugin._host.CustomConfig.GetString("KeePassFerry.AdditionalPipeClients", "");
            foreach (string p in extra.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
                allowed.Add(p.Trim());

            string actual = NormalizePath(clientExe);
            foreach (string a in allowed)
                if (actual != null && string.Equals(actual, NormalizePath(a), StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }

        private static string NormalizePath(string path)
        {
            try
            {
                return Path.GetFullPath(path).TrimEnd('\\');
            }
            catch (Exception)
            {
                return null;
            }
        }

        private void ServeClient(PipeClientTransport transport)
        {
            // Zuerst den verschlüsselten Kanal aufbauen; ohne gültigen Handshake keine RPC-Verbindung
            SecureChannel channel = SecureChannel.Accept(transport, _plugin.FerryIdentity,
                KeePassRPCClientConnection.FeaturesOfferedToClients, _plugin.ConfirmFerryPairing);
            if (channel == null)
            {
                Log("Secure channel handshake failed or pairing declined");
                transport.Close();
                return;
            }
            Log("Secure channel established");

            _plugin.AddRPCClientConnection(channel);
            try
            {
                string message;
                while (!_stopping && (message = channel.Receive()) != null)
                    _plugin.MessageRPCClientConnection(channel, message, _service);
            }
            catch (Exception ex)
            {
                if (!_stopping) Log("Pipe client closed: " + ex.GetType().Name);
            }
            finally
            {
                _plugin.RemoveRPCClientConnection(channel);
                channel.Close();
            }
        }

        private void Log(string text)
        {
            if (_plugin.logger == null) return;
            try
            {
                _plugin.logger.WriteLine(text);
            }
            catch (Exception)
            {
            }
        }
    }

    /// <summary>
    /// Eine verbundene Pipe-Instanz (ein Native-Messaging-Host)
    /// </summary>
    public class PipeClientTransport : IClientTransport
    {
        private readonly NamedPipeServerStream _pipe;
        private readonly object _writeLock = new object();
        private volatile bool _closed;

        public PipeClientTransport(NamedPipeServerStream pipe)
        {
            _pipe = pipe;
        }

        /// <summary>
        /// Liest die nächste Nachricht; null bei sauber geschlossener Verbindung
        /// </summary>
        public string ReadMessage()
        {
            var header = new byte[4];
            if (!ReadExactly(header, 0, 4, true))
                return null;
            int length = BitConverter.ToInt32(header, 0);
            if (length < 0 || length > NativePipeServer.MaxMessageBytes)
                throw new InvalidDataException("Invalid message length " + length);
            var body = new byte[length];
            ReadExactly(body, 0, length, false);
            return Encoding.UTF8.GetString(body);
        }

        private bool ReadExactly(byte[] buffer, int offset, int count, bool allowEof)
        {
            int read = 0;
            while (read < count)
            {
                int n = _pipe.Read(buffer, offset + read, count - read);
                if (n == 0)
                {
                    if (allowEof && read == 0) return false;
                    throw new EndOfStreamException();
                }
                read += n;
            }
            return true;
        }

        public void Send(string message)
        {
            if (_closed) return;
            byte[] body = Encoding.UTF8.GetBytes(message);
            byte[] header = BitConverter.GetBytes(body.Length);
            try
            {
                lock (_writeLock)
                {
                    _pipe.Write(header, 0, 4);
                    _pipe.Write(body, 0, body.Length);
                    _pipe.Flush();
                }
            }
            catch (IOException)
            {
                // Gegenstelle weg; der Lese-Thread räumt die Verbindung ab
            }
            catch (ObjectDisposedException)
            {
            }
        }

        public bool IsSecure { get { return false; } }

        public void Close()
        {
            if (_closed) return;
            _closed = true;
            try
            {
                _pipe.Dispose();
            }
            catch (Exception)
            {
            }
        }
    }
}
