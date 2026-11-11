import punycode from "punycode/";
import { configManager } from "./ConfigManager";

/*
displayDomain.ts: Internationale Domains (Punycode, "xn--…") lesbar anzeigen, nur wenn eingeschaltet (Issue #33).
Nur die Anzeige: Zuordnung und Ausfüllen arbeiten weiter mit der echten Adresse. Gleich aussehende Buchstaben aus
verschiedenen Schriften (z. B. kyrillisches "а" und lateinisches "a") sind in der Unicode-Form nicht zu unterscheiden;
deshalb standardmäßig aus. Bei eingeschalteter Option wird die xn--Form nirgends mehr gezeigt (Wunsch aus #33:
wer solche Domains täglich nutzt, kann mit ihr nichts prüfen). Der Schutz ist der Abgleich, nicht die Anzeige.
*/

const HOST_WITH_PUNYCODE = /(?:[a-z0-9-]+\.)*xn--[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi;

export function displayDomains(text: string): string {
    if (!text || !configManager.current?.ferryUnicodeDomains || !/xn--/i.test(text)) return text;
    return text.replace(HOST_WITH_PUNYCODE, host => {
        try {
            return punycode.toUnicode(host);
        } catch (e) {
            return host;
        }
    });
}

const MAX_PATH_LENGTH = 60;

// Adresse eines Eintrags für Tooltips: Domain immer ganz, "https://" weggelassen, Pfad gekürzt, Parameter nur angedeutet.
// Anmeldeadressen tragen oft hunderte Zeichen an Parametern, die niemandem etwas sagen.
export function displayUrl(urlStr: string): string {
    if (!urlStr) return "";
    let url: URL;
    try {
        url = new URL(urlStr);
    } catch (e) {
        const text = displayDomains(urlStr);
        return text.length > MAX_PATH_LENGTH ? text.slice(0, MAX_PATH_LENGTH) + "…" : text;
    }
    if (!url.host) return urlStr.length > MAX_PATH_LENGTH ? urlStr.slice(0, MAX_PATH_LENGTH) + "…" : urlStr;
    const scheme = url.protocol === "https:" ? "" : url.protocol + "//";
    let path = url.pathname === "/" ? "" : url.pathname;
    // Lesbare Domains: dann auch den Pfad lesbar (%D0%BF… → п…)
    if (configManager.current?.ferryUnicodeDomains) {
        try {
            path = decodeURI(path);
        } catch (e) {
            // ungültige Kodierung: Pfad unverändert zeigen
        }
    }
    if (path.length > MAX_PATH_LENGTH) path = path.slice(0, MAX_PATH_LENGTH) + "…";
    const rest = url.search ? "?…" : url.hash ? "#…" : "";
    return scheme + displayDomains(url.host) + path + rest;
}
