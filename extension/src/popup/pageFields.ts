import type { PageFieldKind, PageFieldKinds } from "../common/AddonMessage";

// Welche Feldarten die aktuelle Seite hat; einmal je Popup-Öffnung abgefragt und von allen Zeilen geteilt
let request: Promise<PageFieldKinds> = null;

export function pageFieldKinds(): Promise<PageFieldKinds> {
    if (!request) {
        request = chrome.runtime
            .sendMessage({ keepassferry: "pageFields" })
            .then(r => r ?? { username: false, password: false, otp: false })
            .catch(() => ({ username: false, password: false, otp: false }));
    }
    return request;
}

export async function fillPageField(kind: PageFieldKind, uuid: string, dbFileName: string, value?: string): Promise<boolean> {
    try {
        return !!(await chrome.runtime.sendMessage({ keepassferry: "fillField", kind, uuid, dbFileName, value }));
    } catch (e) {
        return false;
    }
}
