import punycode from "punycode/";
import { configManager } from "./ConfigManager";

/*
displayDomain.ts: Internationale Domains (Punycode, "xn--…") lesbar anzeigen, nur wenn eingeschaltet (Issue #33).
Nur die Anzeige: Zuordnung und Ausfüllen arbeiten weiter mit der echten Adresse. Gleich aussehende Buchstaben aus
verschiedenen Schriften (z. B. kyrillisches "а" und lateinisches "a") machen die Unicode-Form angreifbar; deshalb
standardmäßig aus und die echte Form immer im Tooltip (punycodeHint).
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

// Echte Schreibweise für den Tooltip, wenn die Anzeige sie verändert hat; sonst leer
export function punycodeHint(text: string): string {
    return text && displayDomains(text) !== text ? text : "";
}
