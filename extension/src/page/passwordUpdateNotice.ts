import { HOST_ID, showSaveNotice, hideSaveNotice } from "./SaveNotice";
import { findPasswordField } from "./loginFields";
import { Port } from "../common/port";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";

/*
passwordUpdateNotice.ts: Hinweis "Passwort aktualisieren?" erst zeigen, wenn kein Anmeldeformular mehr zu sehen ist.
Steht es noch bzw. wieder da, ist die Anmeldung vermutlich fehlgeschlagen (z. B. vertippt): dann nichts anbieten und
dem Hintergrund melden, damit er das Angebot verwirft (sonst käme es später auf einer anderen Seite). Gewartet wird
höchstens zehn Sekunden (Seiten, die nach der Anmeldung ohne Neuladen umschalten).
*/

const CHECK_INTERVAL_MS = 1000;
const MAX_CHECKS = 10;

let waitTimer: number = null;

export function offerPasswordUpdateNotice(detail: string) {
    cancelPasswordUpdateNotice();
    if (!findPasswordField()) {
        showSaveNotice("update", detail);
        return;
    }
    let checks = 0;
    waitTimer = window.setInterval(() => {
        checks++;
        if (!findPasswordField()) showSaveNotice("update", detail);
        else if (checks < MAX_CHECKS) return;
        else Port.postMessage({ action: Action.PasswordUpdateNotShown } as AddonMessage);
        cancelPasswordUpdateNotice();
    }, CHECK_INTERVAL_MS);
}

export function cancelPasswordUpdateNotice() {
    clearInterval(waitTimer);
    waitTimer = null;
}

// Angebot erledigt (z. B. danach mit dem gespeicherten Passwort angemeldet): nicht mehr warten, Hinweis schließen.
// Ein Zwei-Faktor-Hinweis bleibt stehen
export function withdrawSaveNotice() {
    cancelPasswordUpdateNotice();
    const notice = document.getElementById(HOST_ID);
    if (notice && notice.dataset.kind !== "otp") hideSaveNotice();
}
