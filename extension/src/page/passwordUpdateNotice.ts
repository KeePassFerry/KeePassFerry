import { showSaveNotice } from "./SaveNotice";
import { findPasswordField } from "./loginFields";

/*
passwordUpdateNotice.ts: Hinweis "Passwort aktualisieren?" erst zeigen, wenn kein Anmeldeformular mehr zu sehen ist.
Steht es noch bzw. wieder da, ist die Anmeldung vermutlich fehlgeschlagen (z. B. vertippt): dann nichts anbieten,
sonst würde ein falsches Passwort das richtige im Eintrag ersetzen. Gewartet wird höchstens zehn Sekunden
(Seiten, die nach der Anmeldung ohne Neuladen umschalten).
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
        cancelPasswordUpdateNotice();
    }, CHECK_INTERVAL_MS);
}

export function cancelPasswordUpdateNotice() {
    clearInterval(waitTimer);
    waitTimer = null;
}
