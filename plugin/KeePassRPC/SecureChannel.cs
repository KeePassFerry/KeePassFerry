using System;
using System.Reflection;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Jayrock.Json;
using Jayrock.Json.Conversion;
using KeePass.Plugins;

namespace KeePassFerry
{
    /// <summary>
    /// Verschlüsselter, gegenseitig authentisierter Kanal zwischen Erweiterung und Plugin (Protokoll v1).
    ///
    /// Handshake (Klartext-JSON über die Pipe):
    ///   C→S {"ferry":"hello","v":1,"clientId","clientPub","eph","nonce","name","features"}
    ///   S→C {"ferry":"hello","v":1,"serverId","serverPub","eph","nonce","sig","features"}
    ///   C→S {"ferry":"auth","sig"}
    ///   S→C {"ferry":"pairing"} (nur bei unbekanntem Client, danach Bestätigung in KeePass)
    ///   S→C verschlüsselt {"ferry":"ready"} oder Klartext {"ferry":"denied"}
    /// TH = SHA-256("KeePassFerry handshake v1"‖0‖clientId‖0‖clientPub‖ephC‖nonceC‖serverId‖0‖serverPub‖ephS‖nonceS)
    /// Schlüssel = HKDF-SHA-256(ikm = SHA-256(ECDH-Z), salt = TH, info = "KeePassFerry keys v1", 64) → C→S | S→C
    /// Signaturen: ECDSA P-256/SHA-256 über "KeePassFerry server v1"‖TH bzw. "KeePassFerry client v1"‖TH
    /// Prüfcode (Kopplung): SHA-256("KeePassFerry SAS v1"‖TH), erste 4 Byte big endian mod 10^6
    /// Nachrichten: {"ferry":"m","n":Zähler,"c":AES-256-GCM(Chiffrat‖Tag)}, Nonce = 0^4‖Zähler(BE), AAD "KeePassFerry v1",
    /// Zähler je Richtung ab 1 und streng fortlaufend (Wiedereinspielen/Umsortieren → Abbruch)
    /// </summary>
    public sealed class SecureChannel : IClientTransport
    {
        private static readonly byte[] Aad = Encoding.ASCII.GetBytes("KeePassFerry v1");
        private static readonly Regex ClientIdPattern = new Regex("^[A-Za-z0-9-]{8,64}$");

        private readonly PipeClientTransport _raw;
        private readonly object _sendLock = new object();
        private byte[] _sendKey;
        private byte[] _receiveKey;
        private ulong _sendCounter;
        private ulong _receiveCounter;

        public string ClientId { get; private set; }
        public string ClientName { get; private set; }
        public string[] ClientFeatures { get; private set; }
        public bool IsSecure { get { return true; } }

        private SecureChannel(PipeClientTransport raw)
        {
            _raw = raw;
        }

