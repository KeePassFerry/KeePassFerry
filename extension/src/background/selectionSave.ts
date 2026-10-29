import { kee } from "./KF";
import { KeeURL } from "../common/KeeURL";
import { KeeLog } from "../common/Logger";
import { Entry } from "../common/model/Entry";
import { sameSite } from "../common/relatedDomains";

/*
Rechtsklick auf markierten Text → "„…“ zu Eintrag hinzufügen": Die Markierung wird vollständig aus dem angeklickten
Frame gelesen (das Menü-Ereignis fasst Zeilenumbrüche zusammen) und bis zum Speichern nur hier im Hintergrund
gehalten. Das Popup (?selection=1) öffnet für den gewählten Eintrag das bekannte Bearbeiten-Fenster mit aufgeklapptem
"Hinzufügen" und der Markierung als Inhalt; die Art wählt der Nutzer dort. Bei gesperrter Datenbank stößt der bewusste
Klick das Entsperren an; das Popup öffnet sich danach.
*/

const MAX_AGE_MS = 10 * 60 * 1000;
const UNLOCK_WAIT_MS = 60 * 1000;
const MAX_TEXT_LENGTH = 64 * 1024;

interface PendingSelection {
    text: string;
    url: string;
    pageTitle: string;
    domain: string;
    at: number;
}

const pending = new Map<number, PendingSelection>();

// Markierung im Frame: in Eingabefeldern aus dem Feldwert (getSelection liefert dort nichts), sonst die Seitenmarkierung
async function readSelection(tabId: number, frameId: number, fallback: string): Promise<string> {
    try {
        const [r] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId ?? 0] },
            func: () => {
                const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
                if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
                    if ((el as HTMLInputElement).type === "password") return "";
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    if (typeof start === "number" && typeof end === "number" && end > start) return el.value.substring(start, end);
                }
                return window.getSelection()?.toString() ?? "";
            }
        });
        if (typeof r?.result === "string" && r.result.trim()) return r.result;
    } catch (e) {
        KeeLog.debug("Reading the selection failed: " + e);
    }
    return fallback ?? "";
}

async function waitForUnlock(): Promise<boolean> {
    const until = Date.now() + UNLOCK_WAIT_MS;
    while (Date.now() < until) {
        if (!kee.store.state.connected) return false;
        if (kee.store.state.KeePassDatabases.length > 0) return true;
        await new Promise(resolve => self.setTimeout(resolve, 500));
    }
    return false;
}

export async function startSelectionSave(tab: chrome.tabs.Tab, frameId: number, selectionText: string) {
    if (tab?.id == null || !kee.store.state.connected || !/^https?:/.test(tab.url ?? "")) return;
    const text = (await readSelection(tab.id, frameId, selectionText)).trim();
    if (!text) return;
    pending.set(tab.id, {
        text: text.slice(0, MAX_TEXT_LENGTH),
        url: tab.url,
        pageTitle: tab.title ?? "",
        domain: KeeURL.fromString(tab.url)?.domainOrIPAddress ?? "",
        at: Date.now()
    });
    kee.foregroundTabId = tab.id;

    if (kee.store.state.KeePassDatabases.length === 0) {
        const result = await kee.requestBackgroundUnlock(tab.id, tab.url, true);
        if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) kee.openKeePass();
        if (!(await waitForUnlock())) return;
    }

    try {
        // Nach Windows Hello hat oft KeePass bzw. der Dialog den Fokus; openPopup braucht das Browserfenster vorne
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.action.setPopup({ popup: "dist/popup/index.html?selection=1" });
        await chrome.action.openPopup();
    } catch (e) {
        KeeLog.warn("Could not open the popup for adding the selection: " + e);
    } finally {
        await chrome.action.setPopup({ popup: "dist/popup/index.html" });
    }
}

// Daten für die Popup-Ansicht: Markierung und vorgeschlagene Einträge der Seite (zuletzt im Tab benutzter zuerst)
export async function getSelectionSaveForPopup(tabId: number) {
    const s = pending.get(tabId);
    if (!s || Date.now() - s.at > MAX_AGE_MS) return null;
    const last = kee.persistentTabStates.get(tabId)?.lastFilledEntry;
    const lastUuid = last && sameSite(last.domain, s.domain) ? last.uuid : null;
    const found: Entry[] = (await kee.KeePassRPC.findLogins(s.url, null, null, null, null, null)) ?? [];
    const ordered = lastUuid ? [...found.filter(e => e.uuid === lastUuid), ...found.filter(e => e.uuid !== lastUuid)] : found;
    const seen = new Set<string>();
    const candidates = [];
    for (const e of ordered) {
        const key = e.database.fileName + "|" + e.uuid;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
            uuid: e.uuid,
            dbFileName: e.database.fileName,
            title: e.title,
            username: Entry.getUsernameField(e)?.value ?? "",
            icon: e.icon?.iconImageData ?? ""
        });
        if (candidates.length >= 8) break;
    }
    return { text: s.text, domain: s.domain, pageTitle: s.pageTitle, origin: originOf(s.url), candidates, lastFilledUuid: lastUuid };
}

function originOf(url: string): string {
    try {
        return new URL(url).origin + "/";
    } catch (e) {
        return url;
    }
}

// Vollständiger Eintrag (mit Feldern) für das Bearbeiten-Fenster, auch für Einträge aus der freien Suche
export async function findEntryForEdit(uuid: string, dbFileName: string): Promise<Entry> {
    const found: Entry[] = (await kee.KeePassRPC.findLogins(null, null, uuid, dbFileName, null, null)) ?? [];
    return found.find(e => e.uuid === uuid) ?? null;
}

// Neuer Eintrag für die Seite in der gewählten Datenbank und Gruppe (ohne Gruppe: Wurzel). Wird erst beim "Speichern"
// im Bearbeiten-Fenster aufgerufen, mit dem dort eingetragenen Titel; Adresse ist immer der Ursprung der Seite.
export async function createSelectionEntry(
    tabId: number,
    title: string,
    dbFileName: string,
    groupUuid: string
): Promise<{ uuid: string; dbFileName: string; title: string }> {
    const s = pending.get(tabId);
    const dbs = kee.store.state.KeePassDatabases;
    const db = dbs.find(d => d.fileName === dbFileName) ?? dbs[kee.store.state.ActiveKeePassDatabaseIndex] ?? dbs[0];
    if (!s || !db) return null;
    const entryTitle = (title ?? "").trim() || s.pageTitle.trim() || s.domain;
    const created = await kee.KeePassRPC.addLogin(
        new Entry({ title: entryTitle, URLs: [originOf(s.url)], fields: [] }),
        groupUuid || null,
        db.fileName
    );
    if (created) await kee.refreshAfterEntryChange();
    return created ? { uuid: created.uuid, dbFileName: created.database?.fileName ?? db.fileName, title: created.title } : null;
}

export function forgetSelectionSave(tabId: number) {
    pending.delete(tabId);
}
