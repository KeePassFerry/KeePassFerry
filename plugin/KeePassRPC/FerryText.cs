using System;
using System.Globalization;

namespace KeePassFerry
{
    /// <summary>
    /// Sichtbare Texte des Plugins in Deutsch oder Englisch.
    /// Maßgeblich ist die Sprache von KeePass, ohne Übersetzung die Windows-Sprache.
    /// </summary>
    internal static class FerryText
    {
        internal static bool German
        {
            get
            {
                try
                {
                    string kp = KeePass.Program.Translation != null && KeePass.Program.Translation.Properties != null
                        ? KeePass.Program.Translation.Properties.Iso6391Code
                        : null;
                    if (!string.IsNullOrEmpty(kp)) return kp.Equals("de", StringComparison.OrdinalIgnoreCase);
                }
                catch (Exception)
                {
                    // ältere KeePass-Versionen: Windows-Sprache
                }
                return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de";
            }
        }

        internal static string T(string de, string en)
        {
            return German ? de : en;
        }
    }
}
