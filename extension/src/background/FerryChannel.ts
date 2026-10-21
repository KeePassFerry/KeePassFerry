/*
FerryChannel.ts: Client-Seite des verschlüsselten Kanals zum KeePass-Plugin (Protokoll v1, siehe
plugin/KeePassRPC/SecureChannel.cs). Nur WebCrypto, keine weiteren Abhängigkeiten (auch in Node testbar).

- Je Verbindung frischer ECDH-P-256-Schlüsseltausch → HKDF-SHA-256 → AES-256-GCM je Richtung
- Erweiterung: dauerhafter ECDSA-P-256-Schlüssel (privater Teil nicht exportierbar), signiert den Handshake
- KeePass: dauerhafter Server-Schlüssel; beim ersten Kontakt gemerkt (Pinning), danach muss er gleich bleiben
- Erstkopplung: beide Seiten zeigen denselben 6-stelligen Prüfcode, bestätigt wird in KeePass
- Nachrichten mit Zähler je Richtung, streng fortlaufend
*/

export interface FerryChannelStore {
    getClientId(): Promise<string>;
    // Dauerhaftes Signatur-Schlüsselpaar der Erweiterung (wird beim ersten Aufruf erzeugt)
    getIdentity(): Promise<CryptoKeyPair>;
    getPinnedServerKey(serverId: string): Promise<string>;
    pinServerKey(serverId: string, publicKeyB64: string): Promise<void>;
}

