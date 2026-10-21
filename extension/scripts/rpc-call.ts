// Einzelner JSON-RPC-Aufruf an das Plugin über den sicheren Kanal (Testhilfe)
// Aufruf: npx esno scripts/rpc-call.ts <pipe-name> <statusdatei> <Methode> '<Parameter als JSON-Array>'
import net from "net";
import fs from "fs";
import { FerryChannelClient, type FerryChannelStore } from "../src/background/FerryChannel";

const [, , pipeName, stateFile, method, paramsJson] = process.argv;

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
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.alloc(4);
    header.writeInt32LE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
};

const client = new FerryChannelClient(new FileStore(), {
    send: sendFrame,
    onPairingCode: code => console.log("PRÜFCODE " + code),
    onReady: () => client.send(JSON.stringify({ jsonrpc: "2.0", method, params: JSON.parse(paramsJson ?? "[]"), id: 1 })),
    onMessage: text => {
        const msg = JSON.parse(text);
        if (msg.id !== 1) return;
        console.log(JSON.stringify(msg.result ?? msg.error));
        process.exit(0);
    },
    onDenied: () => process.exit(2),
    onSecurityError: r => {
        console.log("SICHERHEIT " + r);
        process.exit(3);
    }
});

socket.on("connect", () => client.start("KeePassFerry (RPC-Test)", ["KPRPC_FEATURE_VERSION_1_6", "KPRPC_FEATURE_WARN_USER_WHEN_FEATURE_MISSING"]));
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
setTimeout(() => {
    console.log("ZEITÜBERSCHREITUNG");
    process.exit(5);
}, 30000);