        /// <summary>
        /// Führt den Handshake als Server aus. Gibt null zurück, wenn er scheitert oder die Kopplung abgelehnt wird.
        /// confirmPairing(clientName, code) zeigt den Prüfcode in KeePass an und liefert die Entscheidung.
        /// </summary>
        public static SecureChannel Accept(PipeClientTransport raw, FerryIdentity identity, string[] serverFeatures,
            Func<string, string, bool> confirmPairing)
        {
            var channel = new SecureChannel(raw);
            try
            {
                JsonObject hello = ReadJson(raw);
                if (hello == null || (string)hello["ferry"] != "hello" || Convert.ToInt32(hello["v"]) != 1) return null;

                string clientId = (string)hello["clientId"];
                if (clientId == null || !ClientIdPattern.IsMatch(clientId)) return null;
                byte[] clientPub = FromB64((string)hello["clientPub"], 65);
                byte[] clientEph = FromB64((string)hello["eph"], 65);
                byte[] clientNonce = FromB64((string)hello["nonce"], 16);
                string name = (hello["name"] as string) ?? "";
                if (name.Length > 80) name = name.Substring(0, 80);
                channel.ClientId = clientId;
                channel.ClientName = name;
                channel.ClientFeatures = ToStringArray(hello["features"] as JsonArray);

                byte[] serverPub = identity.ServerPublicKey;
                byte[] serverId = Encoding.UTF8.GetBytes(identity.ServerId);
                byte[] serverNonce = new byte[16];
                using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(serverNonce);

                byte[] zHash;
                byte[] serverEph;
                using (var ecdh = new ECDiffieHellmanCng(256))
                {
                    ecdh.KeyDerivationFunction = ECDiffieHellmanKeyDerivationFunction.Hash;
                    ecdh.HashAlgorithm = CngAlgorithm.Sha256;
                    serverEph = FerryCrypto.RawFromCngPublicBlob(ecdh.PublicKey.ToByteArray());
                    using (CngKey peer = FerryCrypto.ImportRawPublicKey(clientEph, false))
                        zHash = ecdh.DeriveKeyMaterial(peer);
                }

                byte[] th = FerryCrypto.Sha256(
                    Encoding.ASCII.GetBytes("KeePassFerry handshake v1"), new byte[] { 0 },
                    Encoding.UTF8.GetBytes(clientId), new byte[] { 0 }, clientPub, clientEph, clientNonce,
                    serverId, new byte[] { 0 }, serverPub, serverEph, serverNonce);

                byte[] okm = FerryCrypto.Hkdf(zHash, th, Encoding.ASCII.GetBytes("KeePassFerry keys v1"), 64);
                channel._receiveKey = Slice(okm, 0, 32);
                channel._sendKey = Slice(okm, 32, 32);

                var reply = new JsonObject();
                reply["ferry"] = "hello";
                reply["v"] = 1;
                reply["serverId"] = identity.ServerId;
                reply["serverPub"] = Convert.ToBase64String(serverPub);
                reply["eph"] = Convert.ToBase64String(serverEph);
                reply["nonce"] = Convert.ToBase64String(serverNonce);
                reply["sig"] = Convert.ToBase64String(identity.SignAsServer(Concat(Encoding.ASCII.GetBytes("KeePassFerry server v1"), th)));
                reply["features"] = serverFeatures;
                raw.Send(JsonConvert.ExportToString(reply));

                JsonObject auth = ReadJson(raw);
                if (auth == null || (string)auth["ferry"] != "auth") return null;
                byte[] clientSig = FromB64((string)auth["sig"], 64);
                if (!VerifyClientSignature(clientPub, Concat(Encoding.ASCII.GetBytes("KeePassFerry client v1"), th), clientSig))
                    return null;

                if (!identity.IsClientPaired(clientId, clientPub))
                {
                    var pairing = new JsonObject();
                    pairing["ferry"] = "pairing";
                    raw.Send(JsonConvert.ExportToString(pairing));

                    string code = PairingCode(th);
                    if (!identity.TryBeginPairing(clientId) || !ConfirmAndEnd(identity, clientId, name, code, confirmPairing))
                    {
                        var denied = new JsonObject();
                        denied["ferry"] = "denied";
                        raw.Send(JsonConvert.ExportToString(denied));
                        return null;
                    }
                    identity.StoreClient(clientId, clientPub, name);
                }

                var ready = new JsonObject();
                ready["ferry"] = "ready";
                channel.Send(JsonConvert.ExportToString(ready));
                return channel;
            }
            catch (Exception)
            {
                // Ungültige Daten oder Kryptofehler: Verbindung wird verworfen
                return null;
            }
        }

        private static bool ConfirmAndEnd(FerryIdentity identity, string clientId, string name, string code, Func<string, string, bool> confirmPairing)
        {
            bool accepted = false;
            try
            {
                accepted = confirmPairing(name, code);
                return accepted;
            }
            finally
            {
                identity.EndPairing(clientId, accepted);
            }
        }

        public static string PairingCode(byte[] th)
        {
            byte[] h = FerryCrypto.Sha256(Encoding.ASCII.GetBytes("KeePassFerry SAS v1"), th);
            uint v = ((uint)h[0] << 24) | ((uint)h[1] << 16) | ((uint)h[2] << 8) | h[3];
            return (v % 1000000).ToString("D6");
        }

        private static bool VerifyClientSignature(byte[] clientPub, byte[] data, byte[] sig)
        {
            using (CngKey key = FerryCrypto.ImportRawPublicKey(clientPub, true))
            using (var ecdsa = new ECDsaCng(key))
            {
                ecdsa.HashAlgorithm = CngAlgorithm.Sha256;
                return ecdsa.VerifyData(data, sig);
            }
        }

