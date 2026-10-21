/*
loginFields.ts: Erkennung des Benutzerfelds einer Anmeldung (Feldsymbole, "In die Seite eintragen").
Ein Textfeld ist ein Benutzerfeld, wenn
1. es autocomplete="username"/"email"/"webauthn" trägt (HTML-Standard), oder
2. es das letzte sichtbare Textfeld vor dem ersten sichtbaren Passwortfeld seines Formulars ist
   (dieselbe Regel nutzt der Passwortmanager von Chromium), oder
3. das Formular kein Passwortfeld und genau ein sichtbares Textfeld hat, das wie ein Login aussieht
   (type="email" oder Name/Beschriftung "user", "login", "email" …) – erster Schritt mehrstufiger Anmeldungen.
Alles andere (Name, Adresse, IBAN, Suche, Einstellungen …) erfüllt keine dieser Bedingungen.
*/

const TEXT_TYPES = ["text", "email", "tel", ""];
const LOGIN_NAME = /\b(user|username|login|log in|logon|sign in|signin|e-?mail|benutzer|benutzername|anmeldename|anmeldung|identifier)\b/i;

function isShown(el: HTMLElement): boolean {
    if (el.offsetWidth <= 0 && el.offsetHeight <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
}

function isTextInput(el: HTMLInputElement): boolean {
    return TEXT_TYPES.includes((el.getAttribute("type") ?? "").toLowerCase()) && !el.disabled && isShown(el);
}

function isPasswordInput(el: HTMLInputElement): boolean {
    return el.type === "password" && !el.disabled && isShown(el);
}

// Name, ID, Platzhalter und Beschriftung; "userName" -> "user Name", "login_email" -> "login email"
function hintsOf(el: HTMLInputElement): string {
    return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), ...Array.from(el.labels ?? []).map(l => l.textContent)]
        .filter(Boolean)
        .join(" ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_.:[\]]+/g, " ");
}

// Formular des Felds; ohne <form> der nächste umgebende Bereich mit Passwortfeld, sonst ein als Formular
// dienender Bereich bzw. das Dokument
function scopeOf(el: HTMLInputElement): ParentNode {
    if (el.form) return el.form;
    for (let node = el.parentElement; node && node !== el.ownerDocument.body; node = node.parentElement) {
        if (node.querySelector("input[type=password]")) return node;
    }
    return el.closest("[role=form], dialog, [role=dialog], main") ?? el.ownerDocument;
}

function inputsIn(scope: ParentNode): HTMLInputElement[] {
    return Array.from(scope.querySelectorAll("input")) as HTMLInputElement[];
}

export function isUsernameField(el: HTMLInputElement): boolean {
    if (!(el instanceof HTMLInputElement) || !isTextInput(el)) return false;

    const ac = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (/\b(username|email|webauthn)\b/.test(ac)) return true;

    const inputs = inputsIn(scopeOf(el));
    const firstPassword = inputs.find(isPasswordInput);
    if (firstPassword) {
        const before = inputs.filter(
            i => isTextInput(i) && !!(i.compareDocumentPosition(firstPassword) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
        return before[before.length - 1] === el;
    }

    const texts = inputs.filter(isTextInput);
    return texts.length === 1 && texts[0] === el && (el.type === "email" || LOGIN_NAME.test(hintsOf(el)));
}

// Benutzerfeld der Seite (für "In die Seite eintragen"): erstes Feld, das die Regeln erfüllt
export function findUsernameField(doc: Document = document): HTMLInputElement {
    return inputsIn(doc).find(isUsernameField) ?? null;
}

// Alle erkannten Anmeldefelder der Seite (sichtbare Passwortfelder und Benutzerfelder), z. B. für das Gesperrt-Symbol
export function findLoginFields(doc: Document = document): HTMLInputElement[] {
    return inputsIn(doc).filter(i => isPasswordInput(i) || isUsernameField(i));
}

export function findPasswordField(doc: Document = document): HTMLInputElement {
    return inputsIn(doc).find(i => isPasswordInput(i) && !i.readOnly) ?? null;
}
