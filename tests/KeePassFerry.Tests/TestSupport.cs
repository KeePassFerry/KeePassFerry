using System;
using System.IO;
using System.IO.Pipes;
using System.Resources;
using System.Text;
using System.Threading.Tasks;
using KeePass.App.Configuration;
using KeePass.DataExchange;
using KeePass.Ecas;
using KeePass.Forms;
using KeePass.Plugins;
using KeePass.UI;
using KeePass.Util;
using KeePassLib;
using KeePassLib.Cryptography.Cipher;
using KeePassLib.Cryptography.PasswordGenerator;
using KeePassLib.Keys;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// KeePass-Host ohne Oberfläche: nur die Konfiguration (dort liegen Server-Schlüssel und gekoppelte Browser)
    /// </summary>
    internal sealed class FakePluginHost : IPluginHost
    {
        public AceCustomConfig CustomConfig { get; } = new AceCustomConfig();
        public MainForm MainWindow => null;
        public PwDatabase Database => null;
        public CommandLineArgs CommandLineArgs => null;
        public CipherPool CipherPool => null;
        public KeyProviderPool KeyProviderPool => null;
        public KeyValidatorPool KeyValidatorPool => null;
        public FileFormatPool FileFormatPool => null;
        public TempFilesPool TempFilesPool => null;
        public EcasPool EcasPool => null;
        public EcasTriggerSystem TriggerSystem => null;
        public CustomPwGeneratorPool PwGeneratorPool => null;
        public ColumnProviderPool ColumnProviderPool => null;
        public ResourceManager Resources => null;
    }

    /// <summary>
    /// Verbundenes Pipe-Paar mit eindeutigem Namen (nicht die Pipe eines laufenden KeePass)
    /// </summary>
    internal sealed class PipePair : IDisposable
    {
        public NamedPipeServerStream Server { get; }
        public NamedPipeClientStream Client { get; }
        public PipeClientTransport Transport { get; }

        public PipePair()
        {
            string name = "keepassferry-test-" + Guid.NewGuid().ToString("N");
            Server = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536);
            Client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
            Task wait = Server.WaitForConnectionAsync();
            Client.Connect(5000);
            if (!wait.Wait(5000)) throw new TimeoutException("Pipe not connected");
            Transport = new PipeClientTransport(Server);
        }

        public void WriteRaw(byte[] bytes)
        {
            Client.Write(bytes, 0, bytes.Length);
            Client.Flush();
        }

        public void WriteFrame(string json)
        {
            byte[] body = Encoding.UTF8.GetBytes(json);
            WriteRaw(BitConverter.GetBytes(body.Length));
            WriteRaw(body);
        }

        /// <summary>Nächste Nachricht vom Server; null bei geschlossener Verbindung</summary>
        public string ReadFrame(int timeoutMs = 10000)
        {
            Task<string> read = Task.Run(() =>
            {
                var header = new byte[4];
                if (!ReadExactly(header)) return null;
                var body = new byte[BitConverter.ToInt32(header, 0)];
                if (!ReadExactly(body)) throw new EndOfStreamException();
                return Encoding.UTF8.GetString(body);
            });
            if (!read.Wait(timeoutMs)) throw new TimeoutException("No message from server");
            return read.Result;
        }

        private bool ReadExactly(byte[] buffer)
        {
            int read = 0;
            while (read < buffer.Length)
            {
                int n = Client.Read(buffer, read, buffer.Length - read);
                if (n == 0) return false;
                read += n;
            }
            return true;
        }

        public void Dispose()
        {
            try { Client.Dispose(); } catch (Exception) { }
            try { Transport.Close(); } catch (Exception) { }
        }
    }

    internal static class Hex
    {
        public static byte[] Bytes(string hex)
        {
            hex = hex.Replace(" ", "");
            var b = new byte[hex.Length / 2];
            for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(hex.Substring(2 * i, 2), 16);
            return b;
        }

        public static string String(byte[] b)
        {
            var sb = new StringBuilder(b.Length * 2);
            foreach (byte x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        public static byte[] Range(int from, int to)
        {
            var b = new byte[to - from + 1];
            for (int i = 0; i < b.Length; i++) b[i] = (byte)(from + i);
            return b;
        }

        public static byte[] Repeat(byte value, int count)
        {
            var b = new byte[count];
            for (int i = 0; i < count; i++) b[i] = value;
            return b;
        }
    }
}
