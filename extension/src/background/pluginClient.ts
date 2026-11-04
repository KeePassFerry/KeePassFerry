import { NativeSessionManager } from "./NativeSession";
import { SessionType } from "../common/SessionType";
import { FerryLog } from "../common/Logger";
import type { Button } from "../common/Button";
import { FeatureFlags, PLUGIN_UPDATE_NOTICE, pluginUpdateAvailable, pluginVersionFrom } from "../common/FeatureFlags";
import { FerryNotification } from "../common/FerryNotification";
import { utils } from "../common/utils";
import BackgroundStore from "~/store/BackgroundStore";
import { ferry } from "./KF";

/*
pluginClient.ts: JSON-RPC zum KeePassFerry-Plugin über Native Messaging.
Den verschlüsselten Kanal, die Kopplung und das Wiederverbinden übernimmt NativeSessionManager (FerryChannel);
hier werden nur Anfragen verschickt, Antworten zugeordnet und Signale des Plugins weitergereicht.
*/

export interface ResultWrapper {
    result: any;
    error: any;
}

class SessionResponse {
    sessionType: SessionType;
    resultWrapper: Partial<ResultWrapper>;
    features: string[];
}

// Sammelt die Antworten aller angefragten Sitzungen (bei KeePassFerry genau eine)
class SessionResponseManager {
    private responses: SessionResponse[] = [];
    public pendingResponses: Promise<SessionResponse[]>;
    private resolve;
    constructor(private responsesRequired: number) {
        this.pendingResponses = new Promise<SessionResponse[]>(resolve => {
            this.resolve = resolve;
            if (responsesRequired === 0) resolve([]);
        });
    }
    public onResponse(sessionType: SessionType, resultWrapper: Partial<ResultWrapper>, features: string[]) {
        this.responses.push({ sessionType, resultWrapper, features });
        if (this.responses.length === this.responsesRequired) {
            this.resolve(this.responses);
        }
    }
}

export class pluginClient {
    private nextRequestId: number;
    public nativeSessionManager: NativeSessionManager;
    private store: BackgroundStore;

    public constructor(store: BackgroundStore) {
        this.nextRequestId = 1;
        this.nativeSessionManager = new NativeSessionManager({
            onOpening: () => true,
            onOpen: features => this.setupNativeSession(features),
            onClose: () => this.onNativeSessionClosed(),
            onMessage: obj => this.receive(obj),
            onPairingCode: code => this.showPairingCode(code),
            onProblem: kind => this.showChannelProblem(kind),
            clientFeatures: () => FeatureFlags.offered
        });
        this.store = store;
    }

    allowKeePassForeground() {
        this.nativeSessionManager.allowKeePassForeground();
    }

    startNativeSessionManager() {
        this.nativeSessionManager.startup();
    }

    getSessionManagerByType(_sessionType?: SessionType) {
        return this.nativeSessionManager;
    }

    // Plugin zu alt für das Protokoll dieser Erweiterung: Kanal bleibt nur für "Jetzt aktualisieren" offen
    private pluginTooOld = false;

    getPrimarySessionManager() {
        return this.nativeSessionManager.isActive() && !this.pluginTooOld ? this.nativeSessionManager : null;
    }

    getManagersForActiveSessions() {
        return this.nativeSessionManager.isActive() && !this.pluginTooOld ? [this.nativeSessionManager] : [];
    }

    // Für das Plugin-Update auch dann, wenn das Plugin zu alt ist
    getUpdateSessionManager() {
        return this.nativeSessionManager.isActive() ? this.nativeSessionManager : null;
    }

    request(sessionManagers: NativeSessionManager[], method: string, params: any[]): Promise<SessionResponse[]> {
        const requestId = ++this.nextRequestId;
        const data = JSON.stringify({
            jsonrpc: "2.0",
            params: params,
            method: method,
            id: requestId
        });
        FerryLog.debug("Sending a JSON-RPC request");

        const responseManager = new SessionResponseManager(sessionManagers.length);
        for (const sessionManager of sessionManagers) {
            try {
                sessionManager.registerCallback(requestId, resultWrapper =>
                    responseManager.onResponse(SessionType.Native, resultWrapper, sessionManager.features())
                );
                // Der Kanal zum Plugin verschlüsselt selbst (FerryChannel); JSON-RPC geht unverändert hinein
                sessionManager.sendMessage(data);
            } catch (ex) {
                FerryLog.warn("JSON-RPC request could not be sent. Expect an async error soon. Exception: " + ex.message);
                self.setTimeout(() => {
                    this.processJSONRPCresponse(
                        { id: requestId, error: { message: "Send failure. Maybe the server went away?" }, message: "error" },
                        sessionManager
                    );
                }, 50);
            }
        }
        return responseManager.pendingResponses;
    }

    // Vom Plugin aufgerufene Methode (Signale wie "Datenbank gespeichert")
    evalJson(method, params) {
        let data = JSON.stringify(params);
        if (data) data = data.match(/\s*\[(.*)\]\s*/)[1];
        if (method == "FerryListener") this.FerryListener(data);
    }

    FerryListener(signal) {
        // asynchron, damit der Empfang sofort weiterlaufen kann
        self.setTimeout(function () {
            ferry.FerryListener(signal);
        }, 5);
    }

    onNativeSessionClosed() {
        ferry._pauseFerry();
    }

