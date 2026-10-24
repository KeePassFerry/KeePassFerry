/*
relatedDomains.ts: Zugehörige Domains großer Anbieter, die sich ein Konto teilen (z. B. Anmeldung für outlook.com
läuft über login.live.com). Ein Eintrag für eine Domain der Gruppe wird auch auf den anderen angeboten,
nachrangig und in der Trefferliste als "Zugehörige Domain" gekennzeichnet.
Bewusst kurz und nur eindeutig zusammengehörige Domains eines Anbieters: sonst würden Zugangsdaten auf einer
fremden Seite angeboten. Keine Dienste mit Kundeninhalten unter eigener Subdomain (z. B. sharepoint.com).
*/

// Abgeglichen mit den globalen Gruppen von Bitwarden (nur die Liste als Fakt, kein Code); dort fehlerhafte Einträge
// wie "net.cn" (öffentliche Endung) oder "amazon.com.be" (registrierbare Domain wäre "com.be") sind bewusst nicht
// übernommen: sonst würde ein Eintrag auf beliebigen fremden Seiten unter dieser Endung angeboten (Test prüft das).
const GROUPS: string[][] = [
    // Microsoft-Konto (privat) und Microsoft 365 (Arbeit/Schule); cloud.microsoft = neues Outlook/Microsoft 365
    [
        "microsoft.com",
        "live.com",
        "outlook.com",
        "hotmail.com",
        "msn.com",
        "passport.net",
        "windows.com",
        "microsoftonline.com",
        "office.com",
        "office365.com",
        "microsoft365.com",
        "cloud.microsoft",
        "onedrive.com",
        "microsoftstore.com",
        "xbox.com",
        "skype.com",
        "bing.com",
        "azure.com",
        "windowsazure.com"
    ],
    // Google-Konto
    ["google.com", "youtube.com", "gmail.com"],
    // Apple-ID
    ["apple.com", "icloud.com"],
    // Amazon: ein Konto für die Länder-Shops
    [
        "amazon.com", "amazon.de", "amazon.at", "amazon.co.uk", "amazon.fr", "amazon.it", "amazon.es", "amazon.nl",
        "amazon.pl", "amazon.se", "amazon.com.tr", "amazon.ae", "amazon.sa", "amazon.in", "amazon.sg",
        "amazon.com.au", "amazon.ca", "amazon.com.mx", "amazon.com.br"
    ],
    // eBay: ein Konto für die Länder-Seiten
    [
        "ebay.com", "ebay.de", "ebay.at", "ebay.ch", "ebay.co.uk", "ebay.fr", "ebay.it", "ebay.es", "ebay.nl", "ebay.be",
        "ebay.ie", "ebay.pl", "ebay.ca", "ebay.com.au", "ebay.in", "ebay.co.jp", "ebay.com.hk", "ebay.com.sg",
        "ebay.com.my", "ebay.ph", "ebay.co.th", "ebay.com.tw", "ebay.cn"
    ],
    ["paypal.com", "paypal.me"],
    ["facebook.com", "messenger.com"],
    ["proton.me", "protonmail.com", "protonvpn.com"],
    // Ubiquiti (UniFi)
    ["ui.com", "ubnt.com"],
    ["atlassian.com", "atlassian.net", "bitbucket.org", "trello.com", "jira.com", "statuspage.io"],
    ["x.com", "twitter.com"],
    ["disney.com", "disneyplus.com", "go.com", "disneymoviesanywhere.com"],
    ["stackexchange.com", "stackoverflow.com", "superuser.com", "serverfault.com", "askubuntu.com", "mathoverflow.net", "stackapps.com"],
    ["docusign.com", "docusign.net"],
    ["autodesk.com", "tinkercad.com"],
    ["alibaba.com", "aliexpress.com", "aliyun.com"],
    // Airbnb: ein Konto für die Länder-Seiten
    [
        "airbnb.com", "airbnb.de", "airbnb.at", "airbnb.ch", "airbnb.co.uk", "airbnb.fr", "airbnb.it", "airbnb.es",
        "airbnb.nl", "airbnb.be", "airbnb.dk", "airbnb.se", "airbnb.no", "airbnb.fi", "airbnb.ie", "airbnb.pt",
        "airbnb.pl", "airbnb.cz", "airbnb.hu", "airbnb.gr", "airbnb.is", "airbnb.com.tr", "airbnb.ca", "airbnb.mx",
        "airbnb.com.br", "airbnb.com.ar", "airbnb.com.au", "airbnb.co.nz", "airbnb.jp", "airbnb.co.kr", "airbnb.co.in",
        "airbnb.com.sg", "airbnb.com.hk", "airbnb.com.tw"
    ],
    [
        "yandex.com", "yandex.ru", "ya.ru", "yandex.by", "yandex.kz", "yandex.ua", "yandex.uz", "yandex.com.tr",
        "yandex.fr", "yandex.pl", "yandex.lt", "yandex.lv", "yandex.ee", "yandex.fi", "yandex.az", "yandex.com.am",
        "yandex.com.ge", "yandex.co.il", "yandex.kg", "yandex.md", "yandex.tj", "yandex.tm"
    ]
];

const byDomain = new Map<string, string[]>();
for (const group of GROUPS) for (const domain of group) byDomain.set(domain, group);

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
