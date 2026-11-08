import type { ResultWrapper } from "./pluginClient";
import { FerryLog } from "../common/Logger";
import { browserName } from "../common/browserName";
import { FerryChannelClient, BrowserFerryChannelStore } from "./FerryChannel";

/*
NativeSession.ts verwaltet die Verbindung zum KeePass-Plugin über Native Messaging:
Erweiterung <-> KeePassFerryHost.exe (stdin/stdout) <-> Named Pipe <-> Plugin.

Der Host meldet seinen Zustand mit eigenen Nachrichten:
  {"keepassferryHost": "connected"}     Pipe zu KeePass offen
  {"keepassferryHost": "disconnected"}  KeePass läuft nicht oder hat die Verbindung beendet
  {"keepassferryHost": "chunk", id, index, count, data}  Teil einer Nachricht über 1 MB (Base64)
Alles andere sind Nachrichten des verschlüsselten Kanals (FerryChannel.ts). Nach dem Handshake
laufen darüber unveränderte JSON-RPC-Nachrichten; Kees alte SRP-Kopplung wird hier nicht mehr benutzt.
*/

export const NATIVE_HOST_NAME = "keepassferry";

const RECONNECT_DELAY_MS = 5000;

export interface NativeSessionCallbacks {
    onOpening: () => boolean;
    onOpen: (serverFeatures: string[]) => void;
    onClose: () => void;
    onMessage: (obj: any) => void;
    onPairingCode: (code: string) => void;
    onProblem: (kind: "denied" | "serverKeyChanged" | "pairingNeedsUpdate" | "error") => void;
    clientFeatures: () => string[];
}


// Entpackt geladene Entwicklerversion im Namen kennzeichnen (Optionen in KeePass: welche Kopplung ist welche)
let installVariant: Promise<string> = null;
function clientName(): Promise<string> {
    installVariant ??= Promise.resolve()
        .then(() => chrome.management.getSelf())
        .then(self => (self.installType === "development" ? ", dev" : ""))
        .catch(() => "");
    return installVariant.then(variant => "KeePassFerry (" + (browserName() ?? "Browser") + variant + ")");
}

export class NativeSessionManager {
    private port: chrome.runtime.Port = null;
    private channel: FerryChannelClient = null;
    private readonly store = new BrowserFerryChannelStore();
    private keePassConnected = false;
    private reconnectTimer: number = null;
    private chunks = new Map<number, string[]>();
    private _features: string[] = [];
    private callbacks: Record<string, (resultWrapper: Partial<ResultWrapper>) => void> = {};

    public connectionProhibitedUntil = new Date(0);
    // Prüfcode, solange KeePass auf die Bestätigung der Kopplung wartet
    private pendingPairingCode: string = null;
    public lastHostError: string = null;

    constructor(private cb: NativeSessionCallbacks) {}

    public isActive() {
        return this.port !== null && this.keePassConnected && !!this.channel?.isReady;
    }

    public features() {
        return this.isActive() ? this._features : [];
    }

    public setClaimedFeatures(features: string[]) {
        this._features = features;
    }

    public registerCallback(
        requestId: number,
        callback: (resultWrapper: Partial<ResultWrapper>) => void
    ) {
        this.callbacks[requestId] = callback;
    }

    public invokeCallback(requestId: number, resultWrapper: Partial<ResultWrapper>) {
        if (this.callbacks[requestId] != null) this.callbacks[requestId](resultWrapper);
    }

    public unregisterCallback(requestId: number) {
        delete this.callbacks[requestId];
    }

    startup() {
        this.connectHost();
    }

    private connectHost() {
        this.reconnectTimer = null;
        if (this.port) return;
        if (this.connectionProhibitedUntil.getTime() > Date.now()) {
            this.scheduleReconnect();
            return;
        }

        FerryLog.debug("Connecting to native messaging host");
        try {
            this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        } catch (ex) {
            this.lastHostError = String(ex);
            FerryLog.warn("Native messaging host could not be started: " + ex);
            this.port = null;
            this.scheduleReconnect();
            return;
        }

        const port = this.port;
        port.onMessage.addListener(msg => this.receive(msg));
        port.onDisconnect.addListener(() => {
            // lastError muss gelesen werden, sonst meldet Chromium einen unbehandelten Fehler
            const error = chrome.runtime.lastError?.message;
            if (this.port !== port) return;
            this.lastHostError = error ?? null;
            FerryLog.warn("Native messaging host disconnected" + (error ? ": " + error : ""));
            this.port = null;
            this.setKeePassDisconnected();
            this.scheduleReconnect();
        });
    }

    private scheduleReconnect() {
        if (this.reconnectTimer !== null) return;
        const wait = Math.max(RECONNECT_DELAY_MS, this.connectionProhibitedUntil.getTime() - Date.now());
        this.reconnectTimer = self.setTimeout(() => this.connectHost(), wait);
    }

    private receive(msg: any) {
        if (!msg) return;
        const hostStatus = msg.keepassferryHost;
        if (hostStatus === undefined) {
            this.channel?.handle(msg);
            return;
        }

        switch (hostStatus) {
            case "connected":
                this.lastHostError = null;
                if (this.channel) return;
                if (!this.cb.onOpening()) return;
                this.startChannel();
                break;
            case "disconnected":
                this.setKeePassDisconnected();
                break;
            case "chunk":
                this.receiveChunk(msg);
                break;
            default:
                FerryLog.warn("Unknown native host status: " + hostStatus);
        }
    }

