import { setValue } from "./OtpFields";
import { findPasswordField, findUsernameField } from "./loginFields";
import type { PageFieldKind, PageFieldKinds } from "../common/AddonMessage";

/*
fieldFill.ts: Einzelnes Feld aus dem Popup füllen (Knopf "In die Seite eintragen" neben Kopieren).
Benutzer- und Passwortfeld nach denselben Regeln wie die Feldsymbole (loginFields.ts); Codefelder übernimmt OtpFields.
*/

export function availableFieldKinds(hasOtpTarget: boolean): PageFieldKinds {
    return { username: !!findUsernameField(), password: !!findPasswordField(), otp: hasOtpTarget };
}

// Benutzername oder Passwort eintragen; true, wenn ein Feld gefüllt wurde
export function fillFieldKind(kind: PageFieldKind, value: string): boolean {
    const el = kind === "password" ? findPasswordField() : kind === "username" ? findUsernameField() : null;
    if (!el || value == null) return false;
    setValue(el, value);
    return true;
}
