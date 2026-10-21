/*
codeChannel.ts: Woher kommt der Code laut Seitentext? "app" = Authenticator-App (TOTP aus KeePass),
"other" = SMS, Telefon, E-Mail oder WhatsApp (z. B. nutzt Amazon dasselbe Feld für beides), "unknown" = kein Hinweis.
Die App-Erwähnung hat Vorrang: SMS-Seiten nennen selten eine App, App-Seiten bieten aber oft "Code per SMS senden" an.
*/

const APP_CHANNEL =
    /(authenticator|authentifizierungs[-\s]?app|auth[-\s]?app|\btotp\b|code (aus|in) (der|ihrer|deiner) app|code from (your|the|an) (authenticator )?app|app[-\s]?code)/i;
const OTHER_CHANNEL =
    /(\bsms\b|textnachricht|text message|telefonnummer|handynummer|mobilnummer|rufnummer|phone number|whatsapp|per e-?mail|an (ihre|deine) e-?mail|sent (a code )?to (your )?(phone|mobile|e-?mail|number)|an (eine|ihre|deine|die) (telefon|handy|mobil)|gesendet an)/i;

export type CodeChannel = "app" | "other" | "unknown";

export function codeChannelOf(text: string): CodeChannel {
    return APP_CHANNEL.test(text) ? "app" : OTHER_CHANNEL.test(text) ? "other" : "unknown";
}

let cache: { at: number; value: CodeChannel } = null;
export function pageCodeChannel(): CodeChannel {
    if (cache && Date.now() - cache.at < 1500) return cache.value;
    const value = codeChannelOf((document.body?.innerText ?? "").slice(0, 50000));
    cache = { at: Date.now(), value };
    return value;
}

export function resetCache() {
    cache = null;
}
