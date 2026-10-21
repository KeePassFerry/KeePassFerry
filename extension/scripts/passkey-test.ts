// Test der Passkey-Funktionen des Plugins über den sicheren Kanal (ohne Browser):
// anlegen → finden → Anmeldung signieren → Signatur wie eine Website mit WebCrypto prüfen.
// Aufruf: npx esno scripts/passkey-test.ts <pipe-name> <statusdatei> <db-datei>
import net from "net";
import fs from "fs";
import { FerryChannelClient, type FerryChannelStore } from "../src/background/FerryChannel";

const [, , pipeName, stateFile, dbFile] = process.argv;

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

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64url = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));

// DER-Signatur (SEQUENCE{INTEGER r, INTEGER s}) → r||s für WebCrypto
function derToRaw(der: Uint8Array): Uint8Array {
    let o = 2;
    const read = () => {
        if (der[o] !== 0x02) throw new Error("DER: INTEGER erwartet");
        const len = der[o + 1];
        let v = der.subarray(o + 2, o + 2 + len);
        o += 2 + len;
        while (v.length > 32 && v[0] === 0) v = v.subarray(1);
        const out = new Uint8Array(32);
        out.set(v, 32 - v.length);
        return out;
    };
    const r = read();
    const s = read();
    return new Uint8Array([...r, ...s]);
}

let nextId = 1;
const pending = new Map<number, (r: any) => void>();
const socket = net.connect("\\\\.\\pipe\\" + pipeName);
let buffer = Buffer.alloc(0);
const sendFrame = (obj: any) => {
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.alloc(4);
    header.writeInt32LE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
};
let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
    console.log((ok ? "OK   " : "FAIL ") + name + (detail ? " " + detail : ""));
    if (!ok) fails++;
};

const client = new FerryChannelClient(new FileStore(), {
    send: sendFrame,
    onPairingCode: code => console.log("PRÜFCODE " + code + " (in KeePass bestätigen)"),
    onReady: () => run().catch(e => {
        console.log("FEHLER " + e);
        process.exit(1);
    }),
    onMessage: text => {
        const msg = JSON.parse(text);
        pending.get(msg.id)?.(msg.result ?? { error: msg.error });
        pending.delete(msg.id);
    },
    onDenied: () => process.exit(2),
    onSecurityError: r => {
        console.log("SICHERHEIT " + r);
        process.exit(3);
    }
});

const rpc = (method: string, params: any[]) =>
    new Promise<any>(resolve => {
        const id = nextId++;
        pending.set(id, resolve);
        client.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });

