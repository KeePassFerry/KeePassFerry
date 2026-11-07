import { ferry } from "./KF";
import { FerryURL } from "../common/FerryURL";
import { FerryLog } from "../common/Logger";
import { Entry } from "../common/model/Entry";
import { sameSite } from "../common/relatedDomains";
import { Action } from "../common/Action";
import type { AddonMessage, ContextFieldProblem, ContextFieldResult } from "../common/AddonMessage";
import type { Field } from "../common/model/Field";

/*
Rechtsklick auf markierten Text → "„…“ zu Eintrag hinzufügen": Die Markierung wird vollständig aus dem angeklickten
Frame gelesen (das Menü-Ereignis fasst Zeilenumbrüche zusammen) und bis zum Speichern nur hier im Hintergrund
gehalten. Das Popup (?selection=1) öffnet für den gewählten Eintrag das bekannte Bearbeiten-Fenster mit aufgeklapptem
"Hinzufügen" und der Markierung als Inhalt; die Art wählt der Nutzer dort. Bei gesperrter Datenbank stößt der bewusste
Klick das Entsperren an; das Popup öffnet sich danach.

Rechtsklick in ein Eingabefeld → "Dieses Feld zum Eintrag hinzufügen": gleicher Weg, das Popup nimmt das Feld mit seiner
Kennung und seinem Wert in die Feldliste des Eintrags auf, damit es künftig mit ausgefüllt wird. Der Wert liegt nur bis
zum Öffnen des Popups hier.
*/

const MAX_AGE_MS = 10 * 60 * 1000;
const UNLOCK_WAIT_MS = 60 * 1000;
const MAX_TEXT_LENGTH = 64 * 1024;

interface PendingSelection {
    text: string;
    field?: Field;
    problem?: ContextFieldProblem;
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
        FerryLog.debug("Reading the selection failed: " + e);
    }
    return fallback ?? "";
}

async function waitForUnlock(): Promise<boolean> {
    const until = Date.now() + UNLOCK_WAIT_MS;
    while (Date.now() < until) {
        if (!ferry.store.state.connected) return false;
        if (ferry.store.state.KeePassDatabases.length > 0) return true;
        await new Promise(resolve => self.setTimeout(resolve, 500));
    }
    return false;
}

export async function startSelectionSave(tab: chrome.tabs.Tab, frameId: number, selectionText: string) {
    if (tab?.id == null || !ferry.store.state.connected || !/^https?:/.test(tab.url ?? "")) return;
    const text = (await readSelection(tab.id, frameId, selectionText)).trim();
    if (!text) return;
    await openSavePopup(tab, { text: text.slice(0, MAX_TEXT_LENGTH) });
}

let nextFieldQueryId = 1;
const fieldQueries = new Map<number, (result: ContextFieldResult) => void>();

// Antwort des Frames auf Action.DescribeContextTarget (aus messageHandlers)
export function onContextField(queryId: number, result: ContextFieldResult) {
    fieldQueries.get(queryId)?.(result);
}

async function readContextField(tabId: number, frameId: number): Promise<ContextFieldResult> {
    const port = ferry.tabStates.get(tabId)?.framePorts?.get(frameId ?? 0);
    if (!port) return { problem: "noTarget" };
    const queryId = nextFieldQueryId++;
    try {
        return await new Promise<ContextFieldResult>(resolve => {
            const timer = self.setTimeout(() => resolve({ problem: "noTarget" }), 400);
            fieldQueries.set(queryId, result => {
                clearTimeout(timer);
                resolve(result);
            });
            port.postMessage({ action: Action.DescribeContextTarget, queryId } as AddonMessage);
        });
    } catch (e) {
        return { problem: "noTarget" };
    } finally {
        fieldQueries.delete(queryId);
    }
}

export async function startFieldSave(tab: chrome.tabs.Tab, frameId: number) {
    if (tab?.id == null || !ferry.store.state.connected || !/^https?:/.test(tab.url ?? "")) return;
    const { field, problem } = await readContextField(tab.id, frameId);
    await openSavePopup(tab, { text: field?.name ?? "", field, problem });
}

async function openSavePopup(tab: chrome.tabs.Tab, content: Pick<PendingSelection, "text" | "field" | "problem">) {
    pending.set(tab.id, {
        ...content,
        url: tab.url,
        pageTitle: tab.title ?? "",
        domain: FerryURL.fromString(tab.url)?.domainOrIPAddress ?? "",
        at: Date.now()
    });
    ferry.foregroundTabId = tab.id;

    // Für den Hinweis, warum das Feld nicht geht, braucht es keine offene Datenbank
    if (!content.problem && ferry.store.state.KeePassDatabases.length === 0) {
        const result = await ferry.requestBackgroundUnlock(tab.id, tab.url, true);
        if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) ferry.openKeePass();
        if (!(await waitForUnlock())) return;
    }

    try {
        // Nach Windows Hello hat oft KeePass bzw. der Dialog den Fokus; openPopup braucht das Browserfenster vorne
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.action.setPopup({ popup: "dist/popup/index.html?selection=1" });
        await chrome.action.openPopup();
    } catch (e) {
        FerryLog.warn("Could not open the popup for adding the selection: " + e);
    } finally {
        await chrome.action.setPopup({ popup: "dist/popup/index.html" });
    }
}

// Daten für die Popup-Ansicht: Markierung und vorgeschlagene Einträge der Seite (zuletzt im Tab benutzter zuerst)
export async function getSelectionSaveForPopup(tabId: number) {
    const s = pending.get(tabId);
    if (!s || Date.now() - s.at > MAX_AGE_MS) return null;
    if (s.problem) {
        pending.delete(tabId);
        return { text: "", problem: s.problem, domain: s.domain, pageTitle: s.pageTitle, origin: originOf(s.url), candidates: [] as unknown[], lastFilledUuid: null as string };
    }
    // Feldwert nur so lange wie nötig halten: ab hier verwaltet ihn das Bearbeiten-Fenster
    if (s.field) pending.delete(tabId);
    const last = ferry.persistentTabStates.get(tabId)?.lastFilledEntry;
    const lastUuid = last && sameSite(last.domain, s.domain) ? last.uuid : null;
    const found: Entry[] = (await ferry.rpc.findLogins(s.url, null, null, null, null, null)) ?? [];
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
    return { text: s.text, field: s.field, domain: s.domain, pageTitle: s.pageTitle, origin: originOf(s.url), candidates, lastFilledUuid: lastUuid };
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
    const found: Entry[] = (await ferry.rpc.findLogins(null, null, uuid, dbFileName, null, null)) ?? [];
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
    const dbs = ferry.store.state.KeePassDatabases;
    const writable = dbs.filter(d => !d.readOnly);
    const active = dbs[ferry.store.state.ActiveKeePassDatabaseIndex];
    const db = writable.find(d => d.fileName === dbFileName) ?? (active && !active.readOnly ? active : writable[0]);
    if (!s || !db) return null;
    const entryTitle = (title ?? "").trim() || s.pageTitle.trim() || s.domain;
    const created = await ferry.rpc.addLogin(
        new Entry({ title: entryTitle, URLs: [originOf(s.url)], fields: [] }),
        groupUuid || null,
        db.fileName
    );
    if (created) await ferry.refreshAfterEntryChange();
    return created ? { uuid: created.uuid, dbFileName: created.database?.fileName ?? db.fileName, title: created.title } : null;
}

export function forgetSelectionSave(tabId: number) {
    pending.delete(tabId);
}
