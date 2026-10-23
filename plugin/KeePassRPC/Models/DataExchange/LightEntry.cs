namespace KeePassFerry.Models.DataExchange
{
    public class LightEntry
    {
        public string[] URLs;
        public string Title;
        public string UniqueID;
        public string UsernameValue;
        public string UsernameName;
        public string IconImageData;
        // KeePassFerry: Hinweis in der Trefferliste, dass Notizen bzw. Anhänge am Eintrag hängen
        public bool HasNotes;
        public int AttachmentCount;

        public LightEntry() { }

        public LightEntry(
            string[] urls,
            string title,
            string uniqueId,
            string iconImageData,
            string usernameName,
            string usernameValue)
        {
            URLs = urls;
            Title = title;
            UniqueID = uniqueId;
            IconImageData = iconImageData;
            UsernameName = usernameName;
            UsernameValue = usernameValue;
        }
    }
}