        /// <summary>
        /// Nächste entschlüsselte Nachricht; null bei geschlossener Verbindung. Wirft bei Manipulation oder falschem Zähler.
        /// </summary>
        public string Receive()
        {
            string text = _raw.ReadMessage();
            if (text == null) return null;
            var frame = (JsonObject)JsonConvert.Import(text);
            if ((string)frame["ferry"] != "m") throw new CryptographicException("Unexpected frame");
            ulong n = Convert.ToUInt64(frame["n"]);
            if (n != _receiveCounter + 1) throw new CryptographicException("Unexpected message counter");
            byte[] plain = FerryCrypto.GcmDecrypt(_receiveKey, FerryCrypto.CounterNonce(n), Convert.FromBase64String((string)frame["c"]), Aad);
            _receiveCounter = n;
            return Encoding.UTF8.GetString(plain);
        }

        public void Send(string message)
        {
            lock (_sendLock)
            {
                ulong n = ++_sendCounter;
                byte[] c = FerryCrypto.GcmEncrypt(_sendKey, FerryCrypto.CounterNonce(n), Encoding.UTF8.GetBytes(message), Aad);
                var frame = new JsonObject();
                frame["ferry"] = "m";
                frame["n"] = (long)n;
                frame["c"] = Convert.ToBase64String(c);
                _raw.Send(JsonConvert.ExportToString(frame));
            }
        }

        public void Close()
        {
            _raw.Close();
        }

        private static JsonObject ReadJson(PipeClientTransport raw)
        {
            string text = raw.ReadMessage();
            if (text == null || text.Length > 16384) return null;
            return JsonConvert.Import(text) as JsonObject;
        }

        private static byte[] FromB64(string s, int expectedLength)
        {
            byte[] b = Convert.FromBase64String(s ?? "");
            if (b.Length != expectedLength) throw new CryptographicException("Unexpected field length");
            return b;
        }

        private static string[] ToStringArray(JsonArray array)
        {
            var list = new List<string>();
            if (array != null)
                foreach (object o in array)
                    if (o is string && list.Count < 64) list.Add((string)o);
            return list.ToArray();
        }

        private static byte[] Slice(byte[] b, int offset, int length)
        {
            var r = new byte[length];
            Buffer.BlockCopy(b, offset, r, 0, length);
            return r;
        }

        private static byte[] Concat(byte[] a, byte[] b)
        {
            var r = new byte[a.Length + b.Length];
            Buffer.BlockCopy(a, 0, r, 0, a.Length);
            Buffer.BlockCopy(b, 0, r, a.Length, b.Length);
            return r;
        }
    }

    /// <summary>
    /// Server-Identität (P-256-Signaturschlüssel, per DPAPI geschützt in der KeePass-Konfiguration)
    /// und gekoppelte Clients (öffentlicher Schlüssel je Client-ID)
    /// </summary>
    public sealed class FerryIdentity
    {
        private const string KeyServerId = "KeePassFerry.ServerId";
        private const string KeyServerKey = "KeePassFerry.ServerKey";
        private const string KeyClientPrefix = "KeePassFerry.Client.";
        private static readonly byte[] DpapiEntropy = Encoding.ASCII.GetBytes("KeePassFerry server key v1");

        private readonly IPluginHost _host;
        private readonly CngKey _serverKey;
        private readonly object _lock = new object();
        private readonly object _pairingLock = new object();
        private bool _pairingInProgress;
        private readonly Dictionary<string, DateTime> _declinedAt = new Dictionary<string, DateTime>();

        public string ServerId { get; private set; }
        public byte[] ServerPublicKey { get; private set; }

        public FerryIdentity(IPluginHost host)
        {
            _host = host;
            ServerId = host.CustomConfig.GetString(KeyServerId, "");
            _serverKey = LoadServerKey();
            if (_serverKey == null || string.IsNullOrEmpty(ServerId))
            {
                _serverKey = CreateServerKey();
                ServerId = Guid.NewGuid().ToString();
                host.CustomConfig.SetString(KeyServerId, ServerId);
            }
            ServerPublicKey = FerryCrypto.RawFromCngPublicBlob(_serverKey.Export(CngKeyBlobFormat.EccPublicBlob));
        }

