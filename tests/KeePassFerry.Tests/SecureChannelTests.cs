using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Jayrock.Json;
using Jayrock.Json.Conversion;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Handshake und Nachrichten des verschlüsselten Kanals über eine echte Named Pipe, Server = SecureChannel.Accept
    /// mit echter FerryIdentity (Schlüssel per DPAPI). Die Bestätigung der Kopplung, in KeePass ein Dialog, gibt der Test
    /// als Funktion vor; das Plugin selbst hat dafür keinen Umgehungsweg.
    /// </summary>
    [TestClass]
    public class SecureChannelTests
    {
        private static readonly string[] ServerFeatures = { "KPRPC_FEATURE_VERSION_1_6", SecureChannel.PairingCommitFeature };

        private FakePluginHost _host;
        private FerryIdentity _identity;
        private readonly List<string> _shownCodes = new List<string>();
        private Func<string, string, string> _confirm;

        [TestInitialize]
        public void Init()
        {
            _host = new FakePluginHost();
            _identity = new FerryIdentity(_host);
            _shownCodes.Clear();
            _confirm = (name, code) => "Paired " + name;
        }

        private string Dialog(string name, string code)
        {
            lock (_shownCodes) _shownCodes.Add(code);
            return _confirm(name, code);
        }

        private Task<SecureChannel> Accept(PipePair pipe)
        {
            // Wie NativePipeServer.ServeClient: scheitert der Handshake, wird die Verbindung geschlossen
            return Task.Run(() =>
            {
                SecureChannel channel = SecureChannel.Accept(pipe.Transport, _identity, ServerFeatures, Dialog);
                if (channel == null) pipe.Transport.Close();
                return channel;
            });
        }

        private static SecureChannel Result(Task<SecureChannel> server)
        {
            Assert.IsTrue(server.Wait(15000), "Server handshake did not finish");
            return server.Result;
        }

        // ---------- Kopplung ----------

        [TestMethod]
        public void FirstConnection_ShowsMatchingCode_ThenExchangesMessagesBothWays()
        {
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                Assert.AreEqual("pairing", client.Handshake());
                SecureChannel channel = Result(server);
                Assert.IsNotNull(channel);

                Assert.AreEqual(1, _shownCodes.Count);
                Assert.AreEqual(client.ExpectedCode, _shownCodes[0], "KeePass and browser must show the same code");
                CollectionAssert.Contains(client.ServerFeatures, SecureChannel.PairingCommitFeature);
                Assert.AreEqual(client.ClientId, channel.ClientId);
                Assert.AreEqual("Paired Test client", channel.ClientName);
                Assert.IsTrue(_identity.IsClientPaired(client.ClientId, client.ClientPub));

                client.Send("{\"id\":1}");
                client.Send("{\"id\":2,\"text\":\"äöü €\"}");
                Assert.AreEqual("{\"id\":1}", channel.Receive());
                Assert.AreEqual("{\"id\":2,\"text\":\"äöü €\"}", channel.Receive());

                channel.Send("{\"result\":1}");
                Assert.AreEqual("{\"result\":1}", client.Decrypt(client.ReadFrame()));
                Assert.AreEqual(2UL, client.ReceiveCounter); // 1 = ready
            }
        }

        [TestMethod]
        public void LegacyClientWithoutCommit_UsesV1Code()
        {
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key) { UseCommit = false })
            {
                Task<SecureChannel> server = Accept(pipe);
                Assert.AreEqual("pairing", client.Handshake());
                Assert.IsNotNull(Result(server));
                Assert.AreEqual(SecureChannel.PairingCode(client.Th), _shownCodes[0]);
            }
        }

        [TestMethod]
        public void Reconnect_WithPairedKey_NeedsNoConfirmation()
        {
            using (CngKey key = TestFerryClient.NewIdentity())
            {
                string clientId = Guid.NewGuid().ToString();
                using (var pipe = new PipePair())
                using (var client = new TestFerryClient(pipe, key, clientId))
                {
                    Task<SecureChannel> server = Accept(pipe);
                    Assert.AreEqual("pairing", client.Handshake());
                    Assert.IsNotNull(Result(server));
                }
                using (var pipe = new PipePair())
                using (var client = new TestFerryClient(pipe, key, clientId))
                {
                    Task<SecureChannel> server = Accept(pipe);
                    Assert.AreEqual("ready", client.Handshake());
                    Assert.IsNotNull(Result(server));
                }
                Assert.AreEqual(1, _shownCodes.Count);
            }
        }

        [TestMethod]
        public void ServerIdentity_IsStableAcrossRestarts()
        {
            string serverId1, serverId2;
            byte[] pub1, pub2;
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                client.Handshake();
                Result(server);
                serverId1 = client.ServerId;
                pub1 = client.ServerPub;
            }
            _identity = new FerryIdentity(_host); // KeePass neu gestartet: Schlüssel aus der Konfiguration
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                client.Handshake();
                Result(server);
                serverId2 = client.ServerId;
                pub2 = client.ServerPub;
            }
            Assert.AreEqual(serverId1, serverId2);
            CollectionAssert.AreEqual(pub1, pub2);
        }

        [TestMethod]
        public void ChangedClientKey_ForPairedId_RequiresPairingAgain()
        {
            string clientId = Guid.NewGuid().ToString();
            using (CngKey original = TestFerryClient.NewIdentity())
            using (CngKey impostor = TestFerryClient.NewIdentity())
            {
                byte[] originalPub;
                using (var pipe = new PipePair())
                using (var client = new TestFerryClient(pipe, original, clientId))
                {
                    Task<SecureChannel> server = Accept(pipe);
                    Assert.AreEqual("pairing", client.Handshake());
                    Result(server);
                    originalPub = client.ClientPub;
                }

                _confirm = (name, code) => null; // Nutzer lehnt ab
                using (var pipe = new PipePair())
                using (var client = new TestFerryClient(pipe, impostor, clientId))
                {
                    Task<SecureChannel> server = Accept(pipe);
                    Assert.AreEqual("denied", client.Handshake());
                    Assert.IsNull(Result(server));
                }
                Assert.AreEqual(2, _shownCodes.Count, "Changed key must go through the pairing dialog");
                Assert.IsTrue(_identity.IsClientPaired(clientId, originalPub), "Stored key must stay unchanged");
            }
        }

        [TestMethod]
        public void DeclinedPairing_IsDenied_AndNotAskedAgainRightAway()
        {
            _confirm = (name, code) => null;
            using (CngKey key = TestFerryClient.NewIdentity())
            {
                string clientId = Guid.NewGuid().ToString();
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    using (var pipe = new PipePair())
                    using (var client = new TestFerryClient(pipe, key, clientId))
                    {
                        Task<SecureChannel> server = Accept(pipe);
                        Assert.AreEqual("denied", client.Handshake());
                        Assert.IsNull(Result(server));
                    }
                }
                Assert.AreEqual(1, _shownCodes.Count, "Second attempt within the cooldown must not open the dialog");
                Assert.IsFalse(_identity.IsClientPaired(clientId, new byte[65]));
            }
        }

        // ---------- Abgelehnte Handshakes ----------

        private void AssertRejectedAfterServerHello(Action<TestFerryClient> sendAuth)
        {
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                client.SendHello();
                client.ReadServerHello();
                sendAuth(client);
                Assert.IsNull(Result(server));
                Assert.IsNull(client.ReadFrame(), "Server must close without further messages");
                Assert.AreEqual(0, _shownCodes.Count, "No pairing dialog for a failed handshake");
                Assert.IsFalse(_identity.IsClientPaired(client.ClientId, client.ClientPub));
            }
        }

        [TestMethod]
        public void InvalidClientSignature_IsRejected()
        {
            AssertRejectedAfterServerHello(client =>
            {
                byte[] sig = client.SignTranscript();
                sig[10] ^= 0x01;
                client.SendAuth(sig);
            });
        }

        [TestMethod]
        public void SignatureFromOtherKey_IsRejected()
        {
            AssertRejectedAfterServerHello(client =>
            {
                using (CngKey other = TestFerryClient.NewIdentity())
                using (var ecdsa = new ECDsaCng(other) { HashAlgorithm = CngAlgorithm.Sha256 })
                {
                    byte[] data = new byte[22 + client.Th.Length];
                    Encoding.ASCII.GetBytes("KeePassFerry client v1").CopyTo(data, 0);
                    client.Th.CopyTo(data, 22);
                    client.SendAuth(ecdsa.SignData(data));
                }
            });
        }

        [TestMethod]
        public void SasNonceNotMatchingCommit_IsRejected()
        {
            AssertRejectedAfterServerHello(client => client.SendAuth(null, TestFerryClient.Random(32)));
        }

        [TestMethod]
        public void MissingSasNonceAfterCommit_IsRejected()
        {
            AssertRejectedAfterServerHello(client =>
            {
                client.UseCommit = false; // Auth ohne sasNonce, obwohl das Hello einen Commit hatte
                client.SendAuth();
            });
        }

        [TestMethod]
        public void WrongAuthFrame_IsRejected()
        {
            AssertRejectedAfterServerHello(client =>
            {
                var frame = new JsonObject();
                frame["ferry"] = "hello";
                frame["sig"] = Convert.ToBase64String(client.SignTranscript());
                client.Pipe.WriteFrame(JsonConvert.ExportToString(frame));
            });
        }

        private void AssertHelloRejected(Func<TestFerryClient, string> buildHello)
        {
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                pipe.WriteFrame(buildHello(client));
                Assert.IsNull(Result(server));
                Assert.IsNull(client.ReadFrame(), "Server must not answer an invalid hello");
                Assert.AreEqual(0, _shownCodes.Count);
            }
        }

        private static string HelloWith(TestFerryClient client, string field, object value)
        {
            JsonObject hello = client.BuildHello();
            if (value == null) hello.Remove(field);
            else hello[field] = value;
            return JsonConvert.ExportToString(hello);
        }

        [TestMethod] public void Hello_WrongVersion_IsRejected() => AssertHelloRejected(c => HelloWith(c, "v", 2));
        [TestMethod] public void Hello_WrongType_IsRejected() => AssertHelloRejected(c => HelloWith(c, "ferry", "auth"));
        [TestMethod] public void Hello_InvalidClientId_IsRejected() => AssertHelloRejected(c => HelloWith(c, "clientId", "../../x"));
        [TestMethod] public void Hello_ShortClientId_IsRejected() => AssertHelloRejected(c => HelloWith(c, "clientId", "abc"));
        [TestMethod] public void Hello_MissingClientKey_IsRejected() => AssertHelloRejected(c => HelloWith(c, "clientPub", null));
        [TestMethod] public void Hello_ShortClientKey_IsRejected() => AssertHelloRejected(c => HelloWith(c, "clientPub", Convert.ToBase64String(new byte[64])));
        [TestMethod] public void Hello_EphemeralKeyNotOnCurve_IsRejected()
        {
            var bad = new byte[65];
            bad[0] = 0x04;
            bad[64] = 7;
            AssertHelloRejected(c => HelloWith(c, "eph", Convert.ToBase64String(bad)));
        }
        [TestMethod] public void Hello_ShortNonce_IsRejected() => AssertHelloRejected(c => HelloWith(c, "nonce", Convert.ToBase64String(new byte[8])));
        [TestMethod] public void Hello_ShortCommit_IsRejected() => AssertHelloRejected(c => HelloWith(c, "sasCommit", Convert.ToBase64String(new byte[16])));
        [TestMethod] public void Hello_NotBase64_IsRejected() => AssertHelloRejected(c => HelloWith(c, "eph", "%%%"));
        [TestMethod] public void Hello_NotJson_IsRejected() => AssertHelloRejected(c => "{\"ferry\":\"hello\",");
        [TestMethod] public void Hello_JsonArray_IsRejected() => AssertHelloRejected(c => "[1,2,3]");
        [TestMethod] public void Hello_TooLarge_IsRejected() => AssertHelloRejected(c => HelloWith(c, "name", new string('x', 20000)));

        [TestMethod]
        public void Hello_OverHandshakeLimit_IsRejectedWithoutReadingBody()
        {
            using (var pipe = new PipePair())
            {
                Task<SecureChannel> server = Accept(pipe);
                pipe.WriteRaw(BitConverter.GetBytes(NativePipeServer.MaxHandshakeMessageBytes + 1));
                Assert.IsNull(Result(server));
            }
        }

        [TestMethod]
        public void Disconnect_DuringHandshake_EndsCleanly()
        {
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                client.SendHello();
                client.ReadServerHello();
                pipe.Client.Dispose();
                Assert.IsNull(Result(server));
            }
        }

        [TestMethod]
        public void Timeout_ClosingTransport_EndsWaitingHandshake()
        {
            using (var pipe = new PipePair())
            {
                Task<SecureChannel> server = Accept(pipe);
                Assert.IsFalse(server.Wait(300));
                pipe.Transport.Close(); // so beendet NativePipeServer einen Handshake nach Zeitablauf
                Assert.IsNull(Result(server));
            }
        }

        // ---------- Nachrichten nach dem Handshake ----------

        private void WithEstablishedChannel(Action<PipePair, TestFerryClient, SecureChannel> test)
        {
            using (var pipe = new PipePair())
            using (CngKey key = TestFerryClient.NewIdentity())
            using (var client = new TestFerryClient(pipe, key))
            {
                Task<SecureChannel> server = Accept(pipe);
                client.Handshake();
                SecureChannel channel = Result(server);
                Assert.IsNotNull(channel);
                test(pipe, client, channel);
            }
        }

        [TestMethod]
        public void ReplayedMessage_IsRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                string first = client.EncryptFrame("{\"id\":1}", 1);
                pipe.WriteFrame(first);
                Assert.AreEqual("{\"id\":1}", channel.Receive());
                pipe.WriteFrame(first);
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void SkippedCounter_IsRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                pipe.WriteFrame(client.EncryptFrame("{\"id\":2}", 2));
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void ReorderedMessages_AreRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                string m1 = client.EncryptFrame("{\"id\":1}", 1);
                string m2 = client.EncryptFrame("{\"id\":2}", 2);
                pipe.WriteFrame(m2);
                pipe.WriteFrame(m1);
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void MessageWithSwappedCounter_IsRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                // Chiffrat für Zähler 2, als Zähler 1 ausgegeben: Nonce passt nicht, Tag schlägt fehl
                var frame = (JsonObject)JsonConvert.Import(client.EncryptFrame("{\"id\":1}", 2));
                frame["n"] = 1;
                pipe.WriteFrame(JsonConvert.ExportToString(frame));
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void TamperedCiphertext_IsRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                var frame = (JsonObject)JsonConvert.Import(client.EncryptFrame("{\"id\":1}", 1));
                byte[] c = Convert.FromBase64String((string)frame["c"]);
                c[0] ^= 0x01;
                frame["c"] = Convert.ToBase64String(c);
                pipe.WriteFrame(JsonConvert.ExportToString(frame));
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void MessageEncryptedWithServerDirectionKey_IsRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                // Spiegelung: eine Nachricht des Servers an ihn zurückgeschickt
                channel.Send("{\"id\":99}");
                var reflected = (JsonObject)JsonConvert.Import(pipe.ReadFrame());
                reflected["n"] = 1;
                pipe.WriteFrame(JsonConvert.ExportToString(reflected));
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void PlaintextFrame_AfterHandshake_IsRejected()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                pipe.WriteFrame("{\"ferry\":\"hello\",\"v\":1}");
                Assert.ThrowsException<CryptographicException>(() => channel.Receive());
            });
        }

        [TestMethod]
        public void MalformedFrames_AfterHandshake_Throw()
        {
            foreach (string bad in new[] { "{\"ferry\":\"m\",\"n\":1,\"c\":\"%%%\"}", "{\"ferry\":\"m\",\"n\":1}", "not json" })
            {
                WithEstablishedChannel((pipe, client, channel) =>
                {
                    pipe.WriteFrame(bad);
                    try
                    {
                        channel.Receive();
                        Assert.Fail("Accepted malformed frame: " + bad);
                    }
                    catch (AssertFailedException)
                    {
                        throw;
                    }
                    catch (Exception)
                    {
                        // erwartet: Verbindung wird verworfen
                    }
                });
            }
        }

        [TestMethod]
        public void ClosedConnection_ReceiveReturnsNull()
        {
            WithEstablishedChannel((pipe, client, channel) =>
            {
                pipe.Client.Dispose();
                Assert.IsNull(channel.Receive());
            });
        }
    }
}
