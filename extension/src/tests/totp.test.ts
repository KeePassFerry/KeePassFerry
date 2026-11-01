import { describe, expect, it } from "vitest";
import { base32Decode, parseTotpParams, totpAt, totpMatches } from "../common/totp";

// Base32-Kodierung nur für die Testdaten
function base32Encode(bytes: Uint8Array): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let out = "", bits = 0, value = 0;
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
    return out;
}

const ascii = (s: string) => new TextEncoder().encode(s);
const seeds = {
    SHA1: ascii("12345678901234567890"),
    SHA256: ascii("12345678901234567890123456789012"),
    SHA512: ascii("1234567890123456789012345678901234567890123456789012345678901234")
};
const uriFor = (algorithm: keyof typeof seeds, extra = "&digits=8") =>
    `otpauth://totp/Test:konto?secret=${base32Encode(seeds[algorithm])}&algorithm=${algorithm}${extra}`;

// RFC 6238, Anhang B
const vectors: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"]
];

describe("totpAt", () => {
    it.each(vectors)("RFC-6238-Testvektor bei %i s", async (time, sha1, sha256, sha512) => {
        expect(await totpAt(parseTotpParams(uriFor("SHA1")), time * 1000)).toBe(sha1);
        expect(await totpAt(parseTotpParams(uriFor("SHA256")), time * 1000)).toBe(sha256);
        expect(await totpAt(parseTotpParams(uriFor("SHA512")), time * 1000)).toBe(sha512);
    });
});

describe("parseTotpParams", () => {
    it("nimmt ohne Angaben 30 s, 6 Stellen und SHA1", () => {
        const p = parseTotpParams("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        expect(p).toMatchObject({ period: 30, digits: 6, algorithm: "SHA-1" });
        expect(Array.from(p.key)).toEqual(Array.from(seeds.SHA1));
    });

    it("liest Periode, Stellen und Algorithmus", () => {
        expect(parseTotpParams(uriFor("SHA256", "&digits=8&period=60"))).toMatchObject({
            period: 60,
            digits: 8,
            algorithm: "SHA-256"
        });
    });

    it("lehnt ungültige URIs ab", () => {
        expect(parseTotpParams("otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ")).toBeNull();
        expect(parseTotpParams("otpauth://totp/x?secret=1111")).toBeNull();
        expect(parseTotpParams("otpauth://totp/x")).toBeNull();
        expect(parseTotpParams("otpauth://totp/x?secret=GEZDGNBV&algorithm=MD5")).toBeNull();
    });

    it("dekodiert Base32 mit Kleinbuchstaben, Leerzeichen und Füllzeichen", () => {
        expect(Array.from(base32Decode("mzxw 6==="))).toEqual(Array.from(ascii("foo")));
        expect(base32Decode("ABC1")).toBeNull();
    });
});

describe("totpMatches", () => {
    const uri = uriFor("SHA1", "");
    const params = parseTotpParams(uri);

    it("erkennt den aktuellen Code und lehnt einen fremden ab", async () => {
        const now = 1111111111 * 1000;
        const code = await totpAt(params, now);
        expect(await totpMatches(uri, code, now)).toBe(true);
        expect(await totpMatches(uri, code === "000000" ? "111111" : "000000", now)).toBe(false);
        expect(await totpMatches(uri, "", now)).toBe(false);
    });

    it("lässt kurz vor dem Wechsel auch den nächsten Code gelten", async () => {
        const nextStepStart = 37037037 * 30 * 1000;
        const next = await totpAt(params, nextStepStart);
        expect(await totpMatches(uri, next, nextStepStart - 1500)).toBe(true);
        expect(await totpMatches(uri, next, nextStepStart - 10000)).toBe(false);
    });

    it("lässt kurz nach dem Wechsel auch den vorigen Code gelten", async () => {
        const stepStart = 37037037 * 30 * 1000;
        const previous = await totpAt(params, stepStart - 1000);
        expect(await totpMatches(uri, previous, stepStart + 1500)).toBe(true);
        expect(await totpMatches(uri, previous, stepStart + 10000)).toBe(false);
    });

    it("vergleicht nicht mit einem anderen Schlüssel", async () => {
        const now = 1234567890 * 1000;
        const other = uriFor("SHA256", "");
        expect(await totpMatches(other, await totpAt(params, now), now)).toBe(false);
    });
});
