/*
expiry.ts: Ablaufdatum eines Eintrags (KeePass "Gültig bis") für die Option "Ablaufdaten prüfen".
- expiryState: abgelaufen bzw. läuft innerhalb der Vorwarnzeit ab (Tage bis zum Ablauf)
- Auswahl "Gültig bis" beim Speichern: Zeiträume wie die Vorgaben in KeePass (1 Woche … 1 Jahr) oder kein Ablauf
- newExpiryTime: was an das Plugin geht (undefined = unverändert, "never" = kein Ablauf, sonst ISO-Zeitpunkt)
*/

export type ExpiryPreset = "w1" | "w2" | "m1" | "m3" | "m6" | "y1";
export type ExpiryChoice = "keep" | "never" | ExpiryPreset;

export const EXPIRY_PRESETS: ExpiryPreset[] = ["w1", "w2", "m1", "m3", "m6", "y1"];

const PRESET_DAYS: Record<ExpiryPreset, number> = { w1: 7, w2: 14, m1: 30, m3: 91, m6: 182, y1: 365 };

const DAY_MS = 24 * 60 * 60 * 1000;

// Neues Ablaufdatum ab "from" (Monate und Jahr kalendarisch wie KeePass)
export function addPreset(from: Date, preset: ExpiryPreset): Date {
    const d = new Date(from.getTime());
    switch (preset) {
        case "w1":
            d.setDate(d.getDate() + 7);
            break;
        case "w2":
            d.setDate(d.getDate() + 14);
            break;
        case "m1":
            d.setMonth(d.getMonth() + 1);
            break;
        case "m3":
            d.setMonth(d.getMonth() + 3);
            break;
        case "m6":
            d.setMonth(d.getMonth() + 6);
            break;
        case "y1":
            d.setFullYear(d.getFullYear() + 1);
            break;
    }
    return d;
}

// Vorgabe, die dem bisherigen Zeitraum am nächsten liegt (unbekannt: 3 Monate)
export function nearestPreset(intervalDays: number): ExpiryPreset {
    if (!intervalDays || intervalDays <= 0) return "m3";
    let best: ExpiryPreset = "m3";
    for (const p of EXPIRY_PRESETS) {
        if (Math.abs(PRESET_DAYS[p] - intervalDays) < Math.abs(PRESET_DAYS[best] - intervalDays)) best = p;
    }
    return best;
}

export type ExpiryState = { kind: "expired" | "soon"; daysLeft: number; date: Date } | null;

// null: kein Ablaufdatum oder noch außerhalb der Vorwarnzeit
export function expiryState(expiryTime: string, warnDays: number, now = Date.now()): ExpiryState {
    if (!expiryTime) return null;
    const t = Date.parse(expiryTime);
    if (isNaN(t)) return null;
    const date = new Date(t);
    if (t <= now) return { kind: "expired", daysLeft: 0, date };
    const daysLeft = Math.ceil((t - now) / DAY_MS);
    return daysLeft <= Math.max(0, warnDays ?? 0) ? { kind: "soon", daysLeft, date } : null;
}

// Vorauswahl im Speichern-Dialog: neuer Eintrag "kein Ablauf"; vorhandener mit gültigem oder ohne Ablaufdatum
// "unverändert"; abgelaufener der bisherige Zeitraum
export function defaultExpiryChoice(
    existing: boolean,
    expiryTime: string,
    intervalDays: number,
    now = Date.now()
): ExpiryChoice {
    if (!existing) return "never";
    const t = expiryTime ? Date.parse(expiryTime) : NaN;
    if (isNaN(t) || t > now) return "keep";
    return nearestPreset(intervalDays);
}

export function formatExpiryDate(d: Date): string {
    return d.toLocaleDateString(chrome.i18n.getUILanguage(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Überschrift für "läuft bald ab" (Hinweis auf der Seite und im Popup)
export function expirySoonTitle(daysLeft: number): string {
    if (daysLeft <= 0) return $STR("ferry_expiry_soon_today");
    if (daysLeft === 1) return $STR("ferry_expiry_soon_tomorrow");
    return $STRF("ferry_expiry_soon_days", [String(daysLeft)]);
}

// Wert für das Plugin; undefined = Ablaufdatum nicht anfassen
export function newExpiryTime(choice: ExpiryChoice, hadExpiry: boolean, now = new Date()): string {
    if (!choice || choice === "keep") return undefined;
    if (choice === "never") return hadExpiry ? "never" : undefined;
    return addPreset(now, choice).toISOString().replace(/\.\d{3}Z$/, "Z");
}
