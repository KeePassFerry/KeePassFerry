/*
otpRepeat.ts: Derselbe Einmalcode wird im selben Tab und auf derselben Domain nicht ein zweites Mal von selbst eingetragen.
Seiten, die bei vollständigem Code selbst absenden und nach "ungültig" neu laden, kämen sonst in eine Schleife
(z. B. wenn die Seite den Code wegen ihres Wiederverwendungsschutzes ablehnt). Ein Klick aufs Symbol trägt trotzdem ein.
Gemerkt wird nur ein Hash des Codes, nie der Code selbst.
*/

// Ein TOTP-Code gilt höchstens einen Zeitschritt; mit Spielraum für Seiten, die ±1 Schritt annehmen
const REPEAT_WINDOW_MS = 90 * 1000;

const lastAutoFill = new Map<number, { domain: string; codeHash: string; at: number }>();

async function hashCode(code: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("otp:" + code));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export async function isRepeatedAutoFill(tabId: number, domain: string, code: string): Promise<boolean> {
    const last = lastAutoFill.get(tabId);
    if (!last || !domain || last.domain !== domain || Date.now() - last.at > REPEAT_WINDOW_MS) return false;
    return last.codeHash === (await hashCode(code));
}

export async function rememberAutoFill(tabId: number, domain: string, code: string) {
    if (!domain || !code) return;
    lastAutoFill.set(tabId, { domain, codeHash: await hashCode(code), at: Date.now() });
}

export function forgetAutoFill(tabId: number) {
    lastAutoFill.delete(tabId);
}
