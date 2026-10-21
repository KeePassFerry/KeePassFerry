namespace KeePassFerry
{
    /// <summary>
    /// Verbindung zu einem Client: Nachricht senden, Verbindung schließen
    /// </summary>
    public interface IClientTransport
    {
        void Send(string message);
        void Close();

        // true: Kanal ist bereits verschlüsselt und beide Seiten sind authentisiert (SecureChannel)
        bool IsSecure { get; }
    }
}