export interface FerryChannelEvents {
    send(frame: any): void;
    onReady(serverFeatures: string[]): void;
    onPairingCode(code: string): void;
    onMessage(text: string): void;
    onDenied(): void;
    onSecurityError(reason: string): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const AAD = enc.encode("KeePassFerry v1");

function b64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function unb64(text: string, expectedLength?: number): Uint8Array {
    const s = atob(text ?? "");
    const bytes = Uint8Array.from(s, c => c.charCodeAt(0));
    if (expectedLength !== undefined && bytes.length !== expectedLength) throw new Error("Unexpected field length");
    return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", concat(...parts)));
}

function counterNonce(n: number): Uint8Array {
    const nonce = new Uint8Array(12);
    let v = BigInt(n);
    for (let i = 11; i >= 4; i--) {
        nonce[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return nonce;
}

export function pairingCodeFromHash(h: Uint8Array): string {
    const v = ((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3];
    return (v % 1000000).toString().padStart(6, "0");
}

type State = "idle" | "awaitHello" | "awaitReady" | "ready" | "closed";

export class FerryChannelClient {
    private state: State = "idle";
    private eph: CryptoKeyPair;
    private clientNonce: Uint8Array;
    private clientPub: Uint8Array;
    private clientId: string;
    private sendKey: CryptoKey;
    private receiveKey: CryptoKey;
    private sendCounter = 0;
    private receiveCounter = 0;
    private serverId: string;
    private serverPubB64: string;
    private serverIsNew = false;
    private sendChain: Promise<void> = Promise.resolve();
    private receiveChain: Promise<void> = Promise.resolve();

    constructor(private store: FerryChannelStore, private events: FerryChannelEvents) {}

    public get isReady() {
        return this.state === "ready";
    }

    public async start(clientName: string, clientFeatures: string[]) {
        this.clientId = await this.store.getClientId();
        const identity = await this.store.getIdentity();
        this.clientPub = new Uint8Array(await crypto.subtle.exportKey("raw", identity.publicKey));
        this.eph = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])) as CryptoKeyPair;
        const ephPub = new Uint8Array(await crypto.subtle.exportKey("raw", this.eph.publicKey));
        this.clientNonce = crypto.getRandomValues(new Uint8Array(16));
        this.state = "awaitHello";
        this.events.send({
            ferry: "hello",
            v: 1,
            clientId: this.clientId,
            clientPub: b64(this.clientPub),
            eph: b64(ephPub),
            nonce: b64(this.clientNonce),
            name: clientName,
            features: clientFeatures
        });
    }

    // Eingehende Nachricht vom Plugin; Reihenfolge bleibt erhalten
    public handle(frame: any): Promise<void> {
        this.receiveChain = this.receiveChain.then(() => this.process(frame)).catch(e => this.fail(String(e)));
        return this.receiveChain;
    }

    // Klartext (JSON-RPC) verschlüsselt senden; Reihenfolge bleibt erhalten
    public send(text: string): Promise<void> {
        this.sendChain = this.sendChain.then(async () => {
            if (this.state !== "ready") throw new Error("Channel not ready");
            const n = ++this.sendCounter;
            const c = new Uint8Array(
                await crypto.subtle.encrypt({ name: "AES-GCM", iv: counterNonce(n), additionalData: AAD }, this.sendKey, enc.encode(text))
            );
            this.events.send({ ferry: "m", n, c: b64(c) });
        });
        return this.sendChain;
    }

    public close() {
        this.state = "closed";
    }

    private fail(reason: string) {
        if (this.state === "closed") return;
        this.state = "closed";
        this.events.onSecurityError(reason);
    }

    private async process(frame: any) {
        if (this.state === "closed") return;
        switch (frame?.ferry) {
            case "hello":
                if (this.state !== "awaitHello") throw new Error("Unexpected hello");
                await this.onServerHello(frame);
                return;
            case "pairing":
                // Prüfcode wurde schon beim Hello berechnet; jetzt anzeigen
                if (this.state === "awaitReady" && this.pendingCode) this.events.onPairingCode(this.pendingCode);
                return;
            case "denied":
                this.state = "closed";
                this.events.onDenied();
                return;
            case "m":
                await this.onEncrypted(frame);
                return;
            default:
                throw new Error("Unexpected frame");
        }
    }

    private pendingCode: string = null;
    private serverFeatures: string[] = [];

    private async onServerHello(frame: any) {
        if (frame.v !== 1) throw new Error("Unsupported protocol version");
        const serverId = String(frame.serverId ?? "");
        if (!/^[A-Za-z0-9-]{8,64}$/.test(serverId)) throw new Error("Invalid server id");
        const serverPub = unb64(frame.serverPub, 65);
        const serverEph = unb64(frame.eph, 65);
        const serverNonce = unb64(frame.nonce, 16);
        const sig = unb64(frame.sig, 64);

        // Pinning: bekannter Server muss denselben Schlüssel haben
        const pinned = await this.store.getPinnedServerKey(serverId);
        const serverPubB64 = b64(serverPub);
        if (pinned && pinned !== serverPubB64) throw new Error("SERVER_KEY_CHANGED");
        this.serverIsNew = !pinned;
        this.serverId = serverId;
        this.serverPubB64 = serverPubB64;

        const ephPub = new Uint8Array(await crypto.subtle.exportKey("raw", this.eph.publicKey));
        const th = await sha256(
            enc.encode("KeePassFerry handshake v1"), new Uint8Array([0]),
            enc.encode(this.clientId), new Uint8Array([0]), this.clientPub, ephPub, this.clientNonce,
            enc.encode(serverId), new Uint8Array([0]), serverPub, serverEph, serverNonce
        );

        const serverVerifyKey = await crypto.subtle.importKey("raw", serverPub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        const serverOk = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" }, serverVerifyKey, sig, concat(enc.encode("KeePassFerry server v1"), th)
        );
        if (!serverOk) throw new Error("Invalid server signature");

        const peer = await crypto.subtle.importKey("raw", serverEph, { name: "ECDH", namedCurve: "P-256" }, false, []);
        const z = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, this.eph.privateKey, 256));
        // Wie Windows CNG (KDF "Hash"): Eingabe für HKDF ist SHA-256(Z)
        const zHash = await sha256(z);
        const hkdfKey = await crypto.subtle.importKey("raw", zHash, "HKDF", false, ["deriveBits"]);
        const okm = new Uint8Array(
            await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: th, info: enc.encode("KeePassFerry keys v1") }, hkdfKey, 512)
        );
        this.sendKey = await crypto.subtle.importKey("raw", okm.slice(0, 32), "AES-GCM", false, ["encrypt"]);
        this.receiveKey = await crypto.subtle.importKey("raw", okm.slice(32, 64), "AES-GCM", false, ["decrypt"]);
        okm.fill(0);
        z.fill(0);

        this.pendingCode = pairingCodeFromHash(await sha256(enc.encode("KeePassFerry SAS v1"), th));
        this.serverFeatures = Array.isArray(frame.features) ? frame.features.filter(f => typeof f === "string") : [];

        const identity = await this.store.getIdentity();
        const clientSig = new Uint8Array(
            await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.privateKey, concat(enc.encode("KeePassFerry client v1"), th))
        );
        this.state = "awaitReady";
        this.events.send({ ferry: "auth", sig: b64(clientSig) });
    }

    private async onEncrypted(frame: any) {
        if (this.state !== "awaitReady" && this.state !== "ready") throw new Error("Unexpected message");
        const n = Number(frame.n);
        if (!Number.isSafeInteger(n) || n !== this.receiveCounter + 1) throw new Error("Unexpected message counter");
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: counterNonce(n), additionalData: AAD }, this.receiveKey, unb64(frame.c)
        );
        this.receiveCounter = n;
        const text = dec.decode(plain);

        if (this.state === "awaitReady") {
            const msg = JSON.parse(text);
            if (msg?.ferry !== "ready") throw new Error("Expected ready");
            if (this.serverIsNew) await this.store.pinServerKey(this.serverId, this.serverPubB64);
            this.state = "ready";
            this.pendingCode = null;
            this.events.onReady(this.serverFeatures);
            return;
        }
        this.events.onMessage(text);
    }
}

