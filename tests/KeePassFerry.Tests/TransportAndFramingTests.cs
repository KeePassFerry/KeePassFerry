using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Jayrock.Json;
using Jayrock.Json.Conversion;
using KeePassFerryHost;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Nachrichtenrahmen (4-Byte-Länge little endian + UTF-8) im Plugin (PipeClientTransport, echte Pipe)
    /// und im Native-Messaging-Host (Framing), inklusive Stückelung großer Antworten für den Browser
    /// </summary>
    [TestClass]
    public class TransportAndFramingTests
    {
        // ---------- Plugin: PipeClientTransport ----------

        [TestMethod]
        public void Pipe_RoundTripsMessagesInBothDirections()
        {
            using (var pipe = new PipePair())
            {
                pipe.WriteFrame("{\"a\":\"äöü €\"}");
                pipe.WriteFrame("");
                Assert.AreEqual("{\"a\":\"äöü €\"}", pipe.Transport.ReadMessage());
                Assert.AreEqual("", pipe.Transport.ReadMessage());
                pipe.Transport.Send("{\"b\":1}");
                Assert.AreEqual("{\"b\":1}", pipe.ReadFrame());
            }
        }

        [TestMethod]
        public void Pipe_ReassemblesMessagesWrittenByteByByte()
        {
            using (var pipe = new PipePair())
            {
                byte[] body = Encoding.UTF8.GetBytes("{\"split\":true}");
                var all = new List<byte>(BitConverter.GetBytes(body.Length));
                all.AddRange(body);
                Task<string> read = Task.Run(() => pipe.Transport.ReadMessage());
                foreach (byte b in all) pipe.WriteRaw(new[] { b });
                Assert.IsTrue(read.Wait(5000));
                Assert.AreEqual("{\"split\":true}", read.Result);
            }
        }

        [TestMethod]
        public void Pipe_HandshakeLimit_RejectsLargeMessage_UntilRaised()
        {
            using (var pipe = new PipePair())
            {
                Assert.AreEqual(NativePipeServer.MaxHandshakeMessageBytes, pipe.Transport.MaxMessageBytes);
                pipe.WriteRaw(BitConverter.GetBytes(NativePipeServer.MaxHandshakeMessageBytes + 1));
                Assert.ThrowsException<InvalidDataException>(() => pipe.Transport.ReadMessage());
            }
            using (var pipe = new PipePair())
            {
                pipe.Transport.MaxMessageBytes = NativePipeServer.MaxMessageBytes;
                string big = new string('x', 2 * 1024 * 1024);
                Task write = Task.Run(() => pipe.WriteFrame(big));
                Assert.AreEqual(big, pipe.Transport.ReadMessage());
                Assert.IsTrue(write.Wait(5000));
            }
        }

        [TestMethod]
        public void Pipe_RejectsNegativeLength()
        {
            using (var pipe = new PipePair())
            {
                pipe.WriteRaw(BitConverter.GetBytes(-1));
                Assert.ThrowsException<InvalidDataException>(() => pipe.Transport.ReadMessage());
            }
        }

        [TestMethod]
        public void Pipe_CleanClose_ReturnsNull_ButTruncatedMessageThrows()
        {
            using (var pipe = new PipePair())
            {
                pipe.Client.Dispose();
                Assert.IsNull(pipe.Transport.ReadMessage());
            }
            using (var pipe = new PipePair())
            {
                pipe.WriteRaw(new byte[] { 10, 0 }); // halber Kopf
                pipe.Client.Dispose();
                Assert.ThrowsException<EndOfStreamException>(() => pipe.Transport.ReadMessage());
            }
            using (var pipe = new PipePair())
            {
                pipe.WriteRaw(BitConverter.GetBytes(10));
                pipe.WriteRaw(Encoding.ASCII.GetBytes("abc"));
                pipe.Client.Dispose();
                Assert.ThrowsException<EndOfStreamException>(() => pipe.Transport.ReadMessage());
            }
        }

        [TestMethod]
        public void Pipe_SendAfterCloseIsIgnored()
        {
            using (var pipe = new PipePair())
            {
                pipe.Transport.Close();
                pipe.Transport.Send("{}"); // darf nicht werfen
                pipe.Transport.Close();
            }
        }

        // ---------- Host: Framing ----------

        private sealed class TrickleStream : MemoryStream
        {
            public TrickleStream(byte[] data) : base(data) { }
            public override int Read(byte[] buffer, int offset, int count) => base.Read(buffer, offset, Math.Min(count, 3));
        }

        private static byte[] Framed(params byte[][] messages)
        {
            var ms = new MemoryStream();
            foreach (byte[] m in messages) Framing.WriteFrame(ms, m);
            return ms.ToArray();
        }

        [TestMethod]
        public void Host_ReadsFramesFromPartialReads()
        {
            byte[] a = Encoding.UTF8.GetBytes("{\"a\":1}");
            byte[] b = new byte[0];
            byte[] c = Encoding.UTF8.GetBytes("{\"c\":\"ü\"}");
            var stream = new TrickleStream(Framed(a, b, c));
            CollectionAssert.AreEqual(a, Framing.ReadFrame(stream));
            CollectionAssert.AreEqual(b, Framing.ReadFrame(stream));
            CollectionAssert.AreEqual(c, Framing.ReadFrame(stream));
            Assert.IsNull(Framing.ReadFrame(stream));
        }

        [TestMethod]
        public void Host_RejectsInvalidLengths_AndTruncatedFrames()
        {
            Assert.ThrowsException<InvalidDataException>(() => Framing.ReadFrame(new MemoryStream(BitConverter.GetBytes(-5))));
            Assert.ThrowsException<InvalidDataException>(() => Framing.ReadFrame(new MemoryStream(BitConverter.GetBytes(Framing.MaxMessageBytes + 1))));
            Assert.ThrowsException<EndOfStreamException>(() => Framing.ReadFrame(new MemoryStream(new byte[] { 1, 0 })));
            byte[] truncated = Framed(new byte[10]);
            Array.Resize(ref truncated, truncated.Length - 1);
            Assert.ThrowsException<EndOfStreamException>(() => Framing.ReadFrame(new MemoryStream(truncated)));
        }

        [TestMethod]
        public void Host_WritesLittleEndianLength()
        {
            byte[] framed = Framed(new byte[0x0102]);
            CollectionAssert.AreEqual(new byte[] { 0x02, 0x01, 0x00, 0x00 }, new[] { framed[0], framed[1], framed[2], framed[3] });
        }

        [TestMethod]
        public void Host_SmallMessagesGoToBrowserUnchanged()
        {
            var exact = new byte[Framing.MaxDirectBytes];
            List<byte[]> frames = Framing.ForBrowser(exact, 1);
            Assert.AreEqual(1, frames.Count);
            Assert.AreSame(exact, frames[0]);
        }

        [TestMethod]
        public void Host_LargeMessagesAreChunked_AndReassembleExactly()
        {
            var rng = new Random(3);
            foreach (int length in new[] { Framing.MaxDirectBytes + 1, 3 * Framing.ChunkRawBytes, 3 * Framing.ChunkRawBytes + 7 })
            {
                var message = new byte[length];
                rng.NextBytes(message);
                List<byte[]> frames = Framing.ForBrowser(message, 42);
                int expectedCount = (length + Framing.ChunkRawBytes - 1) / Framing.ChunkRawBytes;
                Assert.AreEqual(expectedCount, frames.Count);

                var joined = new MemoryStream();
                for (int i = 0; i < frames.Count; i++)
                {
                    Assert.IsTrue(frames[i].Length < 1024 * 1024, "Browser accepts at most 1 MB per message");
                    var chunk = (JsonObject)JsonConvert.Import(Encoding.UTF8.GetString(frames[i]));
                    Assert.AreEqual("chunk", chunk["keepassferryHost"]);
                    Assert.AreEqual(42, Convert.ToInt32(chunk["id"]));
                    Assert.AreEqual(i, Convert.ToInt32(chunk["index"]));
                    Assert.AreEqual(expectedCount, Convert.ToInt32(chunk["count"]));
                    byte[] data = Convert.FromBase64String((string)chunk["data"]);
                    joined.Write(data, 0, data.Length);
                }
                CollectionAssert.AreEqual(message, joined.ToArray());
            }
        }

        [TestMethod]
        public void Host_RecognisesOnlyExactHostCommands()
        {
            Assert.IsTrue(Framing.IsHostCommand(Encoding.UTF8.GetBytes("{\"keepassferryHost\":\"startKeePass\"}"), "startKeePass"));
            Assert.IsTrue(Framing.IsHostCommand(Encoding.UTF8.GetBytes("{ \"keepassferryHost\" : \"startKeePass\" }"), "startKeePass"));
            Assert.IsFalse(Framing.IsHostCommand(Encoding.UTF8.GetBytes("{\"keepassferryHost\":\"startKeePass\",\"x\":1}"), "startKeePass"));
            Assert.IsFalse(Framing.IsHostCommand(Encoding.UTF8.GetBytes("{\"keepassferryHost\":\"allowForeground\"}"), "startKeePass"));
            Assert.IsFalse(Framing.IsHostCommand(Encoding.UTF8.GetBytes("{\"keepassferryHost\":\"startKeePass\"}" + new string(' ', 80)), "startKeePass"));
            Assert.IsFalse(Framing.IsHostCommand(Encoding.UTF8.GetBytes("{\"ferry\":\"m\",\"n\":1,\"c\":\"\"}"), "startKeePass"));
        }
    }
}
