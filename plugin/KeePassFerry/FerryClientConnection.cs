using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using Jayrock.Json;
using Jayrock.Json.Conversion;
using Jayrock.JsonRpc;
using KeePassFerry.JsonRpc;
using KeePassFerry.Models.DataExchange;

namespace KeePassFerry
{
    /// <summary>
    /// Eine Verbindung zur Browser-Erweiterung. Sie besteht nur über den verschlüsselten, gekoppelten
    /// Ferry-Kanal (SecureChannel); jede Nachricht ist darin direkt eine JSON-RPC-Anfrage.
    /// (Kees SRP-Anmeldung, Schlüsselablage und Nachrichtenverschlüsselung sind entfernt.)
    /// </summary>
    public class FerryClientConnection
    {
        private static readonly string[] featuresOffered = {

            // Grundumfang des Protokolls
            "KEEPASSFERRY_BASE",

            // GetAllEntries or GetAllChildEntries can be used to
            // include results even if they have no URL
            "KEEPASSFERRY_ENTRIES_WITH_NO_URL",

            // Form fields with no configured name or ID will output an empty value
            // Before this feature, default name and IDs were used ("username" and "password")
            "KEEPASSFERRY_FIELD_DEFAULT_NAME_AND_ID_EMPTY",

            // OpenAndFocusDatabase can focus KeePass with a database, opening it first if required
            "KEEPASSFERRY_OPEN_AND_FOCUS_DATABASE",

            // Allow replacement of all URLs during entry update
            "KEEPASSFERRY_ENTRY_URL_REPLACEMENT",

            // Can send new DTO format
            "KEEPASSFERRY_DTO_V2",

            // KeePassFerry: Schutz eigener Felder umschalten (SetEntryFieldProtection)
            "KEEPASSFERRY_FIELD_PROTECTION",

            // KeePassFerry: Eintrag in den Papierkorb verschieben (MoveEntryToRecycleBin)
            "KEEPASSFERRY_ENTRY_RECYCLE",

            // KeePassFerry: Prüfcode der Kopplung mit Commit (SecureChannel)
            SecureChannel.PairingCommitFeature,

            // KeePassFerry: Passwortprüfung bei Have I Been Pwned (GetHibpCheck/SetHibpCheck) und Tipps (GetFerryTips)
            "KEEPASSFERRY_HIBP_CHECK",

            // KeePassFerry: geleakte Einträge für den Hinweis im Popup (GetHibpLeaks)
            "KEEPASSFERRY_HIBP_LEAKS",
            // KeePassFerry: Einstellungen zu KeePass im eigenen Dialog (OpenOptions), Vorwarnung von dort (GetExpiryWarnDays)
            "KEEPASSFERRY_OPTIONS_DIALOG",

            // KeePassFerry: Ablaufdatum der Einträge (ExpiryTime/ExpiryIntervalDays), neues Ablaufdatum beim
            // Speichern (NewExpiryTime), abgelaufene ausblenden (Get/SetHideExpired)
            "KEEPASSFERRY_EXPIRY",

            // KeePassFerry: eigene Kopplung entfernen (RemoveOwnPairing, vor "Kopplung zurücksetzen")
            "KEEPASSFERRY_REMOVE_OWN_PAIRING",

            // KeePassFerry: Ordner des Diagnoseprotokolls öffnen (OpenDiagnosticLogFolder)
            "KEEPASSFERRY_DIAG_FOLDER"
        };

        // Zusätzlich die Produktversion des Plugins ("KEEPASSFERRY_VERSION_1.2.3"): Die Erweiterung erkennt daran ein
        // veraltetes Plugin und bittet um ein Update (der Store aktualisiert nur die Erweiterung)
        internal static string[] FeaturesOfferedToClients
        {
            get
            {
                var version = (AssemblyInformationalVersionAttribute)Attribute.GetCustomAttribute(
                    Assembly.GetExecutingAssembly(), typeof(AssemblyInformationalVersionAttribute));
                var list = new List<string>(featuresOffered);
                if (version != null) list.Add("KEEPASSFERRY_VERSION_" + version.InformationalVersion);
                return list.ToArray();
            }
        }

        // ID des nächsten Signals an die Erweiterung
        private int _currentCallBackId;
        private readonly string[] _clientFeatures;
        private readonly string _clientId;

        /// <summary>Verbindung zur Erweiterung (verschlüsselter Ferry-Kanal)</summary>
        public IClientTransport Transport { get; private set; }

        /// <summary>Nur ein sicherer, gekoppelter Kanal darf KeePass benutzen</summary>
        public bool Authorised { get; private set; }

        /// <summary>Von der Erweiterung im Handshake gemeldete Funktionen</summary>
        public string[] ClientFeatures
        {
            get { return _clientFeatures; }
        }

        public FerryClientConnection(IClientTransport connection)
        {
            Transport = connection;
            Authorised = connection.IsSecure;
            var secure = connection as SecureChannel;
            if (secure != null)
            {
                _clientFeatures = secure.ClientFeatures;
                _clientId = secure.ClientId;
            }
        }

        /// <summary>
        /// Sendet ein Signal (z. B. "Datenbank geöffnet") als JSON-RPC-Aufruf an die Erweiterung.
        /// Eigener Thread: Der Aufrufer hält die Sperre der Verbindungsliste, der Versand soll sie nicht blockieren.
        /// </summary>
        public void Signal(Signal signal, string methodName)
        {
            if (!Authorised) return;
            JsonObject call = new JsonObject();
            call["id"] = Interlocked.Increment(ref _currentCallBackId);
            call["method"] = methodName;
            call["params"] = new[] { (int)signal };
            string text = JsonConvert.ExportToString(call);
            ThreadStart work = delegate
            {
                try
                {
                    Transport.Send(text);
                }
                catch (IOException)
                {
                    // Verbindung unerwartet geschlossen; die Erweiterung verbindet sich neu und holt den Zustand selbst
                }
            };
            Thread messageHandler = new Thread(work);
            messageHandler.Name = "signalDispatcher";
            messageHandler.IsBackground = true;
            messageHandler.Start();
        }

        /// <summary>Verarbeitet eine JSON-RPC-Anfrage der Erweiterung und sendet die Antwort zurück</summary>
        public void ReceiveMessage(string message, FerryService service)
        {
            if (!Authorised)
            {
                Transport.Close();
                return;
            }

            StringBuilder sb = new StringBuilder();
            JsonRpcDispatcherFactory.Current = s => new FerryJsonRpcDispatcher(s);
            JsonRpcDispatcher dispatcher = JsonRpcDispatcherFactory.CreateDispatcher(service);
            (dispatcher as FerryJsonRpcDispatcher).ClientMetadata = new ClientMetadata
            {
                Features = ClientFeatures,
                ClientId = _clientId
            };
            using (StringReader request = new StringReader(message))
            using (StringWriter response = new StringWriter(sb))
            {
                dispatcher.Process(request, response, Authorised);
            }
            Transport.Send(sb.ToString());
        }
    }
}
