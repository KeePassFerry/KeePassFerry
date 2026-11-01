/*
totp.ts: Einmalcodes nach RFC 6238 (TOTP) aus einer otpauth-URI berechnen, ohne Abhängigkeiten.
Dient nur dem Vergleich mit dem vom Plugin gelieferten Code; das Secret verlässt die Erweiterung nicht.
*/

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpParams {
    key: Uint8Array;
    period: number;
    digits: number;
    algorithm: TotpAlgorithm;
}

// Base32 (RFC 4648) ohne Füllzeichen, Leerzeichen und Groß-/Kleinschreibung egal; null bei ungültigen Zeichen
export function base32Decode(text: string): Uint8Array {
    const clean = (text ?? "").replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const out: number[] = [];
    let bits = 0, value = 0;
    for (const ch of clean) {
        const index = alphabet.indexOf(ch);
        if (index < 0) return null;
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}

// Secret und Parameter aus einer otpauth-TOTP-URI; Standard 30 s, 6 Stellen, SHA1
export function parseTotpParams(uri: string): TotpParams {
    if (!/^otpauth:\/\/totp\//i.test(uri ?? "")) return null;
    try {
        const u = new URL(uri);
        const key = base32Decode(u.searchParams.get("secret") ?? "");
        if (!key?.length) return null;
        const period = parseInt(u.searchParams.get("period") ?? "30", 10);
        const digits = parseInt(u.searchParams.get("digits") ?? "6", 10);
        const algorithms: Record<string, TotpAlgorithm> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
        const algorithm = algorithms[(u.searchParams.get("algorithm") ?? "SHA1").toUpperCase().replace(/-/g, "")];
        if (!algorithm || !(period > 0) || !(digits >= 6 && digits <= 10)) return null;
        return { key, period, digits, algorithm };
    } catch (e) {
        return null;
    }
}

// HOTP-Wert (RFC 4226) für einen Zähler, mit führenden Nullen
export async function hotp(key: Uint8Array, counter: number, digits: number, algorithm: TotpAlgorithm): Promise<string> {
    const message = new Uint8Array(8);
    let rest = counter;
    for (let i = 7; i >= 0; i--) {
        message[i] = rest % 256;
        rest = Math.floor(rest / 256);
    }
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: algorithm }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, message));
    const offset = mac[mac.length - 1] & 0x0f;
    const binary =
        ((mac[offset] & 0x7f) * 2 ** 24) + (mac[offset + 1] << 16) + (mac[offset + 2] << 8) + mac[offset + 3];
    return (binary % 10 ** digits).toString().padStart(digits, "0");
}

// TOTP-Code zum Zeitpunkt nowMs (Millisekunden seit 1970)
export function totpAt(params: TotpParams, nowMs: number): Promise<string> {
    return hotp(params.key, Math.floor(nowMs / 1000 / params.period), params.digits, params.algorithm);
}

// Gehört der Code zum Schlüssel der URI? Nahe am Wechsel des Zeitschritts (≤ 2 s) zählen auch der nächste
// bzw. vorige Schritt, da Plugin-Code und lokale Rechnung nicht im selben Augenblick entstehen
export async function totpMatches(uri: string, code: string, nowMs: number): Promise<boolean> {
    const params = parseTotpParams(uri);
    const wanted = (code ?? "").replace(/\s/g, "");
    if (!params || !wanted) return false;
    const seconds = nowMs / 1000;
    const step = Math.floor(seconds / params.period);
    const elapsed = seconds - step * params.period;
    const steps = [step];
    if (params.period - elapsed <= 2) steps.push(step + 1);
    if (elapsed <= 2) steps.push(step - 1);
    for (const s of steps) {
        if ((await hotp(params.key, s, params.digits, params.algorithm)) === wanted) return true;
    }
    return false;
}
