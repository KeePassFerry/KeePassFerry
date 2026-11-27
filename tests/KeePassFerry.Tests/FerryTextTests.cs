using System.Globalization;
using System.Threading;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Sprache des Plugins folgt KeePass, nicht Windows (#57)
    /// </summary>
    [TestClass]
    public class FerryTextTests
    {
        private static string Code
        {
            get { return KeePass.Program.Translation.Properties.Iso6391Code; }
            set { KeePass.Program.Translation.Properties.Iso6391Code = value; }
        }

        [TestMethod]
        public void BuiltInEnglish_IsEnglish_EvenOnGermanWindows()
        {
            string before = Code;
            CultureInfo ui = Thread.CurrentThread.CurrentUICulture;
            try
            {
                Thread.CurrentThread.CurrentUICulture = new CultureInfo("de-DE");
                Code = "";
                Assert.IsFalse(FerryText.German);
                Assert.AreEqual("Cancel", FerryText.T("Abbrechen", "Cancel"));
            }
            finally
            {
                Code = before;
                Thread.CurrentThread.CurrentUICulture = ui;
            }
        }

        [TestMethod]
        public void GermanTranslation_IsGerman_EvenOnEnglishWindows()
        {
            string before = Code;
            CultureInfo ui = Thread.CurrentThread.CurrentUICulture;
            try
            {
                Thread.CurrentThread.CurrentUICulture = new CultureInfo("en-US");
                Code = "de";
                Assert.IsTrue(FerryText.German);
                Code = "fr";
                Assert.IsFalse(FerryText.German, "Other KeePass languages: English");
            }
            finally
            {
                Code = before;
                Thread.CurrentThread.CurrentUICulture = ui;
            }
        }
    }
}
