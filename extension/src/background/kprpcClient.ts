import { NativeSessionManager } from "./NativeSession";
import { SessionType } from "../common/SessionType";
import { KeeLog } from "../common/Logger";
import type { Button } from "../common/Button";
import { FeatureFlags } from "../common/FeatureFlags";
import { KeeNotification } from "../common/KeeNotification";
import { utils } from "../common/utils";
import BackgroundStore from "~/store/BackgroundStore";
import { kee } from "./KF";

/*
kprpcClient.ts: JSON-RPC (KeePassRPC-Protokoll) zum KeePassFerry-Plugin über Native Messaging.
Den verschlüsselten Kanal, die Kopplung und das Wiederverbinden übernimmt NativeSessionManager (FerryChannel);
hier werden nur Anfragen verschickt, Antworten zugeordnet und Signale des Plugins weitergereicht.
(Kees Kee-Vault-Sitzungen, SRP-Anmeldung und WebSocket-Verschlüsselung sind entfernt.)
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

export class kprpcClient {
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

    getPrimarySessionManager() {
        return this.nativeSessionManager.isActive() ? this.nativeSessionManager : null;
    }

    getManagersForActiveSessions() {
        return this.nativeSessionManager.isActive() ? [this.nativeSessionManager] : [];
    }

    request(sessionManagers: NativeSessionManager[], method: string, params: any[]): Promise<SessionResponse[]> {
        const requestId = ++this.nextRequestId;
        const data = JSON.stringify({
            jsonrpc: "2.0",
            params: params,
            method: method,
            id: requestId
        });
        KeeLog.debug("Sending a JSON-RPC request");

        const responseManager = new SessionResponseManager(sessionManagers.length);
        for (const sessionManager of sessionManagers) {
            try {
                sessionManager.registerCallback(requestId, resultWrapper =>
                    responseManager.onResponse(SessionType.Websocket, resultWrapper, sessionManager.features())
                );
                // Der Kanal zum Plugin verschlüsselt selbst (FerryChannel); JSON-RPC geht unverändert hinein
                sessionManager.sendMessage(data);
            } catch (ex) {
                KeeLog.warn("JSON-RPC request could not be sent. Expect an async error soon. Exception: " + ex.message);
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
        if (method == "KPRPCListener" || method == "callBackToKeeFoxJS") this.KPRPCListener(data);
    }

    KPRPCListener(signal) {
        // asynchron, damit der Empfang sofort weiterlaufen kann
        self.setTimeout(function () {
            kee.KPRPCListener(signal);
        }, 5);
    }

    onNativeSessionClosed() {
        kee._pauseKee();
    }

    // data = bereits entschlüsselte Nachricht des Kanals
    receive(data) {
        if (data === undefined || data === null || !data.protocol) return;
        if (data.protocol === "jsonrpc") {
            if (data.jsonrpc === null || data.jsonrpc === undefined) return;
            const obj = JSON.parse(data.jsonrpc);
            if (obj) this.processJSONRPCresponse(obj, this.nativeSessionManager);
        } else if (data.protocol === "error" && data.error) {
            KeeLog.error("KeePassFerry plugin reported a connection error: " + data.error.code);
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
        kee.removeUserNotifications((notification: KeeNotification) => notification.name != "kee-connection-message");
        this.store.updateLatestConnectionError("");
        kee._refreshKPDB();
    }

    // Verschlüsselter Kanal zum Plugin steht (Handshake und ggf. Kopplung erledigt)
    setupNativeSession(features: string[]) {
        chrome.notifications.clear("keepassferry-pairing");
        if (!this.serverHasRequiredFeatures(features)) {
            KeeLog.error("KeePassFerry plugin is missing required features");
            this.store.updateLatestConnectionError("VERSION_CLIENT_TOO_HIGH");
            this.nativeSessionManager.closeSession();
            return;
        }
        this.onConnectStartup();
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
        this.showConnectionMessage($STRF("pairing_message", [display]));
    }

    showChannelProblem(kind: "denied" | "serverKeyChanged" | "error") {
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
            this.showConnectionMessage($STR("security_server_key_changed"));
        }
    }

    processJSONRPCresponse(obj, sessionManager: NativeSessionManager) {
        if ("result" in obj && obj.result !== false) {
            try {
                sessionManager.invokeCallback(obj.id, obj);
            } catch (e) {
                KeeLog.warn("An error occurred when processing the result callback for JSON-RPC object id " + obj.id + ": " + e);
            }
            sessionManager.unregisterCallback(obj.id);
        } else if ("error" in obj) {
            KeeLog.error("An error occurred in KeePassRPC object id: " + obj.id + " with this error: " + (obj.error?.message ?? obj.error));
            try {
                sessionManager.invokeCallback(obj.id, obj);
            } catch (e) {
                KeeLog.warn("An error occurred when processing the error callback for JSON-RPC object id " + obj.id + ": " + e);
            }
            sessionManager.unregisterCallback(obj.id);
        } else if ("method" in obj) {
            try {
                this.evalJson(obj.method, obj.params);
            } catch (e) {
                KeeLog.error("An error occurred when processing a JSON-RPC request: " + e);
            }
        } else if (!("id" in obj)) {
            KeeLog.error("Unexpected error processing receiveJSONRPC");
        }
    }

    showConnectionMessage(msg: string, buttons?: Button[]) {
        kee.notifyUser(new KeeNotification("kee-connection-message", buttons ? buttons : [], utils.newGUID(), [msg], "Medium"));
    }
}
