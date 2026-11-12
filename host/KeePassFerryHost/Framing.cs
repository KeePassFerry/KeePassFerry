using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace KeePassFerryHost
{
    /// <summary>
    /// Nachrichtenformat auf beiden Seiten des Hosts: 4-Byte-Länge (little endian) + UTF-8-JSON.
    /// Zum Browser höchstens 1 MB pro Nachricht; größere gehen in Stücken (Base64). Tests: tests/KeePassFerry.Tests
    /// </summary>
    internal static class Framing
    {
        internal const int MaxMessageBytes = 64 * 1024 * 1024;
        internal const int MaxDirectBytes = 900 * 1024;
        internal const int ChunkRawBytes = 600 * 1024;

        // Steuerbefehl der Erweiterung an den Host selbst: {"keepassferryHost":"<befehl>"}
        internal static bool IsHostCommand(byte[] message, string command)
        {
            if (message.Length > 100) return false;
            string text = Encoding.UTF8.GetString(message).Replace(" ", "");
            return text == "{\"keepassferryHost\":\"" + command + "\"}";
        }

        /// <summary>Nächste Nachricht; null bei sauber geschlossener Verbindung</summary>
        internal static byte[] ReadFrame(Stream stream)
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

        internal static void WriteFrame(Stream stream, byte[] message)
        {
            stream.Write(BitConverter.GetBytes(message.Length), 0, 4);
            stream.Write(message, 0, message.Length);
            stream.Flush();
        }

        /// <summary>Nachrichten für den Browser: die Nachricht selbst oder ihre Stücke mit der Kennung chunkId</summary>
        internal static List<byte[]> ForBrowser(byte[] message, int chunkId)
        {
            var frames = new List<byte[]>();
            if (message.Length <= MaxDirectBytes)
            {
                frames.Add(message);
                return frames;
            }
            int count = (message.Length + ChunkRawBytes - 1) / ChunkRawBytes;
            for (int i = 0; i < count; i++)
            {
                int offset = i * ChunkRawBytes;
                string data = Convert.ToBase64String(message, offset, Math.Min(ChunkRawBytes, message.Length - offset));
                string chunk = "{\"keepassferryHost\":\"chunk\",\"id\":" + chunkId + ",\"index\":" + i +
                               ",\"count\":" + count + ",\"data\":\"" + data + "\"}";
                frames.Add(Encoding.UTF8.GetBytes(chunk));
            }
            return frames;
        }
    }
}
