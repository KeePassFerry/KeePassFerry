/*
changePassword.ts: Adresse, unter der man das Passwort einer Website ändert.
1. Apples Liste (Password Manager Resources, siehe siteData/appleQuirks.json)
2. Standard "/.well-known/change-password" (W3C), nur wenn die Website ihn wirklich unterstützt: Gegenprobe mit einer
   Adresse, die es nicht geben darf (wie Chrome), damit Seiten, die alles mit 200 beantworten, nicht zählen.
   Abgefragt wird nur die Website selbst, ohne Cookies; nichts geht an Dritte.
3. Sonst nichts (der Aufrufer öffnet dann die Website des Eintrags)
*/
import appleQuirks from "../common/siteData/appleQuirks.json";

const CHECK_TIMEOUT_MS = 5000;
const cache = new Map<string, Promise<string>>();

export function appleChangePasswordUrl(hostname: string): string {
    const table = (appleQuirks as any).changePasswordUrls as Record<string, string>;
    const labels = (hostname ?? "").toLowerCase().replace(/\.$/, "").split(".");
    for (let i = 0; i < labels.length - 1; i++) {
        const url = table[labels.slice(i).join(".")];
        if (url) return url;
    }
    return null;
}

async function status(url: string): Promise<{ ok: boolean; finalUrl: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
        const res = await fetch(url, { credentials: "omit", redirect: "follow", cache: "no-store", signal: controller.signal });
        return { ok: res.ok, finalUrl: res.url || url };
    } catch {
        return { ok: false, finalUrl: url };
    } finally {
        clearTimeout(timer);
    }
}

async function wellKnownChangePasswordUrl(origin: string): Promise<string> {
    const probe = await status(origin + "/.well-known/resource-that-should-not-exist-whose-status-code-should-not-be-200");
    if (probe.ok) return null;
    const res = await status(origin + "/.well-known/change-password");
    if (!res.ok) return null;
    // Nur Weiterleitungen auf dieselbe Website (gleiche oder Sub-/Oberdomain) und https
    try {
        const target = new URL(res.finalUrl);
        const host = new URL(origin).hostname;
        const sameSite = (a: string, b: string) => a === b || a.endsWith("." + b) || b.endsWith("." + a);
        if (target.protocol !== "https:" || !sameSite(target.hostname, host)) return null;
        return target.href;
    } catch {
        return null;
    }
}

// Adresse zum Passwortändern für die Adresse eines Eintrags oder null
export function changePasswordUrl(entryUrl: string): Promise<string> {
    let url: URL;
    try {
        url = new URL(entryUrl);
    } catch {
        return Promise.resolve(null);
    }
    if (url.protocol !== "https:") return Promise.resolve(null);
    const apple = appleChangePasswordUrl(url.hostname);
    if (apple) return Promise.resolve(apple);
    const key = url.origin;
    if (!cache.has(key)) {
        const p = wellKnownChangePasswordUrl(url.origin);
        cache.set(key, p);
        // Fehlschläge nicht dauerhaft merken (z. B. offline)
        p.then(r => r === null && setTimeout(() => cache.delete(key), 10 * 60 * 1000));
    }
    return cache.get(key);
}
