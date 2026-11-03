/*
relatedDomains.ts: Zugehörige Domains großer Anbieter, die sich ein Konto teilen (z. B. ein Microsoft-Konto auf
login.live.com und login.microsoftonline.com). Ein Eintrag für eine Domain der Gruppe wird auch auf den anderen angeboten,
nachrangig und in der Trefferliste als "Zugehörige Domain" gekennzeichnet.
Bewusst kurz und nur eindeutig zusammengehörige Domains eines Anbieters: sonst würden Zugangsdaten auf einer
fremden Seite angeboten. Keine Dienste mit Kundeninhalten unter eigener Subdomain (z. B. sharepoint.com).
Quelle: nur Apples "Password Manager Resources" (shared-credentials, MIT, siteData/appleQuirks.json, wöchentlich per
scripts/update-site-data.ts abgeglichen). Gebraucht werden nur Konten, deren Anmeldeseiten auf verschiedenen Domains
liegen (gespeichert wird die URL der Formularseite); fehlt dort eine Gruppe, gehört sie per PR zu Apple.
Gruppen mit gemeinsamen Domains werden zusammengeführt.
*/
import appleQuirks from "./siteData/appleQuirks.json";

const APPLE_GROUPS: string[][] = (appleQuirks as any).sharedCredentials ?? [];

// Gruppen mit gemeinsamer Domain zusammenführen
const byDomain = new Map<string, string[]>();
for (const group of APPLE_GROUPS) {
    const merged = new Set(group.map(d => d.toLowerCase()));
    for (const d of group) for (const other of byDomain.get(d.toLowerCase()) ?? []) merged.add(other);
    const list = [...merged];
    for (const d of list) byDomain.set(d, list);
}

// Alle Gruppen (für Tests)
export function allRelatedGroups(): string[][] {
    return [...new Set(byDomain.values())];
}

// Die anderen Domains der Gruppe dieser Domain (ohne sie selbst); leer, wenn sie zu keiner Gruppe gehört
export function relatedDomains(domain: string): string[] {
    const group = byDomain.get((domain ?? "").toLowerCase());
    return group ? group.filter(d => d !== domain.toLowerCase()) : [];
}

// Gleiche Website im Sinne von "zuletzt gewählter Eintrag": gleiche Domain oder dieselbe Anbieter-Gruppe
// (z. B. Benutzername auf login.microsoftonline.com, Kennwort danach auf login.live.com)
export function sameSite(a: string, b: string): boolean {
    if (!a || !b) return false;
    return a.toLowerCase() === b.toLowerCase() || relatedDomains(a).includes(b.toLowerCase());
}

// Liegt der Hostname in einer der Domains (Domain selbst oder Subdomain davon)?
export function hostInDomains(hostname: string, domains: string[]): string {
    const host = (hostname ?? "").toLowerCase();
    return domains.find(d => host === d || host.endsWith("." + d)) ?? null;
}
