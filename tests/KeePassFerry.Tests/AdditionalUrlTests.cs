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
    }
}
