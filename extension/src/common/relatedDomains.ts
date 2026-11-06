/*
relatedDomains.ts: Zugehörige Domains großer Anbieter, die sich ein Konto teilen (z. B. ein Microsoft-Konto auf
login.live.com und login.microsoftonline.com). Ein Eintrag für eine Domain der Gruppe wird auch auf den anderen angeboten,
nachrangig und in der Trefferliste als "Zugehörige Domain" gekennzeichnet.
Bewusst kurz und nur eindeutig zusammengehörige Domains eines Anbieters: sonst würden Zugangsdaten auf einer
fremden Seite angeboten. Keine Dienste mit Kundeninhalten unter eigener Subdomain (z. B. sharepoint.com).
Quelle: nur Apples "Password Manager Resources" (shared-credentials, MIT, siteData/appleQuirks.json, wöchentlich per
scripts/update-site-data.ts abgeglichen). Gebraucht werden nur Konten, deren Anmeldeseiten auf verschiedenen Domains
liegen (gespeichert wird die URL der Formularseite); fehlt dort eine Gruppe, gehört sie per PR zu Apple.
Apples "shared" gilt in beide Richtungen, "from"/"to" nur von "from" nach "to" (z. B. Einträge von trello.com auf
id.atlassian.com, nicht umgekehrt). Über gemeinsame Domains werden die Beziehungen weitergeführt.
*/
import appleQuirks from "./siteData/appleQuirks.json";

const APPLE_GROUPS: string[][] = (appleQuirks as any).sharedCredentials ?? [];
const APPLE_ONE_WAY: { from: string[]; to: string[] }[] = (appleQuirks as any).oneWayCredentials ?? [];

// Zu jeder Domain die Domains, deren Einträge dort direkt angeboten werden dürfen
const offeredFrom = new Map<string, Set<string>>();
const link = (from: string, to: string) => {
    if (from === to) return;
    if (!offeredFrom.has(to)) offeredFrom.set(to, new Set());
    offeredFrom.get(to).add(from);
};
for (const group of APPLE_GROUPS) for (const a of group) for (const b of group) link(a, b);
for (const { from, to } of APPLE_ONE_WAY) for (const f of from) for (const t of to) link(f, t);

// Dasselbe einschließlich der Beziehungen über gemeinsame Domains
const byDomain = new Map<string, string[]>();
for (const domain of offeredFrom.keys()) {
    const found = new Set<string>([domain]);
    for (const d of found) for (const other of offeredFrom.get(d) ?? []) found.add(other);
    found.delete(domain);
    byDomain.set(domain, [...found]);
}

// Alle Domains mit den Domains, deren Einträge dort angeboten werden (für Tests)
export function allRelatedGroups(): string[][] {
    return [...byDomain].map(([domain, related]) => [domain, ...related]);
}

// Die Domains, deren Einträge auf dieser Domain angeboten werden (ohne sie selbst); leer, wenn es keine gibt
export function relatedDomains(domain: string): string[] {
    return byDomain.get((domain ?? "").toLowerCase()) ?? [];
}

// Gleiche Website im Sinne von "zuletzt gewählter Eintrag": gleiche Domain oder zugehörige Domain in einer der beiden
// Richtungen (z. B. Benutzername auf login.microsoftonline.com, Kennwort danach auf login.live.com)
export function sameSite(a: string, b: string): boolean {
    if (!a || !b) return false;
    const [x, y] = [a.toLowerCase(), b.toLowerCase()];
    return x === y || relatedDomains(x).includes(y) || relatedDomains(y).includes(x);
}

// Liegt der Hostname in einer der Domains (Domain selbst oder Subdomain davon)?
export function hostInDomains(hostname: string, domains: string[]): string {
    const host = (hostname ?? "").toLowerCase();
    return domains.find(d => host === d || host.endsWith("." + d)) ?? null;
}
