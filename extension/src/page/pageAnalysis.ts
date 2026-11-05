import { pageDiag } from "./ferryDiagPage";
import { isUsernameField } from "./loginFields";
import { fieldFrameRect } from "./fieldFrame";
import { isOtpField, kpfFilledHow, pageHas2faContext } from "./OtpFields";

/*
pageAnalysis.ts: Knopf "Seite für Diagnose erfassen" im Popup (nur bei eingeschaltetem Diagnoseprotokoll).
Schreibt den Aufbau der Anmeldefelder dieses Frames ins Diagnoseprotokoll: Formulare, Felder (auch im Shadow-DOM),
Sichtbarkeit, Rahmen und was an der Stelle des Feldsymbols oben liegt, dazu KeePassFerrys Formularwahl.
Nie Feldinhalte, nur ob ein Feld gefüllt ist. Eine Zeile je Formular bzw. Feld (eine Zeile ist auf 4000 Zeichen begrenzt).
*/

const ICON_HOST_TAG = "KEEPASSFERRY-FIELD-ICONS";
const FIELD_TYPES = ["text", "email", "tel", "password", "number", ""];

function round(r: DOMRect): string {
    return [r.left, r.top, r.width, r.height].map(Math.round).join(",");
}

function describe(el: Element): string {
    if (!el) return "-";
    const name = (el as HTMLInputElement).name ? "[" + (el as HTMLInputElement).name + "]" : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + String(el.className).trim().split(/\s+/).slice(0, 3).join(".") + name;
}

function drawn(el: Element): boolean {
    const s = getComputedStyle(el);
    const line = (w: string, st: string) => parseFloat(w) > 0 && st !== "none" && st !== "hidden";
    return (
        line(s.borderTopWidth, s.borderTopStyle) ||
        line(s.borderBottomWidth, s.borderBottomStyle) ||
        !/^(transparent|rgba\(.*,\s*0\))$/.test(s.backgroundColor) ||
        s.boxShadow !== "none"
    );
}

// Oberstes Element an einer Stelle, ohne die eigenen Symbole
function topAt(root: Document | ShadowRoot, x: number, y: number): string {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return "außerhalb";
    return describe(root.elementsFromPoint(x, y).find(e => e.tagName !== ICON_HOST_TAG));
}

function collectInputs(root: Document | ShadowRoot, where: string, out: { el: HTMLInputElement; where: string }[]) {
    root.querySelectorAll("input").forEach(i => {
        if (FIELD_TYPES.includes((i.getAttribute("type") ?? "").toLowerCase())) out.push({ el: i, where });
    });
    root.querySelectorAll("*").forEach(e => {
        if (e.shadowRoot) collectInputs(e.shadowRoot, where + ">shadow(" + e.tagName.toLowerCase() + ")", out);
    });
}

// Hinweise der Seite am Feld (Beschriftung, Platzhalter, aria-label): Seitentext, nie Eingaben; gekürzt
function hintsOf(el: HTMLInputElement): string {
    const parts = [el.placeholder, el.getAttribute("aria-label"), el.getAttribute("title")];
    if (el.labels) for (const label of Array.from(el.labels)) parts.push(label.textContent);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) for (const id of labelledBy.split(/\s+/)) parts.push(document.getElementById(id)?.textContent);
    return parts
        .filter(Boolean)
        .map(p => p.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" | ")
        .slice(0, 120);
}

// Sichtbarer Text der Seite rund ums Feld (z. B. "Please enter the 6-digit code" ohne <label>): erste Ebene darüber,
// die Text enthält, höchstens drei Ebenen; textContent enthält keine Feldwerte. Gekürzt
function surroundingText(el: HTMLInputElement): string {
    let node: Element = el;
    for (let i = 0; i < 3 && node.parentElement && node.parentElement !== document.body; i++) {
        node = node.parentElement;
        const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text) return text.slice(0, 120);
    }
    return "";
}

export type FieldRoleOf = (el: HTMLElement) => { rolle: string; formIndex: number; vonKpfGefuellt: boolean };

export function capturePageAnalysis(selection: Record<string, unknown>, roleOf?: FieldRoleOf) {
    const frame = window === window.top ? "haupt" : "iframe";
    const inputs: { el: HTMLInputElement; where: string }[] = [];
    collectInputs(document, "seite", inputs);
    const forms = Array.from(document.forms);

    pageDiag("seiten-analyse", {
        adresse: location.origin + location.pathname,
        frame,
        fenster: window.innerWidth + "x" + window.innerHeight,
        erweiterung: chrome.runtime.getManifest().version,
        zweiFaktorKontext: pageHas2faContext(),
        formulare: forms.length,
        felder: inputs.length,
        iframes: Array.from(document.querySelectorAll("iframe")).map(f => {
            try {
                return new URL(f.src).origin;
            } catch (e) {
                return f.src ? "?" : "leer";
            }
        }),
        symbolHosts: document.querySelectorAll(ICON_HOST_TAG.toLowerCase()).length,
        kpfAuswahl: selection
    });

    forms.forEach((f, i) => {
        const s = getComputedStyle(f);
        pageDiag("seiten-analyse formular", {
            i,
            action: (f.getAttribute("action") ?? "").replace(/\?.*$/, "").slice(0, 80),
            pos: round(f.getBoundingClientRect()),
            display: s.display,
            visibility: s.visibility,
            opacity: s.opacity,
            felder: Array.from(f.querySelectorAll("input")).filter(x => FIELD_TYPES.includes(x.type)).length
        });
    });

    inputs.slice(0, 40).forEach(({ el, where }) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const frameRect = fieldFrameRect(el);
        const parents: string[] = [];
        let node: Element = el;
        for (let i = 0; i < 3 && node.parentElement; i++) {
            node = node.parentElement;
            parents.push(
                describe(node) + " " + round(node.getBoundingClientRect()) + (drawn(node) ? " gezeichnet" : "") +
                    " eingaben=" + node.querySelectorAll("input:not([type=hidden]), textarea, select").length
            );
        }
        const root = el.getRootNode() as Document | ShadowRoot;
        pageDiag("seiten-analyse feld", {
            wo: where,
            typ: el.type,
            name: el.name,
            id: el.id,
            autocomplete: el.getAttribute("autocomplete") ?? "",
            hinweise: hintsOf(el),
            textUmFeld: surroundingText(el),
            maxlength: el.maxLength,
            inputmode: el.getAttribute("inputmode") ?? "",
            codefeld: isOtpField(el),
            ...(roleOf ? roleOf(el) : {}),
            // Wer den aktuellen Wert eingetragen hat: anmeldung (Liste/automatisch), code, popup, kontextmenü; sonst null
            gefuelltDurch: roleOf?.(el)?.vonKpfGefuellt ? "anmeldung" : kpfFilledHow(el),
            formular: el.form ? forms.indexOf(el.form) : null,
            pos: round(r),
            offsetParent: !!el.offsetParent,
            visibility: s.visibility,
            display: s.display,
            opacity: s.opacity,
            gefuellt: !!el.value,
            gezeichnet: drawn(el),
            benutzerfeld: el.type !== "password" && isUsernameField(el),
            rahmen: round(frameRect),
            mitte: topAt(root, r.left + r.width / 2, r.top + r.height / 2),
            symbolstelle: topAt(root, frameRect.right - 12, r.top + r.height / 2),
            eltern: parents
        });
    });
}
