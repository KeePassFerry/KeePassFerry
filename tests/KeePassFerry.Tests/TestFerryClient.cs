using System;
using System.Security.Cryptography;
using System.Text;
using Jayrock.Json;
using Jayrock.Json.Conversion;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Client-Seite des Protokolls v1 für Tests (wie extension/src/background/FerryChannel.ts), mit Stellschrauben
    /// für Manipulationen. Prüft die Server-Signatur und leitet die Schlüssel selbst ab.
    /// </summary>
    internal sealed class TestFerryClient : IDisposable
    {
        private static readonly byte[] Aad = Encoding.ASCII.GetBytes("KeePassFerry v1");

        private readonly PipePair _pipe;
        private readonly CngKey _identity;
        private readonly ECDiffieHellmanCng _eph;
        private readonly byte[] _clientPub;
        private readonly byte[] _ephPub;
        private readonly byte[] _clientNonce = Random(16);

        public string ClientId { get; }
        public byte[] SasNonce { get; set; } = Random(32);
        public bool UseCommit { get; set; } = true;
        public byte[] Th { get; private set; }
        public string ServerId { get; private set; }
        public byte[] ServerPub { get; private set; }
        public string[] ServerFeatures { get; private set; }
        public byte[] SendKey { get; private set; }
        public byte[] ReceiveKey { get; private set; }
        public ulong SendCounter { get; set; }
        public ulong ReceiveCounter { get; private set; }

        public TestFerryClient(PipePair pipe, CngKey identity, string clientId = null)
        {
            _pipe = pipe;
            _identity = identity;
            ClientId = clientId ?? Guid.NewGuid().ToString();
            _clientPub = FerryCrypto.RawFromCngPublicBlob(identity.Export(CngKeyBlobFormat.EccPublicBlob));
            _eph = new ECDiffieHellmanCng(256)
            {
                KeyDerivationFunction = ECDiffieHellmanKeyDerivationFunction.Hash,
                HashAlgorithm = CngAlgorithm.Sha256
            };
            _ephPub = FerryCrypto.RawFromCngPublicBlob(_eph.PublicKey.ToByteArray());
        }

        public static CngKey NewIdentity()
        {
            return CngKey.Create(CngAlgorithm.ECDsaP256, null,
                new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport });
        }

        public static byte[] Random(int length)
        {
            var b = new byte[length];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return b;
        }

        public byte[] ClientPub => _clientPub;
        public PipePair Pipe => _pipe;

        public JsonObject BuildHello()
        {
            var hello = new JsonObject();
            hello["ferry"] = "hello";
            hello["v"] = 1;
            hello["clientId"] = ClientId;
            hello["clientPub"] = Convert.ToBase64String(_clientPub);
            hello["eph"] = Convert.ToBase64String(_ephPub);
            hello["nonce"] = Convert.ToBase64String(_clientNonce);
            hello["name"] = "Test client";
            hello["features"] = new[] { "KPRPC_FEATURE_VERSION_1_6" };
            if (UseCommit)
                hello["sasCommit"] = Convert.ToBase64String(FerryCrypto.Sha256(Encoding.ASCII.GetBytes("KeePassFerry SAS commit v2"), SasNonce));
            return hello;
        }

        public void SendHello(JsonObject hello = null)
        {
            _pipe.WriteFrame(JsonConvert.ExportToString(hello ?? BuildHello()));
        }

        /// <summary>Liest das Server-Hello, prüft die Signatur, leitet Schlüssel und Prüfcode ab</summary>
        public void ReadServerHello()
        {
            var hello = (JsonObject)JsonConvert.Import(_pipe.ReadFrame());
            if ((string)hello["ferry"] != "hello") throw new InvalidOperationException("Expected hello, got " + hello["ferry"]);
            ServerId = (string)hello["serverId"];
            ServerPub = Convert.FromBase64String((string)hello["serverPub"]);
            byte[] serverEph = Convert.FromBase64String((string)hello["eph"]);
            byte[] serverNonce = Convert.FromBase64String((string)hello["nonce"]);
            byte[] sig = Convert.FromBase64String((string)hello["sig"]);
            var features = (JsonArray)hello["features"];
            ServerFeatures = new string[features.Count];
            for (int i = 0; i < features.Count; i++) ServerFeatures[i] = (string)features[i];

            Th = FerryCrypto.Sha256(
                Encoding.ASCII.GetBytes("KeePassFerry handshake v1"), new byte[] { 0 },
                Encoding.UTF8.GetBytes(ClientId), new byte[] { 0 }, _clientPub, _ephPub, _clientNonce,
                Encoding.UTF8.GetBytes(ServerId), new byte[] { 0 }, ServerPub, serverEph, serverNonce);

            using (CngKey serverKey = FerryCrypto.ImportRawPublicKey(ServerPub, true))
            using (var ecdsa = new ECDsaCng(serverKey) { HashAlgorithm = CngAlgorithm.Sha256 })
                if (!ecdsa.VerifyData(Concat(Encoding.ASCII.GetBytes("KeePassFerry server v1"), Th), sig))
                    throw new CryptographicException("Invalid server signature");

            byte[] zHash;
            using (CngKey peer = FerryCrypto.ImportRawPublicKey(serverEph, false))
                zHash = _eph.DeriveKeyMaterial(peer);
            byte[] okm = FerryCrypto.Hkdf(zHash, Th, Encoding.ASCII.GetBytes("KeePassFerry keys v1"), 64);
            SendKey = new byte[32];
            ReceiveKey = new byte[32];
            Buffer.BlockCopy(okm, 0, SendKey, 0, 32);
            Buffer.BlockCopy(okm, 32, ReceiveKey, 0, 32);
        }

        public string ExpectedCode => UseCommit ? SecureChannel.PairingCodeV2(Th, SasNonce) : SecureChannel.PairingCode(Th);

        public byte[] SignTranscript()
        {
            using (var ecdsa = new ECDsaCng(_identity) { HashAlgorithm = CngAlgorithm.Sha256 })
                return ecdsa.SignData(Concat(Encoding.ASCII.GetBytes("KeePassFerry client v1"), Th));
        }

        public void SendAuth(byte[] signature = null, byte[] sasNonce = null)
        {
            var auth = new JsonObject();
            auth["ferry"] = "auth";
            auth["sig"] = Convert.ToBase64String(signature ?? SignTranscript());
            if (UseCommit) auth["sasNonce"] = Convert.ToBase64String(sasNonce ?? SasNonce);
            _pipe.WriteFrame(JsonConvert.ExportToString(auth));
        }

        /// <summary>Nächster Rahmen als JSON; null bei geschlossener Verbindung</summary>
        public JsonObject ReadFrame()
        {
            string text = _pipe.ReadFrame();
            return text == null ? null : (JsonObject)JsonConvert.Import(text);
        }

        public string Decrypt(JsonObject frame)
        {
            if ((string)frame["ferry"] != "m") throw new InvalidOperationException("Expected encrypted frame, got " + frame["ferry"]);
            ulong n = Convert.ToUInt64(frame["n"]);
            if (n != ReceiveCounter + 1) throw new CryptographicException("Unexpected counter " + n);
            byte[] plain = FerryCrypto.GcmDecrypt(ReceiveKey, FerryCrypto.CounterNonce(n), Convert.FromBase64String((string)frame["c"]), Aad);
            ReceiveCounter = n;
            return Encoding.UTF8.GetString(plain);
        }

        public string EncryptFrame(string text, ulong counter)
        {
            byte[] c = FerryCrypto.GcmEncrypt(SendKey, FerryCrypto.CounterNonce(counter), Encoding.UTF8.GetBytes(text), Aad);
            var frame = new JsonObject();
            frame["ferry"] = "m";
            frame["n"] = (long)counter;
            frame["c"] = Convert.ToBase64String(c);
            return JsonConvert.ExportToString(frame);
        }

        public void Send(string text)
        {
            _pipe.WriteFrame(EncryptFrame(text, ++SendCounter));
        }

        /// <summary>Kompletter Handshake; Rückgabe: Rahmen vor "ready" ("pairing" bei neuer Kopplung) oder "denied"</summary>
        public string Handshake()
        {
            SendHello();
            ReadServerHello();
            SendAuth();
            JsonObject frame = ReadFrame();
            string before = null;
            if (frame != null && (string)frame["ferry"] == "pairing")
            {
                before = "pairing";
                frame = ReadFrame();
            }
            if (frame == null) return "closed";
            if ((string)frame["ferry"] == "denied") return "denied";
            string ready = Decrypt(frame);
            if (ready != "{\"ferry\":\"ready\"}") throw new InvalidOperationException("Expected ready, got " + ready);
            return before ?? "ready";
        }

        private static byte[] Concat(byte[] a, byte[] b)
        {
            var r = new byte[a.Length + b.Length];
            Buffer.BlockCopy(a, 0, r, 0, a.Length);
            Buffer.BlockCopy(b, 0, r, a.Length, b.Length);
            return r;
        }

        public void Dispose()
        {
            _eph.Dispose();
        }
    }
}
