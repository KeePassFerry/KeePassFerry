using System;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Server-Schlüssel (DPAPI in der KeePass-Konfiguration) und gespeicherte Kopplungen
    /// </summary>
    [TestClass]
    public class FerryIdentityTests
    {
        [TestMethod]
        public void ServerKey_IsStoredProtected_AndReloaded()
        {
            var host = new FakePluginHost();
            var first = new FerryIdentity(host);
            string stored = host.CustomConfig.GetString("KeePassFerry.ServerKey", "");
            Assert.IsFalse(string.IsNullOrEmpty(stored));
            byte[] protectedBlob = Convert.FromBase64String(stored);
            // Der gespeicherte Wert ist der DPAPI-geschützte Schlüssel, nicht der Klartext-Blob ("ECS2" = privater P-256-Schlüssel)
            Assert.AreEqual(-1, Encoding.ASCII.GetString(protectedBlob).IndexOf("ECS2", StringComparison.Ordinal));

            var second = new FerryIdentity(host);
            Assert.AreEqual(first.ServerId, second.ServerId);
            CollectionAssert.AreEqual(first.ServerPublicKey, second.ServerPublicKey);
        }

        [TestMethod]
        public void UnreadableServerKey_IsReplacedWithNewIdentity()
        {
            var host = new FakePluginHost();
            var first = new FerryIdentity(host);
            host.CustomConfig.SetString("KeePassFerry.ServerKey", Convert.ToBase64String(new byte[100]));
            var second = new FerryIdentity(host);
            CollectionAssert.AreNotEqual(first.ServerPublicKey, second.ServerPublicKey);
        }

        [TestMethod]
        public void ServerSignature_VerifiesWithPublishedKey()
        {
            var identity = new FerryIdentity(new FakePluginHost());
            byte[] data = Encoding.ASCII.GetBytes("KeePassFerry server v1 test");
            byte[] sig = identity.SignAsServer(data);
            Assert.AreEqual(64, sig.Length);
            using (CngKey key = FerryCrypto.ImportRawPublicKey(identity.ServerPublicKey, true))
            using (var ecdsa = new ECDsaCng(key) { HashAlgorithm = CngAlgorithm.Sha256 })
            {
                Assert.IsTrue(ecdsa.VerifyData(data, sig));
                data[0] ^= 1;
                Assert.IsFalse(ecdsa.VerifyData(data, sig));
            }
        }

        [TestMethod]
        public void PairedClients_StoreRenameAndRemove()
        {
            var host = new FakePluginHost();
            var identity = new FerryIdentity(host);
            byte[] pub = TestFerryClient.Random(65);
            identity.StoreClient("client-0001", pub, "Edge, Laptop");
            Assert.IsTrue(identity.IsClientPaired("client-0001", pub));
            Assert.IsFalse(identity.IsClientPaired("client-0001", TestFerryClient.Random(65)));
            Assert.IsFalse(identity.IsClientPaired("client-0002", pub));

            identity.RenameClient("client-0001", "  Firefox\u0007 ");
            identity.MarkClientSeen("client-0001");
            var list = identity.PairedClients();
            Assert.AreEqual(1, list.Count);
            Assert.AreEqual("Firefox", list[0].Name);
            Assert.IsNotNull(list[0].PairedAt);
            Assert.IsNotNull(list[0].LastSeen);
            Assert.IsTrue(identity.IsClientPaired("client-0001", pub), "Renaming must keep the key");

            identity.RemoveClient("client-0001");
            Assert.IsFalse(identity.IsClientPaired("client-0001", pub));
            Assert.AreEqual(0, identity.PairedClients().Count);
        }

        [TestMethod]
        public void CorruptStoredClient_IsNotPaired()
        {
            var host = new FakePluginHost();
            var identity = new FerryIdentity(host);
            host.CustomConfig.SetString("KeePassFerry.Client.client-0003", "not base64!|x");
            Assert.IsFalse(identity.IsClientPaired("client-0003", new byte[65]));
        }

        [TestMethod]
        public void CleanClientName_RemovesControlCharsAndLimitsLength()
        {
            Assert.AreEqual("Chrome", FerryIdentity.CleanClientName(" \tChr\u0000ome\r\n "));
            Assert.AreEqual(80, FerryIdentity.CleanClientName(new string('a', 200)).Length);
            Assert.AreEqual("", FerryIdentity.CleanClientName(null));
        }

        [TestMethod]
        public void Pairing_OnlyOneDialogAtATime_AndCooldownAfterDecline()
        {
            var identity = new FerryIdentity(new FakePluginHost());
            Assert.IsTrue(identity.TryBeginPairing("client-a"));
            Assert.IsFalse(identity.TryBeginPairing("client-b"), "Second dialog while one is open");
            identity.EndPairing("client-a", false);
            Assert.IsFalse(identity.TryBeginPairing("client-a"), "Declined client waits");
            Assert.IsTrue(identity.TryBeginPairing("client-b"));
            identity.EndPairing("client-b", true);
            Assert.IsTrue(identity.TryBeginPairing("client-b"));
            identity.EndPairing("client-b", true);
        }

        [TestMethod]
        public void Pairing_ParallelRequests_GetExactlyOneDialog()
        {
            var identity = new FerryIdentity(new FakePluginHost());
            int granted = 0;
            Parallel.For(0, 32, i =>
            {
                if (identity.TryBeginPairing("client-" + i)) System.Threading.Interlocked.Increment(ref granted);
            });
            Assert.AreEqual(1, granted);
        }
    }
}
