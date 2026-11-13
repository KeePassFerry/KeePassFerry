using KeePassLib;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KeePassFerry.Tests
{
    /// <summary>
    /// Symbol beim Aktualisieren eines Eintrags (#43): eigenes Symbol bleibt, Website-Symbol nur für den Standard-Schlüssel
    /// </summary>
    [TestClass]
    public class MergeIconTests
    {
        private static PwEntry WithCustomIcon(byte seed)
        {
            var entry = new PwEntry(true, true);
            var bytes = new byte[16];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = seed;
            entry.CustomIconUuid = new PwUuid(bytes);
            return entry;
        }

        [TestMethod]
        public void UpdateWithoutIcon_KeepsCustomIcon()
        {
            PwEntry destination = WithCustomIcon(7);
            PwUuid before = destination.CustomIconUuid;
            FerryService.MergeIcon(destination, new PwEntry(true, true));
            Assert.IsTrue(destination.CustomIconUuid.Equals(before));
        }

        [TestMethod]
        public void UpdateWithoutIcon_KeepsStandardIconOtherThanKey()
        {
            var destination = new PwEntry(true, true) { IconId = PwIcon.World };
            FerryService.MergeIcon(destination, new PwEntry(true, true));
            Assert.AreEqual(PwIcon.World, destination.IconId);
        }

        [TestMethod]
        public void UpdateWithFavicon_DoesNotReplaceCustomIcon()
        {
            PwEntry destination = WithCustomIcon(7);
            PwUuid before = destination.CustomIconUuid;
            FerryService.MergeIcon(destination, WithCustomIcon(9));
            Assert.IsTrue(destination.CustomIconUuid.Equals(before));
        }

        [TestMethod]
        public void UpdateWithFavicon_SetsIconOnEntryWithDefaultKey()
        {
            var destination = new PwEntry(true, true);
            PwEntry source = WithCustomIcon(9);
            FerryService.MergeIcon(destination, source);
            Assert.IsTrue(destination.CustomIconUuid.Equals(source.CustomIconUuid));
        }
    }
}
