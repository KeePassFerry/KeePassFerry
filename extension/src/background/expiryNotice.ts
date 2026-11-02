/*
expiryNotice.ts: Einträge mit Ablaufdatum (KeePass "Gültig bis"). Nach dem Ausfüllen eines Eintrags, dessen Passwort
bald abläuft oder abgelaufen ist, zeigt die Seite einen Hinweis mit "Passwort ändern" und "Später". Mit "Ausblenden"
(Plugin) kommen abgelaufene gar nicht mehr an, die Vorwarnung sagt dann, dass der Eintrag danach verschwindet.
- Nur beim Ausfüllen, kein Durchsuchen der Datenbank: also nie mehrere Hinweise auf einmal
- Je Eintrag höchstens einmal in 30 Minuten; "Später" blendet ihn bis zum nächsten Tag aus
*/
import { kee } from "./KF";
import { configManager } from "../common/ConfigManager";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";
import { expiryState, expirySoonTitle, formatExpiryDate } from "../common/expiry";
import { changePasswordUrl } from "./changePassword";
import { findEntryForEdit } from "./selectionSave";
import { KeeLog } from "../common/Logger";

const REPEAT_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "ferryExpirySnooze";

const lastShown = new Map<string, number>();
// Tab -> Eintrag des gerade gezeigten Hinweises (für "Passwort ändern"/"Später")
const shownInTab = new Map<number, { key: string; url: string }>();

function entryKey(uuid: string, dbFileName: string) {
    return (dbFileName ?? "") + "|" + uuid;
}

function today() {
    return new Date().toLocaleDateString("sv");
}

async function snoozed(key: string): Promise<boolean> {
    try {
        const all = (await chrome.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY] ?? {};
        return all[key] === today();
    } catch {
        return false;
    }
}

export async function checkExpiryAfterFill(tabId: number, uuid: string, dbFileName: string) {
    if (!uuid) return;
    const key = entryKey(uuid, dbFileName);
    if (Date.now() - (lastShown.get(key) ?? 0) < REPEAT_MS) return;
    if (await snoozed(key)) return;
    let entry = null;
    try {
        entry = await findEntryForEdit(uuid, dbFileName);
    } catch (e) {
        KeeLog.debug("Expiry check: entry not found: " + e);
    }
    const state = expiryState(entry?.expiryTime, configManager.current.ferryExpiryWarnDays ?? 7);
    if (!state) return;
    const date = formatExpiryDate(state.date);
    const title = state.kind === "expired" ? $STR("ferry_expiry_expired") : expirySoonTitle(state.daysLeft);
    const hide = state.kind === "soon" && (await kee.KeePassRPC.getHideExpired().catch(() => false));
    const text = $STRF(
        state.kind === "expired" ? "ferry_expiry_since" : hide ? "ferry_expiry_until_hidden" : "ferry_expiry_until",
        [entry.title, date]
    );
    lastShown.set(key, Date.now());
    shownInTab.set(tabId, { key, url: entry.URLs?.[0] ?? "" });
    try {
        kee.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({
            action: Action.ShowExpiryNotice,
            expiryNotice: { expired: state.kind === "expired", title, text }
        } as AddonMessage);
    } catch (e) {
        // Seite lädt gerade neu
    }
}

// "Passwort ändern": Änderungsseite der Website (sonst die Website des Eintrags) in einem neuen Tab
export async function openChangePasswordFromNotice(tabId: number) {
    const shown = shownInTab.get(tabId);
    if (!shown?.url) return;
    const target = (await changePasswordUrl(shown.url).catch(() => null)) || shown.url;
    chrome.tabs.create({ url: target, openerTabId: tabId });
}

// "Später": bis morgen nicht mehr für diesen Eintrag
export async function snoozeExpiryNotice(tabId: number) {
    const shown = shownInTab.get(tabId);
    if (!shown) return;
    try {
        const all = (await chrome.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY] ?? {};
        const now = today();
        // Ältere Einträge aufräumen
        for (const k of Object.keys(all)) if (all[k] !== now) delete all[k];
        all[shown.key] = now;
        await chrome.storage.local.set({ [SNOOZE_KEY]: all });
    } catch (e) {
        KeeLog.debug("Expiry snooze failed: " + e);
    }
}

export function forgetExpiryNotice(tabId: number) {
    shownInTab.delete(tabId);
}
