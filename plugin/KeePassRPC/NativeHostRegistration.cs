using System;
using System.IO;
using System.Reflection;
using System.Text;
using KeePass.Util;
using KeePassLib.Utility;
using Microsoft.Win32;

namespace KeePassFerry
{
    /// <summary>
    /// Registriert den Native-Messaging-Host für den aktuellen Windows-Benutzer (Edge, Chrome, Firefox)
    /// </summary>
    public static class NativeHostRegistration
    {
        public const string HostName = "keepassferry";
        public const string HostExeName = "KeePassFerryHost.exe";

        // Früherer Host-Name (Entwicklungsstand bis 21.10.2026), wird beim Registrieren entfernt
        private const string LegacyHostName = "de.blacksun80.keepassferry";

        // Erweiterungs-IDs, die den Host starten dürfen: Microsoft Edge Add-ons (Store) und Entwicklungs-ID
        // aus dem Manifest-Schlüssel (entpackt geladene Erweiterung)
        private static readonly string[] AllowedChromiumOrigins =
        {
            "chrome-extension://ghkhbdnhojpeibdjdlgojfdjhedapmhg/",
            "chrome-extension://pjafpdemjepcjioimoicjogcmkijighm/"
        };

        private static readonly string[] AllowedFirefoxExtensions =
        {
            "keepassferry@keepassferry"
        };

        /// <summary>
        /// Schreibt die Host-Manifeste nach %LOCALAPPDATA%\KeePassFerry und trägt sie unter HKCU ein.
        /// Gibt eine Fehlerbeschreibung zurück oder null bei Erfolg.
        /// </summary>
        public static string Register()
        {
            string hostPath = FindHostExe();
            if (hostPath == null)
                return HostExeName + " not found next to the plugin or in the KeePass Plugins folder";

            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KeePassFerry");
            Directory.CreateDirectory(dir);

            string chromiumManifest = Path.Combine(dir, HostName + ".chromium.json");
            string firefoxManifest = Path.Combine(dir, HostName + ".firefox.json");

            WriteIfChanged(chromiumManifest, BuildManifest(hostPath, "allowed_origins", AllowedChromiumOrigins));
            WriteIfChanged(firefoxManifest, BuildManifest(hostPath, "allowed_extensions", AllowedFirefoxExtensions));

            SetDefaultValue(@"Software\Microsoft\Edge\NativeMessagingHosts\" + HostName, chromiumManifest);
            SetDefaultValue(@"Software\Google\Chrome\NativeMessagingHosts\" + HostName, chromiumManifest);
            SetDefaultValue(@"Software\Mozilla\NativeMessagingHosts\" + HostName, firefoxManifest);
            RemoveLegacy(dir);
            return null;
        }

        // Registrierung unter dem früheren Host-Namen entfernen (Registry und Manifestdateien)
        private static void RemoveLegacy(string dir)
        {
            foreach (string browserKey in new[] { @"Software\Microsoft\Edge", @"Software\Google\Chrome", @"Software\Mozilla" })
            {
                try
                {
                    Registry.CurrentUser.DeleteSubKey(browserKey + @"\NativeMessagingHosts\" + LegacyHostName, false);
                }
                catch (Exception)
                {
                }
            }
            foreach (string suffix in new[] { ".chromium.json", ".firefox.json" })
            {
                try
                {
                    string old = Path.Combine(dir, LegacyHostName + suffix);
                    if (File.Exists(old)) File.Delete(old);
                }
                catch (Exception)
                {
                }
            }
        }

        internal static string FindHostExe()
        {
            // 1. neben der Plugin-DLL (Debug-Build), 2. im Plugins-Ordner von KeePass (PLGX-Installation)
            string[] candidates =
            {
                Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? "", HostExeName),
                Path.Combine(Path.Combine(UrlUtil.GetFileDirectory(WinUtil.GetExecutable(), false, true), "Plugins"), HostExeName)
            };
            foreach (string candidate in candidates)
                if (File.Exists(candidate))
                    return Path.GetFullPath(candidate);
            return null;
        }

        private static string BuildManifest(string hostPath, string allowedKey, string[] allowed)
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"name\": \"").Append(HostName).Append("\",\n");
            sb.Append("  \"description\": \"KeePassFerry native messaging host\",\n");
            sb.Append("  \"path\": \"").Append(JsonEscape(hostPath)).Append("\",\n");
            sb.Append("  \"type\": \"stdio\",\n");
            sb.Append("  \"").Append(allowedKey).Append("\": [");
            for (int i = 0; i < allowed.Length; i++)
            {
                if (i > 0) sb.Append(", ");
                sb.Append('"').Append(JsonEscape(allowed[i])).Append('"');
            }
            sb.Append("]\n}\n");
            return sb.ToString();
        }

        private static string JsonEscape(string s)
        {
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static void WriteIfChanged(string path, string content)
        {
            if (File.Exists(path) && File.ReadAllText(path, Encoding.UTF8) == content)
                return;
            File.WriteAllText(path, content, new UTF8Encoding(false));
        }

        private static void SetDefaultValue(string subKey, string value)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(subKey))
            {
                if (key != null && (key.GetValue("") as string) != value)
                    key.SetValue("", value);
            }
        }
    }
}
