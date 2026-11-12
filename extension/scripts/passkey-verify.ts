// Prüft Passkey-Anmeldesignaturen des Plugins so, wie eine Website es tut (WebCrypto, öffentlicher Schlüssel als SPKI).
// Eingabe: JSON-Datei mit [{ spki, authData, clientDataHash, signature }] (Base64), erzeugt von tests/KeePassFerry.Tests.
// Aufruf: npx esno scripts/passkey-verify.ts <datei>; Ausgabe "OK n/n", sonst Exit-Code 1.
import fs from "fs";

const cases: { spki: string; authData: string; clientDataHash: string; signature: string }[] = JSON.parse(
    fs.readFileSync(process.argv[2], "utf8")
);
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

// WebAuthn liefert ES256-Signaturen in DER; WebCrypto erwartet r||s
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
    if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("Invalid DER sequence");
    const out = new Uint8Array(64);
    let pos = 2;
    for (let part = 0; part < 2; part++) {
        if (der[pos++] !== 0x02) throw new Error("Invalid DER integer");
        const len = der[pos++];
        let value = der.subarray(pos, pos + len);
        while (value.length > 32 && value[0] === 0) value = value.subarray(1);
        if (value.length > 32) throw new Error("Integer too long");
        out.set(value, part * 32 + 32 - value.length);
        pos += len;
    }
    if (pos !== der.length) throw new Error("Trailing bytes");
    return out;
}

let ok = 0;
for (const c of cases) {
    const key = await crypto.subtle.importKey("spki", bytes(c.spki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const authData = bytes(c.authData);
    const data = new Uint8Array(authData.length + 32);
    data.set(authData);
    data.set(bytes(c.clientDataHash), authData.length);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(bytes(c.signature)), data);
    data[0] ^= 1;
    const tamperedValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(bytes(c.signature)), data);
    if (valid && !tamperedValid) ok++;
}
console.log(`OK ${ok}/${cases.length}`);
process.exit(ok === cases.length && cases.length > 0 ? 0 : 1);
