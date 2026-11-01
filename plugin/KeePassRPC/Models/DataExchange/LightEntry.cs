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
        // KeePassFerry: Hinweis in der Trefferliste, dass Notizen, Anhänge, Passkey bzw. OTP am Eintrag hängen
        public bool HasNotes;
        public int AttachmentCount;
        public bool HasPasskey;
        public bool HasOtp;
        // KeePassFerry: Passwort laut Plugin "HIBP Offline Check" in Datenlecks gefunden (Anzahl, falls bekannt)
        public bool PasswordLeaked;
        public int PasswordLeakCount;

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