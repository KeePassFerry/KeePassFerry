using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Jayrock.Json;
using Jayrock.Json.Conversion;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Die echte Client-Implementierung der Erweiterung (extension/src/background/FerryChannel.ts, über
    /// extension/scripts/ferry-channel-test.ts in Node) gegen den echten Server (SecureChannel.Accept).
    /// Braucht Node und extension/node_modules (npm ci). Fehlt das, wird der Test als "nicht ausgeführt" gemeldet;
    /// mit KPF_REQUIRE_INTEROP=1 (CI) schlägt er stattdessen fehl.
    /// </summary>
    [TestClass]
    public class ExtensionInteropTests
    {
        private static string _extensionDir;

        private static string FindExtensionDir()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "extension", "package.json"))) dir = dir.Parent;
            return dir == null ? null : Path.Combine(dir.FullName, "extension");
        }

        private static void RequireNode()
        {
            _extensionDir = _extensionDir ?? FindExtensionDir();
            string missing = null;
            if (_extensionDir == null) missing = "extension folder not found";
            else if (!File.Exists(Path.Combine(_extensionDir, "node_modules", "esno", "esno.js"))) missing = "extension/node_modules missing (npm ci)";
            if (missing == null) return;
            if (Environment.GetEnvironmentVariable("KPF_REQUIRE_INTEROP") == "1") Assert.Fail(missing);
            Assert.Inconclusive(missing);
        }

        private sealed class NodeRun
        {
            public int ExitCode;
            public string Output;
        }

        private static Process StartNode(string script, Dictionary<string, string> env, params string[] args)
        {
            var psi = new ProcessStartInfo("node")
            {
                Arguments = "\"" + Path.Combine(_extensionDir, "node_modules", "esno", "esno.js") + "\" " + script + " " + string.Join(" ", args),
                WorkingDirectory = _extensionDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                CreateNoWindow = true
            };
            if (env != null) foreach (var kv in env) psi.EnvironmentVariables[kv.Key] = kv.Value;
            return Process.Start(psi);
        }

        private static NodeRun Finish(Process p, int timeoutMs = 60000)
        {
            Task<string> stdout = p.StandardOutput.ReadToEndAsync();
            Task<string> stderr = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(timeoutMs))
            {
                try { p.Kill(); } catch (Exception) { }
                Assert.Fail("Node client did not finish");
            }
            p.WaitForExit();
            return new NodeRun { ExitCode = p.ExitCode, Output = stdout.Result + stderr.Result };
        }

        private sealed class Server
        {
            public string PipeName = "keepassferry-test-" + Guid.NewGuid().ToString("N");
            public FerryIdentity Identity = new FerryIdentity(new FakePluginHost());
            public readonly List<string> ShownCodes = new List<string>();
            public bool Accept = true;
            public Exception ReceiveError;
            public string Received;

            /// <summary>Eine Verbindung bedienen: Handshake, eine Anfrage beantworten (wie GetAllDatabases)</summary>
            public Task Serve()
            {
                var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536);
                return Task.Run(() =>
                {
                    try
                    {
                        pipe.WaitForConnection();
                        var transport = new PipeClientTransport(pipe);
                        SecureChannel channel = SecureChannel.Accept(transport, Identity,
                            new[] { "KPRPC_FEATURE_VERSION_1_6", SecureChannel.PairingCommitFeature },
                            (name, code) =>
                            {
                                lock (ShownCodes) ShownCodes.Add(code);
                                return Accept ? name : null;
                            });
                        if (channel == null) return;
                        try
                        {
                            Received = channel.Receive();
                            var request = (JsonObject)JsonConvert.Import(Received);
                            var reply = new JsonObject();
                            reply["jsonrpc"] = "2.0";
                            reply["id"] = request["id"];
                            var db = new JsonObject();
                            db["name"] = "Disposable";
                            reply["result"] = new JsonArray(new object[] { db });
                            channel.Send(JsonConvert.ExportToString(reply));
                            channel.Receive(); // bis der Client trennt
                        }
                        catch (Exception ex)
                        {
                            ReceiveError = ex;
                        }
                        channel.Close();
                    }
                    finally
                    {
                        pipe.Dispose();
                    }
                });
            }
        }

        private static string StateFile()
        {
            return Path.Combine(Path.GetTempPath(), "kpf-interop-" + Guid.NewGuid().ToString("N") + ".json");
        }

        private static string Code(string output)
        {
            Match m = Regex.Match(output, @"PRÜFCODE (\d{6})");
            return m.Success ? m.Groups[1].Value : null;
        }

        [TestMethod]
        public void ExtensionClient_PairsReconnectsAndTalksToPlugin()
        {
            RequireNode();
            var server = new Server();
            string state = StateFile();
            try
            {
                // 1. Erste Verbindung: Kopplung mit gleichem Code auf beiden Seiten, dann eine Anfrage
                Task serving = server.Serve();
                NodeRun run = Finish(StartNode("scripts/ferry-channel-test.ts", null, server.PipeName, "\"" + state + "\""));
                Assert.IsTrue(serving.Wait(10000));
                Assert.AreEqual(0, run.ExitCode, run.Output);
                StringAssert.Contains(run.Output, "ANTWORT GetAllDatabases: 1 Datenbank(en), Name: Disposable");
                Assert.AreEqual(1, server.ShownCodes.Count);
                Assert.AreEqual(server.ShownCodes[0], Code(run.Output), "Browser and KeePass show the same code");
                StringAssert.Contains(server.Received, "\"GetAllDatabases\"");

                // 2. Wiederverbinden: gemerkter Server-Schlüssel, keine neue Kopplung
                serving = server.Serve();
                run = Finish(StartNode("scripts/ferry-channel-test.ts", null, server.PipeName, "\"" + state + "\""));
                Assert.IsTrue(serving.Wait(10000));
                Assert.AreEqual(0, run.ExitCode, run.Output);
                Assert.IsNull(Code(run.Output), "No pairing on reconnect");
                Assert.AreEqual(1, server.ShownCodes.Count);

                // 3. Manipulierte Nachricht (TAMPER=1): Plugin verwirft sie
                serving = server.Serve();
                run = Finish(StartNode("scripts/ferry-channel-test.ts",
                    new Dictionary<string, string> { { "TAMPER", "1" }, { "TIMEOUT_MS", "4000" } }, server.PipeName, "\"" + state + "\""));
                Assert.IsTrue(serving.Wait(10000));
                Assert.IsInstanceOfType(server.ReceiveError, typeof(CryptographicException), run.Output);
                Assert.AreNotEqual(0, run.ExitCode);
            }
            finally
            {
                if (File.Exists(state)) File.Delete(state);
            }
        }

        [TestMethod]
        public void ExtensionClient_RejectsChangedServerKey()
        {
            RequireNode();
            var server = new Server();
            string state = StateFile();
            try
            {
                Task serving = server.Serve();
                Assert.AreEqual(0, Finish(StartNode("scripts/ferry-channel-test.ts", null, server.PipeName, "\"" + state + "\"")).ExitCode);
                Assert.IsTrue(serving.Wait(10000));

                // Anderes KeePass mit derselben Server-ID (z. B. ausgetauschter Schlüssel): Erweiterung bricht ab
                var json = (JsonObject)JsonConvert.Import(File.ReadAllText(state));
                var pins = (JsonObject)json["pins"];
                string serverId = null;
                foreach (string name in pins.Names) serverId = name;
                using (CngKey other = TestFerryClient.NewIdentity())
                    pins[serverId] = Convert.ToBase64String(FerryCrypto.RawFromCngPublicBlob(other.Export(CngKeyBlobFormat.EccPublicBlob)));
                File.WriteAllText(state, JsonConvert.ExportToString(json));

                serving = server.Serve();
                NodeRun run = Finish(StartNode("scripts/ferry-channel-test.ts", null, server.PipeName, "\"" + state + "\""));
                Assert.AreEqual(3, run.ExitCode, run.Output);
                StringAssert.Contains(run.Output, "SERVER_KEY_CHANGED");
                Assert.IsTrue(serving.Wait(10000));
                Assert.AreEqual(1, server.ShownCodes.Count, "No pairing dialog for a client that aborted");
            }
            finally
            {
                if (File.Exists(state)) File.Delete(state);
            }
        }

        [TestMethod]
        public void ExtensionClient_ReportsDeclinedPairing()
        {
            RequireNode();
            var server = new Server { Accept = false };
            string state = StateFile();
            try
            {
                Task serving = server.Serve();
                NodeRun run = Finish(StartNode("scripts/ferry-channel-test.ts", null, server.PipeName, "\"" + state + "\""));
                Assert.IsTrue(serving.Wait(10000));
                Assert.AreEqual(2, run.ExitCode, run.Output);
                StringAssert.Contains(run.Output, "ABGELEHNT");
            }
            finally
            {
                if (File.Exists(state)) File.Delete(state);
            }
        }

        [TestMethod]
        public void PasskeyAssertion_VerifiesWithWebCrypto_LikeAWebsite()
        {
            RequireNode();
            var cases = new JsonArray();
            for (int i = 0; i < 16; i++)
            {
                byte[] rawPub;
                string pem;
                using (CngKey key = CngKey.Create(CngAlgorithm.ECDsaP256, null,
                           new CngKeyCreationParameters { ExportPolicy = CngExportPolicies.AllowPlaintextExport }))
                {
                    pem = PasskeyCrypto.ToPem(key.Export(CngKeyBlobFormat.Pkcs8PrivateBlob));
                    rawPub = FerryCrypto.RawFromCngPublicBlob(key.Export(CngKeyBlobFormat.EccPublicBlob));
                }
                byte[] authData = PasskeyCrypto.BuildAuthData("example.com", 0x1D, null, null);
                byte[] cdh = TestFerryClient.Random(32);
                var c = new JsonObject();
                c["spki"] = Convert.ToBase64String(PasskeyCrypto.SpkiP256(rawPub));
                c["authData"] = Convert.ToBase64String(authData);
                c["clientDataHash"] = Convert.ToBase64String(cdh);
                c["signature"] = Convert.ToBase64String(PasskeyCrypto.Sign(pem, authData, cdh));
                cases.Add(c);
            }
            string file = StateFile();
            try
            {
                File.WriteAllText(file, JsonConvert.ExportToString(cases));
                NodeRun run = Finish(StartNode("scripts/passkey-verify.ts", null, "\"" + file + "\""));
                Assert.AreEqual(0, run.ExitCode, run.Output);
                StringAssert.Contains(run.Output, "OK 16/16");
            }
            finally
            {
                if (File.Exists(file)) File.Delete(file);
            }
        }
    }
}
