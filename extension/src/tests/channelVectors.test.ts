import { describe, expect, it } from "vitest";
import { pairingCodeFromHash } from "../background/FerryChannel";

// Dieselben Vektoren wie im Plugin-Test (tests/KeePassFerry.Tests/FerryCryptoTests.cs, ChannelVectors_…):
// Browser (WebCrypto) und Plugin (Windows CNG) müssen zu identischen Schlüsseln, Chiffraten und Prüfcodes kommen.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("hex");

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array<ArrayBuffer>> {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        all.set(p, offset);
        offset += p.length;
    }
    return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

const sasNonce = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));

describe("channel vectors shared with the plugin", () => {
    it("derives the same keys and first message as the plugin", async () => {
        const th = await sha256(enc.encode("KeePassFerry test transcript"));
        expect(hex(th)).toBe("1d7e5f699c9de44a204af57b685d184b1dc7ca000b2e812e79f3d571232b294f");
        const zHash = await sha256(enc.encode("KeePassFerry test shared secret"));
        const hkdfKey = await crypto.subtle.importKey("raw", zHash, "HKDF", false, ["deriveBits"]);
        const okm = new Uint8Array(
            await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: th, info: enc.encode("KeePassFerry keys v1") }, hkdfKey, 512)
        );
        expect(hex(okm)).toBe(
            "d79bd7c04075e7e462cff4e54feb071e740f7753d83c9d865ae999687aa77eb5df8549054f0fd8280bb3ef9c9bc99b2bfbd41d56af713eaea7ca2bb47720370e"
        );

        const nonce = new Uint8Array(12);
        nonce[11] = 1;
        const key = await crypto.subtle.importKey("raw", okm.slice(0, 32), "AES-GCM", false, ["encrypt"]);
        const c = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce, additionalData: enc.encode("KeePassFerry v1") },
            key,
            enc.encode('{"ferry":"ready"}')
        );
        expect(hex(c)).toBe("dc0a5fdb2169488008d4c7468d6039c641" + "d4c3c659b15b2f5adbd8e78cdc33ad9c");
    });

    it("computes the same pairing codes as the plugin", async () => {
        const th = await sha256(enc.encode("KeePassFerry test transcript"));
        expect(pairingCodeFromHash(await sha256(enc.encode("KeePassFerry SAS v1"), th))).toBe("247676");
        expect(pairingCodeFromHash(await sha256(enc.encode("KeePassFerry SAS v2"), th, sasNonce))).toBe("289347");
        expect(hex(await sha256(enc.encode("KeePassFerry SAS commit v2"), sasNonce))).toBe(
            "1dcc57d5001a3a480113186dada105cb690ff5d35d49f52125f45af333caaadf"
        );
    });

    it("pads pairing codes to six digits", () => {
        const h = new Uint8Array(32);
        h[3] = 7;
        expect(pairingCodeFromHash(h)).toBe("000007");
        h.fill(0xff, 0, 4);
        expect(pairingCodeFromHash(h)).toBe(String(0xffffffff % 1000000).padStart(6, "0"));
    });
});
