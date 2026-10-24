/*
relatedDomains.ts: Zugehörige Domains großer Anbieter, die sich ein Konto teilen (z. B. Anmeldung für outlook.com
läuft über login.live.com). Ein Eintrag für eine Domain der Gruppe wird auch auf den anderen angeboten,
nachrangig und in der Trefferliste als "Zugehörige Domain" gekennzeichnet.
Bewusst kurz und nur eindeutig zusammengehörige Domains eines Anbieters: sonst würden Zugangsdaten auf einer
fremden Seite angeboten. Keine Dienste mit Kundeninhalten unter eigener Subdomain (z. B. sharepoint.com).
*/

const GROUPS: string[][] = [
    // Microsoft-Konto (privat) und Microsoft 365 (Arbeit/Schule)
    [
        "microsoft.com",
        "live.com",
        "outlook.com",
        "hotmail.com",
        "msn.com",
        "microsoftonline.com",
        "office.com",
        "microsoft365.com",
        "onedrive.com",
        "xbox.com",
        "skype.com",
        "bing.com"
    ],
    // Google-Konto
    ["google.com", "youtube.com", "gmail.com"],
    // Amazon: ein Konto für die Länder-Shops
    ["amazon.com", "amazon.de", "amazon.co.uk", "amazon.fr", "amazon.it", "amazon.es", "amazon.nl", "amazon.ca", "amazon.com.au"],
    // Apple-ID
    ["apple.com", "icloud.com"],
    // eBay: ein Konto für die Länder-Seiten
    ["ebay.com", "ebay.de", "ebay.at", "ebay.ch", "ebay.co.uk"]
];

const byDomain = new Map<string, string[]>();
for (const group of GROUPS) for (const domain of group) byDomain.set(domain, group);

// Die anderen Domains der Gruppe dieser Domain (ohne sie selbst); leer, wenn sie zu keiner Gruppe gehört
export function relatedDomains(domain: string): string[] {
    const group = byDomain.get((domain ?? "").toLowerCase());
    return group ? group.filter(d => d !== domain.toLowerCase()) : [];
}

// Liegt der Hostname in einer der Domains (Domain selbst oder Subdomain davon)?
export function hostInDomains(hostname: string, domains: string[]): string {
    const host = (hostname ?? "").toLowerCase();
    return domains.find(d => host === d || host.endsWith("." + d)) ?? null;
}