async function run() {
    const rpId = "passkey-test.example";
    const userId = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const created = await rpc("PasskeyCreate", [rpId, "Passkey-Test", userId, "pk-user", "https://" + rpId, "", dbFile, false]);
    check("Passkey angelegt", created?.status === "ok", JSON.stringify(created?.status ?? created));

    // authData aus der Attestation: rpIdHash prüfen, Flags, Credential-ID
    const authData = unb64url(created.authenticatorData);
    const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
    check("rpIdHash korrekt", Buffer.from(authData.subarray(0, 32)).equals(Buffer.from(rpIdHash)));
    check("Flags UP|UV|BE|BS|AT (0x5D)", authData[32] === 0x5d, "0x" + authData[32].toString(16));
    const credLen = (authData[53] << 8) | authData[54];
    check("Credential-ID in authData", b64url(authData.subarray(55, 55 + credLen)) === created.credentialId);
    const attObj = unb64url(created.attestationObject);
    check("Attestation beginnt mit {fmt: none}", Buffer.from(attObj.subarray(0, 10)).toString("latin1").includes("fmt") && Buffer.from(attObj).toString("latin1").includes("none"));

    const found = await rpc("PasskeyFind", [rpId, [created.credentialId]]);
    check("Passkey über allowCredentials gefunden", Array.isArray(found) && found.length === 1, String(found?.length));
    const none = await rpc("PasskeyFind", [rpId, ["AAAA"]]);
    check("Fremde Credential-ID findet nichts", Array.isArray(none) && none.length === 0);

    // Anmeldung wie eine Website: clientDataJSON hashen, signieren lassen, mit öffentlichem Schlüssel prüfen
    const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: b64url(crypto.getRandomValues(new Uint8Array(32))), origin: "https://" + rpId }));
    const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData));
    const assertion = await rpc("PasskeyGetAssertion", [found[0].uuid, found[0].dbFileName, rpId, b64url(clientDataHash)]);
    check("Assertion erstellt", assertion?.status === "ok");
    check("userHandle zurück", assertion.userHandle === userId);
    const assertAuth = unb64url(assertion.authenticatorData);
    check("Assertion-Flags UP|UV|BE|BS (0x1D)", assertAuth[32] === 0x1d, "0x" + assertAuth[32].toString(16));
    const pub = await crypto.subtle.importKey("spki", unb64url(created.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signed = new Uint8Array([...assertAuth, ...clientDataHash]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, derToRaw(unb64url(assertion.signature)), signed);
    check("Signatur mit öffentlichem Schlüssel gültig (wie Website)", valid);
    const tampered = new Uint8Array(signed);
    tampered[0] ^= 1;
    const invalid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, derToRaw(unb64url(assertion.signature)), tampered);
    check("Veränderte Daten → Signatur ungültig", !invalid);

    const wrongRp = await rpc("PasskeyGetAssertion", [found[0].uuid, found[0].dbFileName, "andere-seite.example", b64url(clientDataHash)]);
    check("Fremde RP-ID wird abgelehnt", wrongRp?.status === "notfound");

    // Passkey in einen bestehenden Login-Eintrag (mit Passwort und OTP): beides muss erhalten bleiben
    const cands = await rpc("PasskeyCandidates", ["127.0.0.1"]);
    const target = (cands ?? []).find((c: any) => c.title === "Lokale Testseite 2");
    check("Bestehender Eintrag als Kandidat (URL-Host passt)", !!target, String(cands?.length));
    const totpBefore = await rpc("GetTotp", [target.uuid, target.dbFileName]);
    const first = await rpc("PasskeyCreate", ["127.0.0.1", "Lokal", b64url(crypto.getRandomValues(new Uint8Array(8))), "lokal-zwei", "http://127.0.0.1:8765", target.uuid, target.dbFileName, false]);
    if (first?.status === "exists") {
        const again = await rpc("PasskeyCreate", ["127.0.0.1", "Lokal", b64url(crypto.getRandomValues(new Uint8Array(8))), "lokal-zwei", "http://127.0.0.1:8765", target.uuid, target.dbFileName, true]);
        check("Ersetzen mit overwrite", again?.status === "ok");
    } else {
        check("Passkey im bestehenden Eintrag", first?.status === "ok", JSON.stringify(first?.status));
        const second = await rpc("PasskeyCreate", ["127.0.0.1", "Lokal", "AQ", "lokal-zwei", "", target.uuid, target.dbFileName, false]);
        check("Zweiter Passkey ohne overwrite → exists", second?.status === "exists");
    }
    const totpAfter = await rpc("GetTotp", [target.uuid, target.dbFileName]);
    check("Einmalcode bleibt erhalten", !!totpAfter?.code && totpAfter.code === totpBefore?.code);
    const logins = await rpc("FindLogins", [["http://127.0.0.1:8765/"], null, null, "LSTnoForms", false, target.uuid, target.dbFileName, null, null]);
    const pwField = (logins?.[0]?.formFieldList ?? []).find((f: any) => f.type === "FFTpassword");
    check("Passwort bleibt erhalten", pwField?.value === "Zweites-Pw-789");

    // Signal API: Kontoname übernehmen, Passkeys entfernen
    const upd = await rpc("PasskeyUpdateUser", [found[0].uuid, found[0].dbFileName, rpId, created.credentialId, "pk-user-neu"]);
    check("Kontoname übernommen", upd === "ok", String(upd));
    const afterUpd = await rpc("PasskeyFind", [rpId, [created.credentialId]]);
    check("Neuer Kontoname im Passkey", afterUpd?.[0]?.username === "pk-user-neu" && afterUpd?.[0]?.userHandle === userId);
    check("Reiner Passkey-Eintrag erkannt", afterUpd?.[0]?.passkeyOnly === true);
    const wrongCred = await rpc("PasskeyRemove", [found[0].uuid, found[0].dbFileName, rpId, "AAAA"]);
    check("Entfernen mit falscher Credential-ID → notfound", wrongCred === "notfound");
    const rec = await rpc("PasskeyRemove", [found[0].uuid, found[0].dbFileName, rpId, created.credentialId]);
    check("Reiner Passkey-Eintrag → Papierkorb", rec === "recycled", String(rec));
    const gone = await rpc("PasskeyFind", [rpId, []]);
    check("Passkey danach nicht mehr auffindbar", Array.isArray(gone) && !gone.some((p: any) => p.credentialId === created.credentialId));

    const withPk = (await rpc("PasskeyFind", ["127.0.0.1", []])).find((p: any) => p.uuid === target.uuid);
    check("Login-Eintrag ist kein reiner Passkey-Eintrag", withPk?.passkeyOnly === false);
    const fields = await rpc("PasskeyRemove", [target.uuid, target.dbFileName, "127.0.0.1", withPk.credentialId]);
    check("Login-Eintrag → nur Passkey-Felder entfernt", fields === "fields", String(fields));
    const candAfter = (await rpc("PasskeyCandidates", ["127.0.0.1"])).find((c: any) => c.uuid === target.uuid);
    check("Eintrag bleibt, ohne Passkey", !!candAfter && candAfter.hasPasskey === false);
    const totpAfterRemove = await rpc("GetTotp", [target.uuid, target.dbFileName]);
    check("Einmalcode nach Entfernen erhalten", !!totpAfterRemove?.code);
    const logins2 = await rpc("FindLogins", [["http://127.0.0.1:8765/"], null, null, "LSTnoForms", false, target.uuid, target.dbFileName, null, null]);
    check("Passwort nach Entfernen erhalten", (logins2?.[0]?.formFieldList ?? []).some((f: any) => f.type === "FFTpassword" && f.value === "Zweites-Pw-789"));

    console.log(fails === 0 ? "ALLE OK" : fails + " FEHLER");
    process.exit(fails === 0 ? 0 : 1);
}

socket.on("connect", () => client.start("KeePassFerry (Passkey-Test)", ["KPRPC_FEATURE_VERSION_1_6", "KPRPC_FEATURE_WARN_USER_WHEN_FEATURE_MISSING"]));
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
}, 60000);
