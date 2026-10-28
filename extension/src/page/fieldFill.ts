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

// Kontextmenü "Einfügen": das Feld, in das zuletzt rechts geklickt wurde (auch nicht erkannte Felder, auch im Shadow DOM)
let contextTarget: HTMLInputElement | HTMLTextAreaElement = null;
const NO_TEXT_TYPES = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];

export function trackContextTarget() {
    document.addEventListener(
        "contextmenu",
        e => {
            const t = e.composedPath()[0];
            const isText =
                t instanceof HTMLTextAreaElement ||
                (t instanceof HTMLInputElement && !NO_TEXT_TYPES.includes(t.type.toLowerCase()));
            contextTarget = isText && !t.disabled && !t.readOnly ? t : null;
        },
        true
    );
}

// Wert in das zuletzt rechts angeklickte Feld eintragen; true, wenn es das Feld noch gibt
export function fillContextTarget(value: string): boolean {
    const el = contextTarget;
    if (!el?.isConnected || value == null) return false;
    el.focus();
    // Über den nativen Setter, damit React/Vue die Änderung mitbekommen
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}

// Benutzername oder Passwort eintragen; true, wenn ein Feld gefüllt wurde
export function fillFieldKind(kind: PageFieldKind, value: string): boolean {
    const el = kind === "password" ? findPasswordField() : kind === "username" ? findUsernameField() : null;
    if (!el || value == null) return false;
    setValue(el, value);
    return true;
}