    // Verschlüsselten Kanal aufbauen (Handshake, ggf. Erstkopplung mit Prüfcode)
    private startChannel() {
        const channel = new FerryChannelClient(this.store, {
            send: frame => {
                try {
                    this.port?.postMessage(frame);
                } catch (ex) {
                    FerryLog.warn("Failed to send a native message: " + ex);
                }
            },
            onPairingCode: code => {
                this.pendingPairingCode = code;
                this.cb.onPairingCode(code);
            },
            onReady: features => {
                if (this.channel !== channel) return;
                this.pendingPairingCode = null;
                FerryLog.info("Secure channel to KeePass established");
                this.keePassConnected = true;
                this._features = features;
                this.cb.onOpen(features);
            },
            onMessage: text => {
                if (this.channel !== channel) return;
                this.cb.onMessage({ protocol: "jsonrpc", jsonrpc: text, encryptionNotRequired: true });
            },
            onDenied: () => {
                FerryLog.warn("KeePass declined the pairing");
                // Nicht sofort erneut fragen
                this.connectionProhibitedUntil = new Date(Date.now() + 60000);
                this.cb.onProblem("denied");
                this.closeSession();
            },
            onSecurityError: reason => {
                FerryLog.error("Secure channel error: " + reason);
                if (reason.includes("SERVER_KEY_CHANGED") || reason.includes("SERVER_UNKNOWN")) {
                    // Möglicher Angriff oder neu eingerichtetes KeePass: nicht automatisch weiterverbinden
                    this.connectionProhibitedUntil = new Date(Date.now() + 24 * 3600 * 1000);
                    this.cb.onProblem("serverKeyChanged");
                } else if (reason.includes("PAIRING_NEEDS_PLUGIN_UPDATE")) {
                    // Erst nach einem Plugin-Update erneut versuchen (KeePass-Neustart verbindet ohnehin neu)
                    this.connectionProhibitedUntil = new Date(Date.now() + 10 * 60 * 1000);
                    this.cb.onProblem("pairingNeedsUpdate");
                } else {
                    this.connectionProhibitedUntil = new Date(Date.now() + 10000);
                    this.cb.onProblem("error");
                }
                this.closeSession();
            }
        });
        this.channel = channel;
        clientName()
            .then(name => (this.channel === channel ? channel.start(name, this.cb.clientFeatures()) : undefined))
            .catch(e => {
                FerryLog.error("Could not start secure channel: " + e);
                this.closeSession();
            });
    }

    private receiveChunk(msg: { id: number; index: number; count: number; data: string }) {
        let parts = this.chunks.get(msg.id);
        if (!parts) {
            parts = new Array<string>(msg.count);
            this.chunks.set(msg.id, parts);
        }
        parts[msg.index] = msg.data;
        for (let i = 0; i < msg.count; i++) {
            if (parts[i] === undefined) return;
        }
        this.chunks.delete(msg.id);

        const byteParts = parts.map(p => Uint8Array.from(atob(p), c => c.charCodeAt(0)));
        const total = byteParts.reduce((sum, b) => sum + b.length, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const b of byteParts) {
            bytes.set(b, offset);
            offset += b.length;
        }
        let obj;
        try {
            obj = JSON.parse(new TextDecoder("utf-8").decode(bytes));
        } catch (ex) {
            FerryLog.error("Could not parse chunked message from native host: " + ex);
            return;
        }
        this.channel?.handle(obj);
    }

    private setKeePassDisconnected() {
        this.pendingPairingCode = null;
        this.chunks.clear();
        this.channel?.close();
        this.channel = null;
        if (!this.keePassConnected) return;
        this.keePassConnected = false;
        this.callbacks = {};
        FerryLog.debug("Native connection to KeePass closed");
        this.cb.onClose();
    }

    // Host bitten, KeePass den Vordergrund zu erlauben (für die Windows-Hello-Abfrage)
    allowKeePassForeground() {
        try {
            this.port?.postMessage({ keepassferryHost: "allowForeground" });
        } catch (ex) {
            FerryLog.debug("allowForeground failed: " + ex);
        }
    }

    // JSON-RPC-Text über den verschlüsselten Kanal senden
    sendMessage(data: string) {
        if (!this.port || !this.channel?.isReady) {
            FerryLog.warn("Secure channel not ready; message dropped");
            return;
        }
        this.channel.send(data).catch(ex => FerryLog.error("Failed to send over secure channel: " + ex));
    }

    // Zustand für die Einstellungsseite
    async status() {
        return {
            hostRunning: this.port !== null,
            connected: this.isActive(),
            paired: await this.store.isPaired(),
            pairingCode: this.isActive() ? null : this.pendingPairingCode,
            blockedUntil: this.connectionProhibitedUntil.getTime() > Date.now() ? this.connectionProhibitedUntil.getTime() : 0,
            hostError: this.lastHostError
        };
    }

    // Kopplung zurücksetzen und sofort neu verbinden (KeePass fragt dann erneut mit Prüfcode)
    async resetPairing() {
        await this.store.reset();
        this.connectionProhibitedUntil = new Date(0);
        this.closeSession();
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.connectHost();
    }

    // Beendet die Sitzung; der Host wird neu gestartet und baut eine frische Pipe-Verbindung auf
    closeSession() {
        if (this.port) {
            const port = this.port;
            this.port = null;
            try {
                port.disconnect();
            } catch (ex) {
                // Port war schon getrennt
            }
        }
        this.setKeePassDisconnected();
        this.scheduleReconnect();
    }
}
