using KeePassFerry.Models.DataExchange;
using KeePassFerry.Models.Shared;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Suche für Seiten ohne Passwörter und geschützte Werte (FindLoginsWithoutSecrets, #56)
    /// </summary>
    [TestClass]
    public class OmitSecretsTests
    {
        private static FormField Field(string name, string value, FormFieldType type, bool isProtected = false)
        {
            return new FormField(name, name, value, type, "", 1, PlaceholderHandling.Default) { Protected = isProtected };
        }

        [TestMethod]
        public void PasswordAndProtectedValues_AreEmptiedAndMarked_OthersStay()
        {
            var entry = new Entry
            {
                FormFieldList = new[]
                {
                    Field("KeePass username", "alice", FormFieldType.FFTusername),
                    Field("KeePass password", "geheim", FormFieldType.FFTpassword),
                    Field("PIN", "1234", FormFieldType.FFTtext, true),
                    Field("Land", "DE", FormFieldType.FFTtext),
                    Field("Leer", "", FormFieldType.FFTpassword)
                }
            };

            FerryService.OmitSecrets(entry);

            FormField[] f = entry.FormFieldList;
            Assert.AreEqual("alice", f[0].Value);
            Assert.IsFalse(f[0].ValueOmitted);
            Assert.AreEqual("", f[1].Value);
            Assert.IsTrue(f[1].ValueOmitted);
            Assert.AreEqual("", f[2].Value);
            Assert.IsTrue(f[2].ValueOmitted);
            Assert.AreEqual("DE", f[3].Value);
            Assert.IsFalse(f[3].ValueOmitted);
            Assert.IsFalse(f[4].ValueOmitted, "Empty values are not marked as omitted");
        }

        [TestMethod]
        public void EntryWithoutFields_IsUnchanged()
        {
            FerryService.OmitSecrets(null);
            var entry = new Entry();
            FerryService.OmitSecrets(entry);
            Assert.IsNull(entry.FormFieldList);
        }
    }
}
