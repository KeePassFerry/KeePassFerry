// Testclient für den KeePassFerry-Kanal: verbindet sich direkt mit der Pipe des Plugins (ohne Browser/Host)
// und nutzt dieselbe Client-Implementierung wie die Erweiterung (src/background/FerryChannel.ts).
// Aufruf: npx esno scripts/ferry-channel-test.ts <pipe-name> [<state-datei>]
import net from "net";
import fs from "fs";
import { FerryChannelClient, type FerryChannelStore } from "../src/background/FerryChannel";

const pipeName = process.argv[2];
const stateFile = process.argv[3] ?? "ferry-test-state.json";

// Testspeicher: Schlüssel als JWK in einer Datei (nur für diesen Test; die Erweiterung nutzt IndexedDB)
class FileStore implements FerryChannelStore {
    private state: any = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
    private save() {
        fs.writeFileSync(stateFile, JSON.stringify(this.state, null, 1));
    }
    async getClientId() {
        if (!this.state.clientId) {
            this.state.clientId = crypto.randomUUID();
            this.save();
        }
        return this.state.clientId;
    }
    async getIdentity(): Promise<CryptoKeyPair> {
        if (!this.state.identity) {
            const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
            this.state.identity = {
                priv: await crypto.subtle.exportKey("jwk", pair.privateKey),
                pub: await crypto.subtle.exportKey("jwk", pair.publicKey)
            };
            this.save();
        }
        return {
            privateKey: await crypto.subtle.importKey("jwk", this.state.identity.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
            publicKey: await crypto.subtle.importKey("jwk", this.state.identity.pub, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])
        };
    }
    async getPinnedServerKey(serverId: string) {
        return this.state.pins?.[serverId] ?? null;
    }
    async pinServerKey(serverId: string, key: string) {
        this.state.pins = { ...(this.state.pins ?? {}), [serverId]: key };
        this.save();
    }
}

const socket = net.connect("\\\\.\\pipe\\" + pipeName);
let buffer = Buffer.alloc(0);
const sendFrame = (obj: any) => {
    // Gegenprobe: TAMPER=1 verändert ein Byte der ersten verschlüsselten Nachricht
    if (process.env.TAMPER === "1" && obj.ferry === "m") {
        const raw = Buffer.from(obj.c, "base64");
        raw[0] ^= 1;
        obj = { ...obj, c: raw.toString("base64") };
    }
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.alloc(4);
    header.writeInt32LE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
};

const client = new FerryChannelClient(new FileStore(), {
    send: sendFrame,
    onPairingCode: code => console.log("PRÜFCODE " + code),
    onReady: async features => {
        console.log("BEREIT, Server-Features: " + features.length);
        await client.send(JSON.stringify({ jsonrpc: "2.0", method: process.env.RPC_METHOD ?? "GetAllDatabases", params: process.env.RPC_METHOD ? JSON.parse(process.env.RPC_PARAMS ?? "[]") : [false], id: 7 }));
    },
    onMessage: text => {
        const msg = JSON.parse(text);
        if (msg.id === 7 && process.env.RPC_METHOD) {
            console.log("ANTWORT " + process.env.RPC_METHOD + ": " + JSON.stringify(msg.result ?? msg.error).slice(0, 400));
            process.exit(0);
        }
        if (msg.id === 7) {
            const dbs = msg.result ?? [];
            console.log("ANTWORT GetAllDatabases: " + dbs.length + " Datenbank(en), Name: " + (dbs[0]?.name ?? "-"));
            socket.end();
            process.exit(0);
        }
    },
    onDenied: () => {
        console.log("ABGELEHNT");
        process.exit(2);
    },
    onSecurityError: reason => {
        console.log("SICHERHEITSFEHLER " + reason);
        process.exit(3);
    }
});

socket.on("connect", () => client.start("KeePassFerry (Test)", ["KPRPC_FEATURE_VERSION_1_6", "KPRPC_FEATURE_WARN_USER_WHEN_FEATURE_MISSING"]));
socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
        const len = buffer.readInt32LE(0);
        if (buffer.length < 4 + len) break;
        const body = buffer.subarray(4, 4 + len).toString("utf8");
        buffer = buffer.subarray(4 + len);
        client.handle(JSON.parse(body));
    }
});
socket.on("error", e => {
    console.log("PIPE-FEHLER " + e.message);
    process.exit(4);
});
setTimeout(() => {
    console.log("ZEITÜBERSCHREITUNG");
    process.exit(5);
}, Number(process.env.TIMEOUT_MS ?? 90000));
