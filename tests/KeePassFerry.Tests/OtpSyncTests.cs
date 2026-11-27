using System;
using System.Reflection;
using KeePassLib;
using KeePassLib.Security;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Zwei-Faktor-Schlüssel in "otp" und TimeOtp-* (#55): Schreiben im KeePass-Format, Abgleich per Merker und Chronik
    /// </summary>
    [TestClass]
    public class OtpSyncTests
    {
        // RFC-6238-Testschlüssel "12345678901234567890" als Base32
        private const string Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        private const string Other = "JBSWY3DPEHPK3PXP";

        private static string Uri(string secret, int digits = 6, string algorithm = "SHA1", int period = 30)
        {
            return "otpauth://totp/Spielwiese:alice?secret=" + secret + "&issuer=Spielwiese&digits=" + digits
                   + "&period=" + period + "&algorithm=" + algorithm;
        }

        private static PwDatabase Db(int historyMaxItems = 10)
        {
            var db = new PwDatabase { RootGroup = new PwGroup(true, true, "Root", PwIcon.Folder) };
            db.HistoryMaxItems = historyMaxItems;
            return db;
        }

        private static PwEntry Entry(PwDatabase db, string otp = null, OtpSync.OtpParams native = null)
        {
            var e = new PwEntry(true, true);
            e.Strings.Set(PwDefs.TitleField, new ProtectedString(false, "Spielwiese"));
            e.Strings.Set(PwDefs.UserNameField, new ProtectedString(false, "alice"));
            if (otp != null) e.Strings.Set(Totp.OtpField, new ProtectedString(true, otp));
            if (native != null) OtpSync.WriteNative(e.Strings, native);
            db.RootGroup.AddEntry(e, true);
            return e;
        }

        private static OtpSync.OtpParams P(string secret, int digits = 6, string algorithm = "SHA1")
        {
            var p = OtpSync.FromUri(Uri(secret, digits, algorithm));
            Assert.IsNotNull(p);
            return p;
        }

        // Ein späterer Bearbeitungsschritt wie in KeePass oder einer App: alter Stand in die Chronik, dann ändern
        private static void Edit(PwEntry e, PwDatabase db, Action<PwEntry> change)
        {
            e.CreateBackup(db);
            change(e);
            e.Touch(true, false);
        }

        [TestMethod]
        public void Base32_RoundTrips()
        {
            var rnd = new Random(1);
            for (int len = 1; len < 40; len++)
            {
                var data = new byte[len];
                rnd.NextBytes(data);
                CollectionAssert.AreEqual(data, Totp.Base32Decode(OtpSync.Base32Encode(data)));
            }
            Assert.AreEqual(Secret, OtpSync.Base32Encode(System.Text.Encoding.ASCII.GetBytes("12345678901234567890")));
        }

        [TestMethod]
        public void WrittenNativeFields_AreReadByKeePassItself_SameCodeAsOtp()
        {
            // KeePass' eigene (interne) Funktionen: EntryUtil.GetOtpSecret und HmacOtp.GenerateTimeOtp
            Assembly kp = typeof(KeePass.Program).Assembly;
            MethodInfo getSecret = kp.GetType("KeePass.Util.EntryUtil").GetMethod("GetOtpSecret", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            MethodInfo generate = kp.GetType("KeePassLib.Cryptography.HmacOtp").GetMethod("GenerateTimeOtp", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            Assert.IsNotNull(getSecret, "KeePass.Util.EntryUtil.GetOtpSecret");
            Assert.IsNotNull(generate, "HmacOtp.GenerateTimeOtp");

            foreach (string alg in new[] { "SHA1", "SHA256", "SHA512" })
                foreach (int digits in new[] { 6, 7, 8 })
                {
                    PwDatabase db = Db();
                    PwEntry e = Entry(db, null, P(Secret, digits, alg));
                    var key = (byte[])getSecret.Invoke(null, new object[] { e, OtpSync.NativePrefix });
                    CollectionAssert.AreEqual(System.Text.Encoding.ASCII.GetBytes("12345678901234567890"), key, alg + "/" + digits);
                    DateTime now = DateTime.UtcNow;
                    var kpCode = (string)generate.Invoke(null, new object[] { key, (DateTime?)now, 30u, (uint)digits, e.Strings.ReadSafe(OtpSync.NativeAlgorithm) });
                    TotpResult ours = Totp.ComputeFromUri(Uri(Secret, digits, alg), now);
                    Assert.AreEqual(ours.code, kpCode, alg + "/" + digits);
                }
        }

        [TestMethod]
        public void KeePassCannot_SteamOrMoreThan8Digits()
        {
            Assert.IsFalse(P(Secret, 9).FitsKeePass);
            Assert.IsFalse(OtpSync.FromUri("otpauth://totp/x?secret=" + Secret + "&encoder=steam").FitsKeePass);
            Assert.IsFalse(OtpSync.WriteNative(Entry(Db()).Strings, P(Secret, 10)));
        }

        [TestMethod]
        public void OnlyOtp_AddsNative_OnlyNative_AddsOtp()
        {
            PwDatabase db = Db();
            PwEntry a = Entry(db, Uri(Secret));
            Assert.AreEqual(OtpSync.Change.AddedNative, OtpSync.Sync(a, db));
            Assert.IsTrue(OtpSync.FromNative(a.Strings).SameKeyAs(P(Secret)));
            Assert.AreEqual(1u, a.History.UCount, "Copy in the history");

            PwEntry b = Entry(db, null, P(Secret, 8, "SHA256"));
            Assert.AreEqual(OtpSync.Change.AddedOtp, OtpSync.Sync(b, db));
            Assert.IsTrue(OtpSync.FromUri(b.Strings.ReadSafe(Totp.OtpField)).SameKeyAs(P(Secret, 8, "SHA256")));
            Assert.IsTrue(b.Strings.Get(Totp.OtpField).IsProtected);

            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(a, db), "Second run changes nothing");
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(b, db));
        }

        [TestMethod]
        public void SameKeyInBoth_OnlyMarked_NoHistory()
        {
            PwDatabase db = Db();
            PwEntry e = Entry(db, Uri(Secret), P(Secret));
            Assert.AreEqual(OtpSync.Change.Marked, OtpSync.Sync(e, db));
            Assert.AreEqual(0u, e.History.UCount);
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(e, db));
        }

        [TestMethod]
        public void ChangedOnPhone_OtpWins_ByMarker_EvenWithoutHistory()
        {
            PwDatabase db = Db(0);
            PwEntry e = Entry(db, Uri(Secret));
            OtpSync.Sync(e, db);
            // App ändert nur "otp", ohne Chronik
            e.Strings.Set(Totp.OtpField, new ProtectedString(true, Uri(Other)));
            Assert.AreEqual(OtpSync.Change.NativeFromOtp, OtpSync.Sync(e, db));
            Assert.IsTrue(OtpSync.FromNative(e.Strings).SameKeyAs(P(Other)));
        }

        [TestMethod]
        public void ChangedInKeePass_NativeWins_ByMarker()
        {
            PwDatabase db = Db();
            PwEntry e = Entry(db, Uri(Secret));
            OtpSync.Sync(e, db);
            Edit(e, db, x => OtpSync.WriteNative(x.Strings, P(Other)));
            Assert.AreEqual(OtpSync.Change.OtpFromNative, OtpSync.Sync(e, db));
            Assert.IsTrue(OtpSync.FromUri(e.Strings.ReadSafe(Totp.OtpField)).SameKeyAs(P(Other)));
        }

        [TestMethod]
        public void WithoutMarker_HistoryDecides()
        {
            PwDatabase db = Db();
            PwEntry e = Entry(db, Uri(Secret), P(Secret));
            Edit(e, db, x => OtpSync.WriteNative(x.Strings, P(Other)));
            Assert.AreEqual(OtpSync.Change.OtpFromNative, OtpSync.Decide(e, true));

            PwEntry f = Entry(db, Uri(Secret), P(Secret));
            Edit(f, db, x => x.Strings.Set(Totp.OtpField, new ProtectedString(true, Uri(Other))));
            Assert.AreEqual(OtpSync.Change.NativeFromOtp, OtpSync.Decide(f, true));
        }

        [TestMethod]
        public void Unclear_OtpOnlyWhenHistoryKeepsTheOther()
        {
            PwDatabase db = Db(0);
            PwEntry e = Entry(db, Uri(Secret), P(Other));
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(e, db), "No history: nothing overwritten");
            Assert.IsTrue(OtpSync.FromNative(e.Strings).SameKeyAs(P(Other)));

            PwDatabase withHistory = Db();
            PwEntry f = Entry(withHistory, Uri(Secret), P(Other));
            Assert.AreEqual(OtpSync.Change.NativeFromOtp, OtpSync.Sync(f, withHistory));
            Assert.AreEqual(1u, f.History.UCount);
            Assert.IsTrue(OtpSync.FromNative(f.History.GetAt(0).Strings).SameKeyAs(P(Other)), "Old key kept in the history");
        }

        [TestMethod]
        public void NotTouched_BrokenUri_Steam_UnreadableNative()
        {
            PwDatabase db = Db();
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(Entry(db, "otpauth://totp/x?issuer=y"), db));
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(Entry(db, "otpauth://totp/x?secret=" + Secret + "&encoder=steam"), db));
            PwEntry bad = Entry(db, Uri(Secret));
            bad.Strings.Set("TimeOtp-Secret-Hex", new ProtectedString(true, "zz"));
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(bad, db));
            Assert.AreEqual(OtpSync.Change.None, OtpSync.Sync(Entry(db), db));
        }

        [TestMethod]
        public void SyncDatabase_SkipsRecycleBin_MarksModified()
        {
            PwDatabase db = Db();
            var bin = new PwGroup(true, true, "Papierkorb", PwIcon.TrashBin);
            db.RootGroup.AddGroup(bin, true);
            db.RecycleBinEnabled = true;
            db.RecycleBinUuid = bin.Uuid;
            PwEntry live = Entry(db, Uri(Secret));
            var trashed = new PwEntry(true, true);
            trashed.Strings.Set(Totp.OtpField, new ProtectedString(true, Uri(Secret)));
            bin.AddEntry(trashed, true);
            // Ohne IOConnection gilt die Datenbank als nicht geöffnet: direkt über die Einträge
            Assert.AreEqual(OtpSync.Change.AddedNative, OtpSync.Sync(live, db));
            Assert.IsTrue(trashed.IsContainedIn(bin));
        }
    }
}
