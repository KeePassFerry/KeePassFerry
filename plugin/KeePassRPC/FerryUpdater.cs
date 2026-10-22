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
    /// aus dem neuesten GitHub-Release laden und nur starten, wenn
    /// - SHA256SUMS.txt mit dem Release-Schlüssel (FerryReleaseKey, privater Teil nur offline beim Herausgeber) signiert ist,
    /// - die Liste eine neuere Version als die installierte nennt (kein Zurückspielen alter Setups) und
    /// - das geladene Setup die dort genannte Prüfsumme hat.
    /// Downloads folgen Umleitungen nur über HTTPS zu github.com bzw. *.githubusercontent.com.
    /// Das Setup beendet KeePass, ersetzt das Plugin und startet KeePass wieder (eigener [Run]-Eintrag, nicht Restart Manager).
    /// </summary>
    internal static class FerryUpdater
    {
        private const string VersionUrl = "https://raw.githubusercontent.com/KeePassFerry/KeePassFerry/main/version.txt";
        private const string ReleaseUrl = "https://github.com/KeePassFerry/KeePassFerry/releases/latest/download/";
        private const string SetupName = "KeePassFerry-Setup.exe";
        private const string SumsName = "SHA256SUMS.txt";
        private const string SignatureName = "SHA256SUMS.txt.sig";
        private const string VersionedSetupPrefix = "KeePassFerry-Setup-";
        private const int MaxRedirects = 5;

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
            byte[] data = Download(VersionUrl);
            if (data == null) return null;
            foreach (string line in System.Text.Encoding.UTF8.GetString(data).Split('\n'))
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
        /// "signature_invalid", "checksum_mismatch", "cancelled" (UAC abgelehnt) oder "start_failed".
        /// </summary>
        internal static string Run(bool onlyIfNewer)
        {
            if (onlyIfNewer)
            {
                string latest = LatestVersion();
                if (latest == null) return "download_failed";
                if (!IsNewer(latest, InstalledVersion)) return "uptodate";
            }

            byte[] sums = Download(ReleaseUrl + SumsName);
            byte[] signature = Download(ReleaseUrl + SignatureName);
            if (sums == null || signature == null) return "download_failed";
            if (!SignatureValid(sums, signature)) return "signature_invalid";

            // Signierte Liste: "<sha256>  KeePassFerry-Setup.exe" und "<sha256>  KeePassFerry-Setup-1.2.3.exe" (gleiche Datei)
            string expected = null, versionedHash = null, offered = null;
            foreach (string line in System.Text.Encoding.ASCII.GetString(sums).Split('\n'))
            {
                string[] parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length != 2) continue;
                string name = parts[1];
                if (name == SetupName) expected = parts[0].ToLowerInvariant();
                else if (name.StartsWith(VersionedSetupPrefix, StringComparison.Ordinal) && name.EndsWith(".exe", StringComparison.Ordinal))
                {
                    offered = name.Substring(VersionedSetupPrefix.Length, name.Length - VersionedSetupPrefix.Length - 4);
                    versionedHash = parts[0].ToLowerInvariant();
                }
            }
            if (expected == null || expected != versionedHash) return "signature_invalid";
            if (!IsNewer(offered, InstalledVersion)) return "uptodate";

            byte[] setup = Download(ReleaseUrl + SetupName);
            if (setup == null || setup.Length == 0) return "download_failed";
            string actual;
            using (var sha = SHA256.Create())
                actual = BitConverter.ToString(sha.ComputeHash(setup)).Replace("-", "").ToLowerInvariant();
            if (expected != actual) return "checksum_mismatch";

            string path = Path.Combine(Path.GetTempPath(), "KeePassFerry-Setup-" + Guid.NewGuid().ToString("N") + ".exe");
            File.WriteAllBytes(path, setup);

            string keepassDir = Path.GetDirectoryName(WinUtil.GetExecutable());
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            bool needsAdmin = keepassDir.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase)
                || (!string.IsNullOrEmpty(programFilesX86) && keepassDir.StartsWith(programFilesX86, StringComparison.OrdinalIgnoreCase));

            string args = "/SILENT /SP- /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /DIR=\"" + keepassDir + "\""
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

        // RSA (PKCS#1 v1.5, SHA-256) gegen den eingebauten öffentlichen Release-Schlüssel
        internal static bool SignatureValid(byte[] data, byte[] signature)
        {
            try
            {
                using (var rsa = new RSACng())
                {
                    rsa.FromXmlString(FerryReleaseKey.PublicKeyXml);
                    return rsa.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static bool AllowedHost(Uri uri)
        {
            if (uri.Scheme != Uri.UriSchemeHttps) return false;
            string host = uri.Host.ToLowerInvariant();
            return host == "github.com" || host.EndsWith(".githubusercontent.com", StringComparison.Ordinal);
        }

        // Inhalt einer HTTPS-Adresse; Umleitungen werden einzeln geprüft. null bei Fehlern oder fremdem Ziel
        private static byte[] Download(string url)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                var uri = new Uri(url);
                for (int hop = 0; hop <= MaxRedirects; hop++)
                {
                    if (!AllowedHost(uri)) return null;
                    var request = (HttpWebRequest)WebRequest.Create(uri);
                    request.AllowAutoRedirect = false;
                    request.UserAgent = "KeePassFerry/" + InstalledVersion;
                    request.Headers[HttpRequestHeader.CacheControl] = "no-cache";
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        int status = (int)response.StatusCode;
                        if (status >= 300 && status < 400)
                        {
                            string location = response.Headers[HttpResponseHeader.Location];
                            if (string.IsNullOrEmpty(location)) return null;
                            uri = new Uri(uri, location);
                            continue;
                        }
                        if (status != 200) return null;
                        using (var stream = response.GetResponseStream())
                        using (var buffer = new MemoryStream())
                        {
                            stream.CopyTo(buffer);
                            return buffer.ToArray();
                        }
                    }
                }
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
