import { configManager } from "../common/ConfigManager";

// Tipps für "Neuigkeiten und Tipps": nur für das, was bei diesem Nutzer noch fehlt (Merkmale vom Plugin,
// Browser-Einstellungen). Gemeinsam für die Ansicht (NewsView) und die Fußleiste (✨ pulsiert bei offenen Tipps).

export const DISMISSED_TIPS_KEY = "ferryDismissedTips";

export interface Tip {
    id: string;
    icon: string;
    tone: string;
    action?: string;
    primary?: boolean;
    run?: () => void;
    // Platzhalter im Text ($1 …)
    args?: string[];
    // Texte unter einem anderen Schlüssel als die id (id ändert sich mit dem Inhalt, z. B. je Datenbank)
    textKey?: string;
}

// Früher landete hier die reaktive Vue-Liste (Proxy); chrome.storage speicherte sie als Objekt {"0": "…"}, und
// "includes" fehlte beim Lesen (Neuigkeiten-Ansicht brach ab, ✨ pulsierte nie). Beide Formen werden gelesen.
export async function loadDismissedTips(): Promise<string[]> {
    try {
        const stored = (await chrome.storage.local.get(DISMISSED_TIPS_KEY))?.[DISMISSED_TIPS_KEY];
        const list = Array.isArray(stored) ? stored : stored && typeof stored === "object" ? Object.values(stored) : [];
        return list.filter((id): id is string => typeof id === "string");
    } catch (e) {
        return [];
    }
}

// Immer als einfache Liste speichern (keine Vue-Proxys)
export async function saveDismissedTips(ids: string[]) {
    await chrome.storage.local.set({ [DISMISSED_TIPS_KEY]: Array.from(ids ?? [], String) }).catch(() => undefined);
}

// reload: nach einer Aktion, die einen Tipp erledigt (z. B. Diagnoseprotokoll aus), die Liste neu laden
export async function loadTips(reload: () => void = () => undefined): Promise<{ tips: Tip[]; connected: boolean }> {
    const tips: Tip[] = [];
    let status: any = null;
    let info: { winHello: boolean; anyOtp: boolean; anyPasskey?: boolean; hibpCheck: boolean; hibpUndecided?: string[] } = null;
    try {
        status = await chrome.runtime.sendMessage({ keepassferry: "connectionStatus" });
        if (status?.hibpCheck) info = await chrome.runtime.sendMessage({ keepassferry: "getFerryTips" });
    } catch (e) {
        // Hintergrund startet gerade neu
    }
    let browserSaving = false;
    try {
        browserSaving = !!((await chrome.privacy.services.passwordSavingEnabled.get({})) as any)?.value;
    } catch (e) {
        browserSaving = false;
    }
    if (info && !info.hibpCheck) {
        // Die Prüfung läuft in KeePass: dort einschalten (KeePassFerry-Optionen, mit Erklärung und Fortschritt)
        tips.push({ id: "hibp", icon: "shield-search", tone: "warn", action: "ferry_open_keepass_options", primary: true, run: async () => {
            await chrome.runtime.sendMessage({ keepassferry: "openKeePassOptions" }).catch(() => undefined);
            window.close();
        } });
    }
    // Weitere Datenbank geöffnet, für die noch nicht entschieden ist, ob KeePass sie prüft (nie von selbst eingeschaltet).
    // Die id enthält die Namen: eine später hinzukommende Datenbank erscheint wieder, auch wenn ein früherer Tipp
    // ausgeblendet wurde
    if (info?.hibpCheck && info.hibpUndecided?.length) {
        const names = info.hibpUndecided.map(n => "„" + n + "“").join(", ");
        tips.push({
            id: "hibpdb:" + info.hibpUndecided.join("|"), textKey: "hibpdb", icon: "shield-search", tone: "warn",
            action: "ferry_open_keepass_options", primary: true, args: [names], run: async () => {
                await chrome.runtime.sendMessage({ keepassferry: "openKeePassOptions" }).catch(() => undefined);
                window.close();
            }
        });
    }
    if (info && !info.winHello) {
        tips.push({ id: "winhello", icon: "fingerprint", tone: "plain", action: "ferry_tip_guide", run: () => {
            chrome.tabs.create({ url: "https://github.com/sirAndros/KeePassWinHello" });
            window.close();
        } });
    }
    if (info && !info.anyOtp) tips.push({ id: "otp", icon: "shield-lock", tone: "plain" });
    if (info && info.anyPasskey === false) tips.push({ id: "passkey", icon: "fingerprint", tone: "plain" });
    // Symbol versteckt im Erweiterungsmenü (Puzzleteil): Anheften geht nur von Hand
    try {
        const settings = await (chrome.action as any).getUserSettings?.();
        if (settings && settings.isOnToolbar === false) tips.push({ id: "pin", icon: "pin", tone: "warn" });
    } catch (e) {
        // ältere Browser
    }
    // Tastenkürzel zum Ausfüllen: vorhandenes nennen, sonst zum Festlegen
    try {
        const primary = (await chrome.commands.getAll()).find(c => c.name === "primary-action");
        const shortcut = (primary?.shortcut ?? "").trim();
        if (shortcut) {
            tips.push({ id: "shortcut", icon: "keyboard", tone: "plain", args: [shortcut] });
        } else {
            tips.push({ id: "shortcutset", icon: "keyboard", tone: "plain", action: "ferry_tip_shortcutset_action", run: () => {
                chrome.tabs.create({ url: navigator.userAgent.includes("Edg/") ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts" });
                window.close();
            } });
        }
    } catch (e) {
        // ohne Tipp
    }
    if (browserSaving) {
        tips.push({ id: "browsersaving", icon: "browser", tone: "plain", action: "ferry_tip_disable", primary: true, run: async () => {
            configManager.setASAP({ ferryDisableBrowserPasswordSaving: true } as any);
            try {
                await chrome.privacy.services.passwordSavingEnabled.set({ value: false });
            } catch (e) {
                // Richtlinie des Administrators o. Ä.
            }
            reload();
        } });
    }
    // Diagnoseprotokoll ist nur für die Fehlersuche gedacht
    if (configManager.current.ferryDiagnostics) {
        tips.push({ id: "diag", icon: "bug", tone: "warn", action: "ferry_tip_disable", primary: true, run: async () => {
            configManager.setASAP({ ferryDiagnostics: false } as any);
            reload();
        } });
    }
    return { tips, connected: !!status?.connected };
}

// Anzahl der Tipps, die der Nutzer noch nicht ausgeblendet hat (für das Pulsieren in der Fußleiste)
export async function openTipCount(): Promise<number> {
    const [{ tips }, dismissed] = await Promise.all([loadTips(), loadDismissedTips()]);
    return tips.filter(t => !dismissed.includes(t.id)).length;
}

// Text mit eingesetzten Platzhaltern ($1 …): chrome.i18n bekommt eindeutige Markierungen, die danach durch die echten
// Werte ersetzt werden (das Tastenkürzel kam sonst teils leer an: "Mit  trägst du …")
export function tipText(tip: Tip): string {
    const key = "ferry_tip_" + (tip.textKey ?? tip.id) + "_text";
    const args = tip.args ?? [];
    if (!args.length) return chrome.i18n.getMessage(key) || "";
    const marks = args.map((_, i) => "⁣KPF" + i + "⁣");
    let text = chrome.i18n.getMessage(key, marks) || "";
    args.forEach((arg, i) => (text = text.split(marks[i]).join(arg)));
    return text;
}
