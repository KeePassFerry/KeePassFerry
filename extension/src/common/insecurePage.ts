// Seite über http, Eintrag aber nur für https gespeichert: dann nicht automatisch ausfüllen oder absenden
// (die Abgleichung im Plugin vergleicht nur Host und Port, nicht das Schema)
export function httpsEntryOnHttpPage(pageUrl: string, entryUrls: readonly string[]): boolean {
    if (!/^http:/i.test(pageUrl ?? "")) return false;
    const urls = (entryUrls ?? []).filter(u => !!u);
    return urls.length > 0 && urls.every(u => /^https:/i.test(u.trim()));
}