    // data = bereits entschlüsselte Nachricht des Kanals
    receive(data) {
        if (data === undefined || data === null || !data.protocol) return;
        if (data.protocol === "jsonrpc") {
            if (data.jsonrpc === null || data.jsonrpc === undefined) return;
            const obj = JSON.parse(data.jsonrpc);
            if (obj) this.processJSONRPCresponse(obj, this.nativeSessionManager);
        } else if (data.protocol === "error" && data.error) {
            FerryLog.error("KeePassFerry plugin reported a connection error: " + data.error.code);
            this.store.updateLatestConnectionError(data.error.code ?? "UNKNOWN_JSONRPC");
            this.showConnectionMessage($STR("conn_unknown_error"));
            this.nativeSessionManager.closeSession();
        }
    }

    serverHasRequiredFeatures(features) {
        return !!features && FeatureFlags.required.every(feature => features.indexOf(feature) !== -1);
    }

    onConnectStartup() {
        // Verbindungsfehler von vorher sind damit erledigt
        ferry.removeUserNotifications((notification: FerryNotification) => notification.name != "ferry-connection-message");
        this.store.updateLatestConnectionError("");
        ferry._refreshKPDB();
    }

    // Verschlüsselter Kanal zum Plugin steht (Handshake und ggf. Kopplung erledigt)
    setupNativeSession(features: string[]) {
        chrome.notifications.clear("keepassferry-pairing");
        this.pluginTooOld = !this.serverHasRequiredFeatures(features);
        if (this.pluginTooOld) {
            FerryLog.error("KeePassFerry plugin is missing required features");
            this.store.updateLatestConnectionError("VERSION_CLIENT_TOO_HIGH");
            // Älteres KeePassFerry-Plugin (meldet seine Version, z. B. 1.0.14 vor der Umbenennung des Protokolls):
            // Kanal offen lassen, damit "Jetzt aktualisieren" das Update in KeePass anstoßen kann; sonst trennen
            if (pluginVersionFrom(features)) {
                this.showPluginUpdateNotice();
            } else {
                this.nativeSessionManager.closeSession();
            }
            return;
        }
        this.onConnectStartup();
        // Der Store aktualisiert nur die Erweiterung: ein älteres Plugin um ein Update bitten, nach dem Update den
        // Hinweis wieder entfernen
        if (pluginUpdateAvailable(features)) this.showPluginUpdateNotice();
        else ferry.removeUserNotifications((n: FerryNotification) => n.name != PLUGIN_UPDATE_NOTICE);
    }

    // Ohne × (Notification.vue): der Hinweis bleibt, bis das Plugin aktualisiert ist
    private showPluginUpdateNotice() {
        const button: Button = { label: $STR("ferry_plugin_update_button"), action: "startPluginUpdate" };
        ferry.notifyUser(
            new FerryNotification(PLUGIN_UPDATE_NOTICE, [button], utils.newGUID(), [$STR("ferry_plugin_update_message")], "Medium")
        );
    }

    // Erstkopplung: Prüfcode anzeigen, Bestätigung erfolgt in KeePass
    showPairingCode(code: string) {
        const display = code.slice(0, 3) + " " + code.slice(3);
        chrome.notifications.create("keepassferry-pairing", {
            type: "basic",
            iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
            title: $STR("pairing_title"),
            message: $STRF("pairing_message", [display]),
            requireInteraction: true,
            priority: 2
        });
        this.showConnectionMessage($STRF("pairing_message", [display]), undefined, false);
    }

    showChannelProblem(kind: "denied" | "serverKeyChanged" | "pairingNeedsUpdate" | "error") {
        chrome.notifications.clear("keepassferry-pairing");
        if (kind === "denied") {
            this.showConnectionMessage($STR("pairing_denied"));
        } else if (kind === "serverKeyChanged") {
            chrome.notifications.create("keepassferry-security", {
                type: "basic",
                iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
                title: $STR("security_warning_title"),
                message: $STR("security_server_key_changed"),
                requireInteraction: true,
                priority: 2
            });
            this.showConnectionMessage($STR("security_server_key_changed"), undefined, false);
        } else if (kind === "pairingNeedsUpdate") {
            this.showConnectionMessage($STR("pairing_needs_plugin_update"));
        }
    }

    processJSONRPCresponse(obj, sessionManager: NativeSessionManager) {
        // Auch "false" ist eine Antwort (z. B. GetHideExpired); sonst wartet die Anfrage ewig
        if ("result" in obj) {
            try {
                sessionManager.invokeCallback(obj.id, obj);
            } catch (e) {
                FerryLog.warn("An error occurred when processing the result callback for JSON-RPC object id " + obj.id + ": " + e);
            }
            sessionManager.unregisterCallback(obj.id);
        } else if ("error" in obj) {
            FerryLog.error("An error occurred in plugin request id: " + obj.id + " with this error: " + (obj.error?.message ?? obj.error));
            try {
                sessionManager.invokeCallback(obj.id, obj);
            } catch (e) {
                FerryLog.warn("An error occurred when processing the error callback for JSON-RPC object id " + obj.id + ": " + e);
            }
            sessionManager.unregisterCallback(obj.id);
        } else if ("method" in obj) {
            try {
                this.evalJson(obj.method, obj.params);
            } catch (e) {
                FerryLog.error("An error occurred when processing a JSON-RPC request: " + e);
            }
        } else if (!("id" in obj)) {
            FerryLog.error("Unexpected error processing receiveJSONRPC");
        }
    }

    showConnectionMessage(msg: string, buttons?: Button[], osNotification = true) {
        ferry.notifyUser(
            new FerryNotification("ferry-connection-message", buttons ? buttons : [], utils.newGUID(), [msg], "Medium"),
            undefined,
            osNotification
        );
    }
}
