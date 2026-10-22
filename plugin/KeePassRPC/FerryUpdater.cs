using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using KeePass.Util;

namespace KeePassFerry
{
    /// <summary>
    /// Aktualisiert das Plugin mit einem Klick: neueste Version aus version.txt prüfen, KeePassFerry-Setup.exe
    /// aus dem neuesten GitHub-Release laden, gegen SHA256SUMS.txt desselben Releases prüfen und still starten.
    /// Das Setup beendet KeePass, ersetzt das Plugin und startet KeePass wieder.
    /// </summary>
    internal static class FerryUpdater
    {
        private const string VersionUrl = "https://raw.githubusercontent.com/KeePassFerry/KeePassFerry/main/version.txt";
        private const string SetupUrl = "https://github.com/KeePassFerry/KeePassFerry/releases/latest/download/KeePassFerry-Setup.exe";
        private const string SumsUrl = "https://github.com/KeePassFerry/KeePassFerry/releases/latest/download/SHA256SUMS.txt";
        private const string SetupName = "KeePassFerry-Setup.exe";

        internal static string InstalledVersion
        {
            get
            {
                var a = (AssemblyInformationalVersionAttribute)Attribute.GetCustomAttribute(
                    Assembly.GetExecutingAssembly(), typeof(AssemblyInformationalVersionAttribute));
                return a != null ? a.InformationalVersion : "0.0.0";
            }
        }

        /// <summary>Neueste veröffentlichte Version (Zeile "KeePassFerry:1.2.3" in version.txt) oder null</summary>
        internal static string LatestVersion()
        {
            byte[] ignored;
            string text = Download(VersionUrl, out ignored);
            if (text == null) return null;
            foreach (string line in text.Split('\n'))
            {
                string l = line.Trim();
                if (l.StartsWith("KeePassFerry:", StringComparison.Ordinal)) return l.Substring("KeePassFerry:".Length).Trim();
            }
            return null;
        }

        internal static bool IsNewer(string latest, string installed)
        {
            Version a, b;
            return Version.TryParse(latest, out a) && Version.TryParse(installed, out b) && a > b;
        }

        /// <summary>
        /// Lädt, prüft und startet das Setup. Ergebnis: "started", "uptodate", "download_failed",
        /// "checksum_mismatch", "cancelled" (UAC abgelehnt) oder "start_failed".
        /// </summary>
        internal static string Run(bool onlyIfNewer)
        {
            if (onlyIfNewer)
            {
                string latest = LatestVersion();
                if (latest == null) return "download_failed";
                if (!IsNewer(latest, InstalledVersion)) return "uptodate";
            }

            byte[] setup;
            Download(SetupUrl, out setup);
            byte[] sumsBytes;
            string sums = Download(SumsUrl, out sumsBytes);
            if (setup == null || setup.Length == 0 || sums == null) return "download_failed";

            string expected = null;
            foreach (string line in sums.Split('\n'))
            {
                // Format: "<sha256>  <Dateiname>"
                string[] parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 2 && parts[1] == SetupName) expected = parts[0].ToLowerInvariant();
            }
            string actual;
            using (var sha = SHA256.Create())
                actual = BitConverter.ToString(sha.ComputeHash(setup)).Replace("-", "").ToLowerInvariant();
            if (expected == null || expected != actual) return "checksum_mismatch";

            string path = Path.Combine(Path.GetTempPath(), "KeePassFerry-Setup-" + Guid.NewGuid().ToString("N") + ".exe");
            File.WriteAllBytes(path, setup);

            string keepassDir = Path.GetDirectoryName(WinUtil.GetExecutable());
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            bool needsAdmin = keepassDir.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase)
                || (!string.IsNullOrEmpty(programFilesX86) && keepassDir.StartsWith(programFilesX86, StringComparison.OrdinalIgnoreCase));

            string args = "/SILENT /SP- /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /DIR=\"" + keepassDir + "\""
                + (needsAdmin ? "" : " /CURRENTUSER");
            try
            {
                Process.Start(new ProcessStartInfo(path, args) { UseShellExecute = true });
                return "started";
            }
            catch (Win32Exception ex)
            {
                // 1223: Benutzer hat die Windows-Abfrage (UAC) abgelehnt
                return ex.NativeErrorCode == 1223 ? "cancelled" : "start_failed";
            }
            catch (Exception)
            {
                return "start_failed";
            }
        }

        // Text (UTF-8) bzw. Bytes einer HTTPS-Adresse; null bei Fehlern
        private static string Download(string url, out byte[] data)
        {
            data = null;
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                using (var client = new WebClient())
                {
                    client.Headers[HttpRequestHeader.UserAgent] = "KeePassFerry/" + InstalledVersion;
                    client.Headers[HttpRequestHeader.CacheControl] = "no-cache";
                    data = client.DownloadData(url);
                    return System.Text.Encoding.UTF8.GetString(data);
                }
            }
            catch (Exception)
            {
                data = null;
                return null;
            }
        }
    }
}