// Speicher für den Browser: Client-ID und Server-Pins in chrome.storage.local, Schlüsselpaar in IndexedDB
// (privater Schlüssel als nicht exportierbarer CryptoKey; er verlässt die Erweiterung nie)
export class BrowserFerryChannelStore implements FerryChannelStore {
    private static readonly DB = "keepassferry";
    private static readonly STORE = "keys";

    async getClientId(): Promise<string> {
        const r = await chrome.storage.local.get("ferryClientId");
        if (r.ferryClientId) return r.ferryClientId;
        const id = crypto.randomUUID();
        await chrome.storage.local.set({ ferryClientId: id });
        return id;
    }

    async getPinnedServerKey(serverId: string): Promise<string> {
        const r = await chrome.storage.local.get("ferryServerPins");
        return r.ferryServerPins?.[serverId] ?? null;
    }

    async pinServerKey(serverId: string, publicKeyB64: string): Promise<void> {
        const r = await chrome.storage.local.get("ferryServerPins");
        const pins = r.ferryServerPins ?? {};
        pins[serverId] = publicKeyB64;
        await chrome.storage.local.set({ ferryServerPins: pins });
    }

    async getIdentity(): Promise<CryptoKeyPair> {
        const db = await this.openDb();
        const existing = await this.request<CryptoKeyPair>(db.transaction(BrowserFerryChannelStore.STORE).objectStore(BrowserFerryChannelStore.STORE).get("identity"));
        if (existing?.privateKey && existing?.publicKey) return existing;
        const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
        const tx = db.transaction(BrowserFerryChannelStore.STORE, "readwrite");
        await this.request(tx.objectStore(BrowserFerryChannelStore.STORE).put(pair, "identity"));
        return pair;
    }

    private openDb(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(BrowserFerryChannelStore.DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(BrowserFerryChannelStore.STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    private request<T>(req: IDBRequest): Promise<T> {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result as T);
            req.onerror = () => reject(req.error);
        });
    }

    // Kopplung vergessen: neue Client-ID, neues Schlüsselpaar, keine gemerkten KeePass-Schlüssel
    async reset(): Promise<void> {
        await chrome.storage.local.remove(["ferryClientId", "ferryServerPins"]);
        const db = await this.openDb();
        const tx = db.transaction(BrowserFerryChannelStore.STORE, "readwrite");
        await this.request(tx.objectStore(BrowserFerryChannelStore.STORE).delete("identity"));
    }

    async isPaired(): Promise<boolean> {
        const r = await chrome.storage.local.get("ferryServerPins");
        return Object.keys(r.ferryServerPins ?? {}).length > 0;
    }
}
