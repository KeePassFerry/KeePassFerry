namespace KeePassFerry.JsonRpc
{
    public class ClientMetadata
    {
        public string[] Features;
        // Kennung des gekoppelten Browsers, der die Anfrage stellt (SecureChannel.ClientId)
        public string ClientId;
    }
}