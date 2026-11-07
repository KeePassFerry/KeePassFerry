// Kleinste Plugin-Version, mit der diese Erweiterung vollständig zusammenarbeitet. Bei Änderungen am Plugin, die die
// Erweiterung voraussetzt, hier erhöhen: ältere Plugins bekommen dann den Hinweis "bitte aktualisieren".
export const MIN_PLUGIN_VERSION = "1.0.7";

// Version aus der Fähigkeitsliste des Plugins ("KEEPASSFERRY_VERSION_1.2.3"); null bei Plugins vor 1.0.4
export function pluginVersionFrom(features: string[]): string {
    const flag = (features ?? []).find(f => f.startsWith("KEEPASSFERRY_VERSION_"));
    return flag ? flag.substring("KEEPASSFERRY_VERSION_".length) : null;
}

// Ab dieser Plugin-Version blockiert "Jetzt aktualisieren" den Kanal nicht mehr (Update läuft in KeePass);
// ältere Plugins bekommen stattdessen die Release-Seite zum Herunterladen des Setups
export const BROWSER_UPDATE_PLUGIN_VERSION = "1.0.8";

// Plugin kann den Schutz eigener Felder umschalten
export const FIELD_PROTECTION_FEATURE = "KEEPASSFERRY_FIELD_PROTECTION";

// Plugin kann einen Eintrag in den Papierkorb verschieben
export const ENTRY_RECYCLE_FEATURE = "KEEPASSFERRY_ENTRY_RECYCLE";
// Passwortprüfung bei Have I Been Pwned und Tipps (GetHibpCheck/SetHibpCheck/GetFerryTips)
export const HIBP_CHECK_FEATURE = "KEEPASSFERRY_HIBP_CHECK";
// Liste geleakter Einträge für den Hinweis im Popup (GetHibpLeaks)
export const HIBP_LEAKS_FEATURE = "KEEPASSFERRY_HIBP_LEAKS";
// Einstellungen zu KeePass im KeePassFerry-Optionsdialog (OpenOptions), Vorwarnung von dort (GetExpiryWarnDays)
export const OPTIONS_DIALOG_FEATURE = "KEEPASSFERRY_OPTIONS_DIALOG";
// Ablaufdatum der Einträge (expiryTime) und neues Ablaufdatum beim Speichern (newExpiryTime)
export const EXPIRY_FEATURE = "KEEPASSFERRY_EXPIRY";

// true, wenn das Plugin mindestens diese Version meldet
export function pluginVersionAtLeast(features: string[], min: string): boolean {
    const v = pluginVersionFrom(features);
    if (!v) return false;
    const a = v.split(".").map(n => parseInt(n, 10) || 0);
    const b = min.split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    }
    return true;
}

// true, wenn das Plugin älter als MIN_PLUGIN_VERSION ist (oder seine Version nicht meldet)
export function pluginIsOutdated(features: string[]): boolean {
    return !pluginVersionAtLeast(features, MIN_PLUGIN_VERSION);
}

// Plugin-Version mit den neuesten Funktionen für diese Erweiterung. Nur erhöhen, wenn sich das Plugin im Release
// geändert hat (nicht bei Releases, die nur die Erweiterung betreffen): ältere Plugins bekommen dann den Hinweis
// "Neue Version für KeePass verfügbar" mit "Jetzt aktualisieren". Ohne Abfrage im Netz.
export const RECOMMENDED_PLUGIN_VERSION = "1.0.25";

// Name des Hinweises "Plugin älter als die Erweiterung" im Popup
export const PLUGIN_UPDATE_NOTICE = "keepassferry-plugin-update";

// true, wenn das Plugin älter als RECOMMENDED_PLUGIN_VERSION ist (oder seine Version nicht meldet)
export function pluginUpdateAvailable(features: string[]): boolean {
    return !pluginVersionAtLeast(features, RECOMMENDED_PLUGIN_VERSION);
}

export class FeatureFlags {
    public static readonly offered: string[] = [
        // Grundumfang des Protokolls
        "KEEPASSFERRY_BASE"
    ];

    public static readonly required: string[] = [
        // Grundumfang des Protokolls
        "KEEPASSFERRY_BASE"
    ];
}
