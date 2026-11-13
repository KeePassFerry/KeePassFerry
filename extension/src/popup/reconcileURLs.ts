import { getAllFrameURLs } from "./getAllFrameURLs";
import { FerryURL } from "../common/FerryURL";

export async function reconcileURLs(oldUrls: string[], submittedUrl?: string) {
    const currentTab = !submittedUrl
        ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        : null;

    // primary url to compare against entry being edited
    const compareUrl = submittedUrl ?? currentTab.url;

    // An Exact match, regardless of the existing entry's configuration
    if (oldUrls.some(url => url === compareUrl)) {
        return { urls: oldUrls, showWarning: false };
    }

    const compareURLDomainOrIPAddress = FerryURL.fromString(compareUrl)?.domainOrIPAddress;

    if (!compareURLDomainOrIPAddress) {
        return { urls: oldUrls, showWarning: false };
    }

    // Eine Adresse des Eintrags (Hauptadresse oder zusätzliche) gehört schon zu dieser Website: Adressen unverändert
    // lassen. Früher ersetzte die Seite des abgeschickten Formulars (z. B. "Passwort ändern") die Hauptadresse; ein
    // geändertes Passwort ändert aber nicht, wo man sich anmeldet (Bitwarden ändert beim Aktualisieren nur das
    // Passwort: apps/browser/src/autofill/background/notification.background.ts)
    if (
        oldUrls.some(
            url => FerryURL.fromString(url)?.domainOrIPAddress === compareURLDomainOrIPAddress
        )
    ) {
        return { urls: oldUrls, showWarning: false };
    }

    if (!submittedUrl) {
        const allFrameUrls = await getAllFrameURLs(currentTab);
        if (
            oldUrls.some(url =>
                allFrameUrls.some(
                    fu =>
                        FerryURL.fromString(fu)?.domainOrIPAddress ===
                        FerryURL.fromString(url)?.domainOrIPAddress
                )
            )
        ) {
            return { urls: oldUrls, showWarning: false };
        }
    }

    return { urls: [compareUrl].concat(oldUrls), showWarning: true };
}