        private CngKey LoadServerKey()
        {
            string stored = _host.CustomConfig.GetString(KeyServerKey, "");
            if (string.IsNullOrEmpty(stored)) return null;
            try
            {
                byte[] blob = ProtectedData.Unprotect(Convert.FromBase64String(stored), DpapiEntropy, DataProtectionScope.CurrentUser);
                return CngKey.Import(blob, CngKeyBlobFormat.EccPrivateBlob);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private CngKey CreateServerKey()
        {
            var parameters = new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport };
            CngKey key = CngKey.Create(CngAlgorithm.ECDsaP256, null, parameters);
            byte[] blob = key.Export(CngKeyBlobFormat.EccPrivateBlob);
            byte[] protectedBlob = ProtectedData.Protect(blob, DpapiEntropy, DataProtectionScope.CurrentUser);
            Array.Clear(blob, 0, blob.Length);
            _host.CustomConfig.SetString(KeyServerKey, Convert.ToBase64String(protectedBlob));
            return key;
        }

        public byte[] SignAsServer(byte[] data)
        {
            lock (_lock)
            {
                using (var ecdsa = new ECDsaCng(_serverKey))
                {
                    ecdsa.HashAlgorithm = CngAlgorithm.Sha256;
                    return ecdsa.SignData(data);
                }
            }
        }

        public bool IsClientPaired(string clientId, byte[] clientPub)
        {
            string stored = _host.CustomConfig.GetString(KeyClientPrefix + clientId, "");
            if (string.IsNullOrEmpty(stored)) return false;
            string[] parts = stored.Split('|');
            try
            {
                return FerryCrypto.FixedTimeEquals(Convert.FromBase64String(parts[0]), clientPub);
            }
            catch (FormatException)
            {
                return false;
            }
        }

        // Höchstens ein Kopplungsdialog gleichzeitig; nach Ablehnung 2 Minuten keine neue Anfrage dieses Clients
        public bool TryBeginPairing(string clientId)
        {
            lock (_pairingLock)
            {
                DateTime declined;
                if (_declinedAt.TryGetValue(clientId, out declined) && DateTime.UtcNow - declined < TimeSpan.FromMinutes(2))
                    return false;
                if (_pairingInProgress) return false;
                _pairingInProgress = true;
                return true;
            }
        }

        public void EndPairing(string clientId, bool accepted)
        {
            lock (_pairingLock)
            {
                _pairingInProgress = false;
                if (accepted) _declinedAt.Remove(clientId);
                else _declinedAt[clientId] = DateTime.UtcNow;
            }
        }

        public void StoreClient(string clientId, byte[] clientPub, string name)
        {
            string value = Convert.ToBase64String(clientPub) + "|" + Convert.ToBase64String(Encoding.UTF8.GetBytes(name ?? "")) + "|" + DateTime.UtcNow.ToString("o");
            _host.CustomConfig.SetString(KeyClientPrefix + clientId, value);
        }

        /// <summary>Gekoppelter Browser (für die Anzeige in den Optionen)</summary>
        public sealed class PairedClient
        {
            public string Id;
            public string Name;
            public DateTime? PairedAt;
        }

        /// <summary>
        /// Alle gekoppelten Browser. KeePass bietet keine Aufzählung der Konfiguration; die Einträge werden
        /// per Reflection gelesen (wie in KeePassRPC). Klappt das nicht, ist die Liste leer.
        /// </summary>
        public List<PairedClient> PairedClients()
        {
            var result = new List<PairedClient>();
            Dictionary<string, string> items = null;
            try
            {
                var type = typeof(KeePass.App.Configuration.AceCustomConfig);
                var field = type.GetField("m_vItems", BindingFlags.NonPublic | BindingFlags.Instance)
                            ?? type.GetField("m_d", BindingFlags.NonPublic | BindingFlags.Instance);
                if (field != null) items = field.GetValue(_host.CustomConfig) as Dictionary<string, string>;
            }
            catch (Exception)
            {
                items = null;
            }
            if (items == null) return result;

            foreach (KeyValuePair<string, string> kvp in items)
            {
                if (!kvp.Key.StartsWith(KeyClientPrefix, StringComparison.Ordinal) || string.IsNullOrEmpty(kvp.Value)) continue;
                string[] parts = kvp.Value.Split('|');
                var client = new PairedClient { Id = kvp.Key.Substring(KeyClientPrefix.Length), Name = "" };
                try
                {
                    if (parts.Length > 1) client.Name = Encoding.UTF8.GetString(Convert.FromBase64String(parts[1]));
                }
                catch (FormatException)
                {
                    client.Name = "";
                }
                DateTime pairedAt;
                if (parts.Length > 2 && DateTime.TryParse(parts[2], null, System.Globalization.DateTimeStyles.RoundtripKind, out pairedAt))
                    client.PairedAt = pairedAt.ToLocalTime();
                result.Add(client);
            }
            return result;
        }

        /// <summary>Kopplung aufheben: Der Browser muss sich beim nächsten Verbinden neu koppeln (Prüfcode)</summary>
        public void RemoveClient(string clientId)
        {
            _host.CustomConfig.SetString(KeyClientPrefix + clientId, null);
        }
    }
}
