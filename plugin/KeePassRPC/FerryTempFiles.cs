using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace KeePassFerry
{
    /// <summary>
    /// Anhang ansehen im Standardprogramm von Windows, ohne den Import-Dialog von KeePass:
    /// temporäre Kopie in einem EFS-verschlüsselten Ordner (sofern Windows EFS unterstützt), schreibgeschützt,
    /// nach zwei Minuten überschrieben und gelöscht; außerdem beim Sperren/Schließen der Datenbank, beim Beenden
    /// von KeePass und beim nächsten Start (Reste nach einem Absturz).
    /// Nur Bilder, PDF und Text: andere Typen (z. B. .exe, .lnk) würde Windows ausführen.
    /// </summary>
    internal static class FerryTempFiles
    {
        private const int DeleteAfterMs = 2 * 60 * 1000;
        private const int RetryAfterMs = 60 * 1000;
        private const int MaxRetries = 10;

        private static readonly HashSet<string> ViewableExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".pdf", ".txt"
        };

        private static readonly object Sync = new object();
        // Laufende Lösch-Timer festhalten, sonst sammelt sie der Garbage Collector ein
        private static readonly Dictionary<string, Timer> Pending = new Dictionary<string, Timer>();

        private static string Root
        {
            get { return Path.Combine(Path.GetTempPath(), "KeePassFerry"); }
        }

        public static bool IsViewable(string name)
        {
            return ViewableExtensions.Contains(Path.GetExtension(name ?? ""));
        }

        public static void Open(string name, byte[] data)
        {
            string dir = Path.Combine(Root, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            // Ordner zuerst verschlüsseln: darin angelegte Dateien landen nie unverschlüsselt auf der Platte
            try
            {
                File.Encrypt(dir);
            }
            catch (Exception)
            {
                // z. B. Windows Home oder FAT-Laufwerk: ohne EFS weiter
            }

            string path = Path.Combine(dir, SafeFileName(name));
            File.WriteAllBytes(path, data);
            File.SetAttributes(path, FileAttributes.ReadOnly);
            Schedule(dir, DeleteAfterMs, 0);

            var start = new ProcessStartInfo(path);
            start.UseShellExecute = true;
            Process.Start(start);
        }

        /// <summary>Alle temporären Kopien löschen (Sperren, Beenden, Start)</summary>
        public static void CleanUp()
        {
            lock (Sync)
            {
                foreach (Timer t in Pending.Values) t.Dispose();
                Pending.Clear();
            }
            try
            {
                if (!Directory.Exists(Root)) return;
                foreach (string dir in Directory.GetDirectories(Root)) DeleteDirectory(dir);
            }
            catch (Exception)
            {
                // beim nächsten Aufräumen erneut
            }
        }

        private static void Schedule(string dir, int dueMs, int attempt)
        {
            lock (Sync)
            {
                Timer old;
                if (Pending.TryGetValue(dir, out old)) old.Dispose();
                Pending[dir] = new Timer(delegate { OnTimer(dir, attempt); }, null, dueMs, Timeout.Infinite);
            }
        }

        private static void OnTimer(string dir, int attempt)
        {
            lock (Sync)
            {
                Timer t;
                if (Pending.TryGetValue(dir, out t))
                {
                    t.Dispose();
                    Pending.Remove(dir);
                }
            }
            // Noch geöffnet (Programm hält die Datei): später erneut, spätestens beim Sperren/Beenden
            if (!DeleteDirectory(dir) && attempt < MaxRetries) Schedule(dir, RetryAfterMs, attempt + 1);
        }

        // Dateien mit Nullen überschreiben, dann löschen; false, wenn etwas noch gesperrt ist
        private static bool DeleteDirectory(string dir)
        {
            bool ok = true;
            try
            {
                if (!Directory.Exists(dir)) return true;
                foreach (string file in Directory.GetFiles(dir))
                {
                    try
                    {
                        File.SetAttributes(file, FileAttributes.Normal);
                        long length = new FileInfo(file).Length;
                        using (var fs = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.None))
                        {
                            var zeros = new byte[64 * 1024];
                            for (long done = 0; done < length; done += zeros.Length)
                                fs.Write(zeros, 0, (int)Math.Min(zeros.Length, length - done));
                            fs.Flush(true);
                        }
                        File.Delete(file);
                    }
                    catch (Exception)
                    {
                        ok = false;
                    }
                }
                if (ok) Directory.Delete(dir, true);
            }
            catch (Exception)
            {
                ok = false;
            }
            return ok;
        }

        private static string SafeFileName(string name)
        {
            // Nur der letzte Teil nach / oder \ (kein Pfad aus dem Anhangnamen), ungültige Zeichen ersetzen
            string result = name ?? "";
            int slash = result.LastIndexOfAny(new[] { '/', '\\' });
            if (slash >= 0) result = result.Substring(slash + 1);
            foreach (char c in Path.GetInvalidFileNameChars()) result = result.Replace(c, '_');
            result = result.Trim();
            return result.Length == 0 || result.StartsWith(".") ? "anhang" + result : result;
        }
    }
}
