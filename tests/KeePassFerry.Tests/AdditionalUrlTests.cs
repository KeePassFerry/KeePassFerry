using System.Collections.Generic;
using KeePassFerry.Models.DataExchange;
using KeePassFerry.Models.Persistent;
using KeePassLib;
using KeePassLib.Security;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Zusätzliche Adressen aus Zeichenfolgenfeldern (KP2A_URL … wie Keepass2Android/KeePassXC, URL… wie KeePassNatMsg)
    /// </summary>
    [TestClass]
    public class AdditionalUrlTests
    {
        private static PwEntry Entry(string url, params string[] nameValuePairs)
        {
            var entry = new PwEntry(true, true);
            entry.Strings.Set(PwDefs.UrlField, new ProtectedString(false, url));
            for (int i = 0; i < nameValuePairs.Length; i += 2)
                entry.Strings.Set(nameValuePairs[i], new ProtectedString(false, nameValuePairs[i + 1]));
            return entry;
        }

        private static int Match(PwEntry entry, string pageUrl, MatchAccuracyMethod method)
        {
            return FerryService.BestMatchAccuracyForAnyURL(entry, new EntryConfigv2(), pageUrl, URLSummary.FromURL(pageUrl), method);
        }

        [TestMethod]
        public void ReadsKp2aAndUrlPrefixedFields_ButNotTheMainUrlOrOtherFields()
        {
            PwEntry entry = Entry("https://www.fandom.com/",
                "KP2A_URL", "https://auth.fandom.com/signin",
                "KP2A_URL_1", "https://login.example.org",
                "kp2a_url_2", "https://lower.example.org",
                "URL2", "login.microsoftonline.com",
                "Website", "https://ignored.example.com",
                "AndroidApp", "androidapp://com.example",
                "UserName2", "someone");
            List<string> urls = entry.AdditionalUrlStrings();
            CollectionAssert.AreEquivalent(new[]
            {
                "https://auth.fandom.com/signin", "https://login.example.org", "https://lower.example.org", "login.microsoftonline.com"
            }, urls);
        }

        [TestMethod]
        public void IgnoresEmptyValuesTextAndDuplicates()
        {
            PwEntry entry = Entry("https://example.com",
                "KP2A_URL_1", "  https://a.example.com  ",
                "KP2A_URL_2", "https://a.example.com",
                "KP2A_URL_3", "",
                "URL note", "see the wiki page",
                "URL_3", "two words");
            CollectionAssert.AreEqual(new[] { "https://a.example.com" }, entry.AdditionalUrlStrings());
        }

        [TestMethod]
        public void ReadsProtectedFields()
        {
            var entry = new PwEntry(true, true);
            entry.Strings.Set("KP2A_URL_1", new ProtectedString(true, "https://secret.example.com/login"));
            CollectionAssert.AreEqual(new[] { "https://secret.example.com/login" }, entry.AdditionalUrlStrings());
        }

        [TestMethod]
        public void EntryMatchesPageFromStringField()
        {
            PwEntry entry = Entry("https://to-do.live.com/tasks/", "KP2A_URL_1", "https://login.microsoftonline.com/");
            Assert.AreEqual(MatchAccuracy.Best, Match(entry, "https://login.microsoftonline.com/", MatchAccuracyMethod.Exact));
            Assert.IsTrue(Match(entry, "https://login.microsoftonline.com/common/oauth2", MatchAccuracyMethod.Hostname) >= MatchAccuracy.HostnameAndPort);
            Assert.AreEqual(MatchAccuracy.None, Match(entry, "https://login.microsoftonline.com.evil.test/", MatchAccuracyMethod.Hostname));
        }

        [TestMethod]
        public void EntryWithoutStringFields_MatchesAsBefore()
        {
            PwEntry entry = Entry("https://to-do.live.com/tasks/");
            Assert.AreEqual(MatchAccuracy.None, Match(entry, "https://login.microsoftonline.com/", MatchAccuracyMethod.Hostname));
            Assert.IsTrue(Match(entry, "https://to-do.live.com/other", MatchAccuracyMethod.Hostname) >= MatchAccuracy.HostnameAndPort);
        }

        [TestMethod]
        public void ExactMatching_StillNeedsTheExactAddress()
        {
            PwEntry entry = Entry("https://www.fandom.com/", "URL_login", "https://auth.fandom.com/signin");
            Assert.AreEqual(MatchAccuracy.Best, Match(entry, "https://auth.fandom.com/signin", MatchAccuracyMethod.Exact));
            Assert.AreEqual(MatchAccuracy.None, Match(entry, "https://auth.fandom.com/register", MatchAccuracyMethod.Exact));
        }

        // ---------- Schreiben in KP2A_URL_n ----------

        private static Dictionary<string, string> UrlFields(PwEntry entry)
        {
            var d = new Dictionary<string, string>();
            foreach (KeyValuePair<string, ProtectedString> kv in entry.Strings)
                if (Extensions.IsAdditionalUrlFieldName(kv.Key)) d[kv.Key] = kv.Value.ReadString();
            return d;
        }

        [TestMethod]
        public void Set_WritesNumberedUnprotectedFields_AsKeepass2AndroidDoes()
        {
            PwEntry entry = Entry("https://example.com");
            Assert.IsTrue(Extensions.SetAdditionalUrls(entry.Strings, new[] { "https://a.example.com", " https://b.example.com ", "https://a.example.com", "", "two words" }));
            Dictionary<string, string> fields = UrlFields(entry);
            Assert.AreEqual(2, fields.Count);
            Assert.AreEqual("https://a.example.com", fields["KP2A_URL_1"]);
            Assert.AreEqual("https://b.example.com", fields["KP2A_URL_2"]);
            Assert.IsFalse(entry.Strings.Get("KP2A_URL_1").IsProtected);
            Assert.AreEqual("https://example.com", entry.Strings.ReadSafe(PwDefs.UrlField), "Main URL untouched");
        }

        [TestMethod]
        public void Set_KeepsUnchangedFields_RemovesDeleted_AddsNewInFreeSlot()
        {
            PwEntry entry = Entry("https://example.com",
                "KP2A_URL_1", "https://keep.example.com",
                "KP2A_URL_2", "https://remove.example.com",
                "URL2", "https://natmsg.example.com",
                "URL note", "see the wiki page");
            Assert.IsTrue(Extensions.SetAdditionalUrls(entry.Strings, new[] { "https://keep.example.com", "https://natmsg.example.com", "https://new.example.com" }));
            Dictionary<string, string> fields = UrlFields(entry);
            Assert.AreEqual("https://keep.example.com", fields["KP2A_URL_1"]);
            Assert.AreEqual("https://natmsg.example.com", fields["URL2"], "Field of another program keeps its name");
            Assert.AreEqual("https://new.example.com", fields["KP2A_URL_2"], "Freed slot is reused");
            Assert.AreEqual("see the wiki page", fields["URL note"], "Text fields are not touched");
            Assert.AreEqual(4, fields.Count);
        }

        [TestMethod]
        public void Set_SameList_ChangesNothing()
        {
            PwEntry entry = Entry("https://example.com", "KP2A_URL_1", "https://a.example.com", "URL2", "https://b.example.com");
            Assert.IsFalse(Extensions.SetAdditionalUrls(entry.Strings, new[] { "https://b.example.com", "https://a.example.com" }));
            Assert.IsFalse(Extensions.SetAdditionalUrls(Entry("https://example.com").Strings, new string[0]));
        }

        [TestMethod]
        public void Set_EmptyList_RemovesAllAddressFields()
        {
            PwEntry entry = Entry("https://example.com", "KP2A_URL", "https://a.example.com", "kp2a_url_7", "https://b.example.com");
            Assert.IsTrue(Extensions.SetAdditionalUrls(entry.Strings, null));
            Assert.AreEqual(0, UrlFields(entry).Count);
        }

        [TestMethod]
        public void Set_RemovesDuplicateFieldsWithSameAddress()
        {
            PwEntry entry = Entry("https://example.com", "KP2A_URL_1", "https://a.example.com", "KP2A_URL_2", "https://a.example.com");
            Assert.IsTrue(Extensions.SetAdditionalUrls(entry.Strings, new[] { "https://a.example.com" }));
            Assert.AreEqual(1, UrlFields(entry).Count);
        }

        [TestMethod]
        public void LegacyListAndFields_AreReadTogether_AndMoveToFieldsOnSave()
        {
            PwEntry entry = Entry("https://example.com", "KP2A_URL_1", "https://field.example.com");
            var conf = new EntryConfigv2 { AltUrls = new[] { "https://legacy.example.com", "https://field.example.com" } };
            List<string> all = Extensions.AllAdditionalUrls(entry.Strings, conf);
            CollectionAssert.AreEqual(new[] { "https://legacy.example.com", "https://field.example.com" }, all);
            Assert.IsTrue(FerryService.BestMatchAccuracyForAnyURL(entry, conf, "https://legacy.example.com/x",
                URLSummary.FromURL("https://legacy.example.com/x"), MatchAccuracyMethod.Hostname) >= MatchAccuracy.HostnameAndPort);

            Extensions.SetAdditionalUrls(entry.Strings, all);
            CollectionAssert.AreEquivalent(all, entry.AdditionalUrlStrings());
        }
    }
}
