import { ferry } from "./KF";
import { Action } from "../common/Action";
import { FerryURL } from "../common/FerryURL";
import type { AddonMessage, PageFieldKind, PageFieldKinds } from "../common/AddonMessage";

/*
pageFields.ts: Knöpfe "In die Seite eintragen" im Popup. Fragt alle Frames des Tabs, welche Feldarten
(Benutzername, Passwort, Codefeld) es gibt, und füllt auf Wunsch eine Feldart mit dem Wert des Eintrags.
Der gefüllte Eintrag gilt danach als zuletzt benutzt (für den Einmalcode auf der Folgeseite).
*/

let nextQueryId = 1;
const pending = new Map<number, (kinds: PageFieldKinds) => void>();

// Antwort eines Frames (aus messageHandlers)
export function onFieldsAvailable(queryId: number, kinds: PageFieldKinds) {
    pending.get(queryId)?.(kinds);
}

export async function queryPageFields(tabId: number): Promise<PageFieldKinds> {
    const result: PageFieldKinds = { username: false, password: false, otp: false };
    const ports = ferry.tabStates.get(tabId)?.framePorts;
    if (!ports || ports.size === 0) return result;
    const queryId = nextQueryId++;
    let answers = 0;
    await new Promise<void>(resolve => {
        const timer = self.setTimeout(resolve, 400);
        pending.set(queryId, kinds => {
            for (const k of Object.keys(result) as PageFieldKind[]) result[k] = result[k] || !!kinds?.[k];
            if (++answers >= ports.size) {
                clearTimeout(timer);
                resolve();
            }
        });
        ports.forEach(port => {
            try {
                port.postMessage({ action: Action.QueryFields, queryId } as AddonMessage);
            } catch (e) {
                answers++;
            }
        });
    });
    pending.delete(queryId);
    return result;
}

export async function fillPageField(
    tabId: number,
    kind: PageFieldKind,
    uuid: string,
    dbFileName: string,
    value: string
): Promise<boolean> {
    const state = ferry.tabStates.get(tabId);
    if (!state?.framePorts?.size) return false;
    const message: AddonMessage = { action: Action.FillField, fillKind: kind };
    if (kind === "otp") {
        const totp = await ferry.rpc.getTotp(uuid, dbFileName);
        if (!totp?.code) return false;
        message.otpCode = totp.code;
        message.otpRemaining = totp.remainingSeconds;
        message.otpPeriod = totp.period || 30;
    } else {
        message.fillValue = value;
    }
    state.framePorts.forEach(port => {
        try {
            port.postMessage(message);
        } catch (e) {
            // Frame ist weg
        }
    });

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const domain = FerryURL.fromString(tab?.url ?? "")?.domainOrIPAddress;
    if (domain && uuid) {
        if (!ferry.persistentTabStates.get(tabId)) ferry.persistentTabStates.set(tabId, { items: [] });
        ferry.persistentTabStates.get(tabId).lastFilledEntry = { uuid, dbFileName, domain, at: Date.now() };
    }
    return true;
}
