import { ferry } from "./KF";
import { FerryLog } from "../common/Logger";

/*
Stift im Feld-Panel der Seite: das Popup öffnen und dort gleich das Bearbeiten-Fenster dieses Eintrags zeigen
(?edit=1, der Eintrag liegt bis zum Abholen hier). Lässt sich das Popup nicht öffnen, öffnet KeePass den Eintrag.
*/

const MAX_AGE_MS = 60 * 1000;
let pending: { uuid: string; dbFileName: string; at: number } = null;

export async function openEntryInPopup(uuid: string, dbFileName: string, windowId?: number) {
    pending = { uuid, dbFileName, at: Date.now() };
    try {
        if (windowId != null) await chrome.windows.update(windowId, { focused: true });
        await chrome.action.setPopup({ popup: "dist/popup/index.html?edit=1" });
        await chrome.action.openPopup();
    } catch (e) {
        FerryLog.warn("Could not open the popup for editing an entry: " + e);
        pending = null;
        ferry.launchLoginEditor(uuid, dbFileName);
    } finally {
        await chrome.action.setPopup({ popup: "dist/popup/index.html" });
    }
}

// Für das Popup: der zu bearbeitende Eintrag (nur einmal und nur kurz nach dem Klick)
export function takePendingEdit(): { uuid: string; dbFileName: string } {
    const p = pending;
    pending = null;
    return p && Date.now() - p.at < MAX_AGE_MS ? { uuid: p.uuid, dbFileName: p.dbFileName } : null;
}
