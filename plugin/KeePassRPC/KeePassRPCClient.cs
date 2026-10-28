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
    public class KeePassRPCClientConnection
    {
        private static readonly string[] featuresOffered = {

            // Full feature set as of KeeFox 1.6
            "KPRPC_FEATURE_VERSION_1_6",

            // Allow clients without the name KeeFox to connect
            "KPRPC_GENERAL_CLIENTS",

            // Renamed KeeFox to Kee
            "KPRPC_FEATURE_KEE_BRAND",

            // GetAllEntries or GetAllChildEntries can be used to
            // include results even if they have no URL
            "KPRPC_ENTRIES_WITH_NO_URL",

            // Form fields with no configured name or ID will output an empty value
            // Before this feature, default name and IDs were used ("username" and "password")
            "KPRPC_FIELD_DEFAULT_NAME_AND_ID_EMPTY",

            // OpenAndFocusDatabase can focus KeePass with a database, opening it first if required
            "KPRPC_OPEN_AND_FOCUS_DATABASE",

            // Allow replacement of all URLs during entry update
            "KPRPC_FEATURE_ENTRY_URL_REPLACEMENT",

            // Contains critical security fixes
            "KPRPC_SECURITY_FIX_20200729",

            // Can send new DTO format
            "KPRPC_FEATURE_DTO_V2",

            // KeePassFerry: Schutz eigener Felder umschalten (SetEntryFieldProtection)
            "KEEPASSFERRY_FIELD_PROTECTION"
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

        /// <summary>Verbindung zur Erweiterung (verschlüsselter Ferry-Kanal)</summary>
        public IClientTransport Transport { get; private set; }

        /// <summary>Nur ein sicherer, gekoppelter Kanal darf KeePass benutzen</summary>
        public bool Authorised { get; private set; }

        /// <summary>Von der Erweiterung im Handshake gemeldete Funktionen</summary>
        public string[] ClientFeatures
        {
            get { return _clientFeatures; }
        }

        public KeePassRPCClientConnection(IClientTransport connection)
        {
            Transport = connection;
            Authorised = connection.IsSecure;
            var secure = connection as SecureChannel;
            if (secure != null) _clientFeatures = secure.ClientFeatures;
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
        public void ReceiveMessage(string message, KeePassRPCService service)
        {
            if (!Authorised)
            {
                Transport.Close();
                return;
            }

            StringBuilder sb = new StringBuilder();
            JsonRpcDispatcherFactory.Current = s => new KprpcJsonRpcDispatcher(s);
            JsonRpcDispatcher dispatcher = JsonRpcDispatcherFactory.CreateDispatcher(service);
            (dispatcher as KprpcJsonRpcDispatcher).ClientMetadata = new ClientMetadata
            {
                Features = ClientFeatures
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
