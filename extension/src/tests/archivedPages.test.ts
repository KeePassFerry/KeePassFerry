// @vitest-environment jsdom
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { findOtpTarget, isOtpField } from "../page/OtpFields";
import { isUsernameField } from "../page/loginFields";
import { FormUtils } from "../page/formsUtils";

/*
archivedPages.test.ts: Gegencheck der Felderkennung mit archivierten Problemseiten (seiten-analysen/faelle.json,
nur lokal, nicht im Repo). Baut je Fall die Felder nach und prüft die Einordnung (code, benutzer, passwort, keins)
und, falls angegeben, in welche Felder ein Einmalcode käme (codeziel, auch Ziffernkästchen).
Ohne die Datei (z. B. im öffentlichen Repo oder in der CI) wird der Test übersprungen.
*/

interface Feld {
    type: string;
    name?: string;
    autocomplete?: string;
    label?: string;
    placeholder?: string;
    maxlength?: number;
    inputmode?: string;
    rahmen?: number;
    erwartet: "code" | "benutzer" | "passwort" | "keins";
}

const FILE = resolve(__dirname, "../../../seiten-analysen/faelle.json");
const faelle: { seite: string; kontext2fa: boolean; codeziel?: string[]; formular: Feld[] }[] = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, "utf-8")).faelle
    : [];

// jsdom berechnet kein Layout; die Erkennung zählt nur sichtbare Felder
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 30 });
    // Rechteck auf der Seite (jsdom liefert 0×0 bei 0,0, das gilt als außerhalb der Seite)
    HTMLElement.prototype.getBoundingClientRect = () => ({ left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30, x: 10, y: 10, toJSON: () => ({}) });
});

function einordnen(el: HTMLInputElement): string {
    if (isOtpField(el)) return "code";
    if (isUsernameField(el)) return "benutzer";
    if (el.type === "password") return "passwort";
    return "keins";
}

let clock = Date.now();

describe.skipIf(faelle.length === 0)("Archivierte Problemseiten", () => {
    for (const fall of faelle) {
        it(fall.seite, () => {
            // Zwei-Faktor-Kontext der Seite wird 1,5 s zwischengespeichert: Uhr je Fall weiterdrehen
            clock += 5000;
            vi.spyOn(Date, "now").mockReturnValue(clock);
            document.title = fall.kontext2fa ? "Two-factor authentication" : "Sign in";
            document.body.innerHTML = "";
            const form = document.createElement("form");
            document.body.appendChild(form);
            const inputs = fall.formular.map((f, i) => {
                const el = document.createElement("input");
                el.setAttribute("type", f.type);
                el.id = "f" + i;
                if (f.name) el.setAttribute("name", f.name);
                if (f.autocomplete) el.setAttribute("autocomplete", f.autocomplete);
                if (f.placeholder) el.setAttribute("placeholder", f.placeholder);
                if (f.maxlength) el.setAttribute("maxlength", String(f.maxlength));
                if (f.inputmode) el.setAttribute("inputmode", f.inputmode);
                if (f.label) {
                    const label = document.createElement("label");
                    label.htmlFor = el.id;
                    label.textContent = f.label;
                    form.appendChild(label);
                }
                // Hüllen-<div> wie bei UI-Frameworks (MUI: InputBase → FormControl)
                let node: HTMLElement = el;
                for (let r = 0; r < (f.rahmen ?? 0); r++) {
                    const div = document.createElement("div");
                    div.appendChild(node);
                    node = div;
                }
                form.appendChild(node);
                return el;
            });
            const actual = inputs.map(einordnen);
            expect(actual).toEqual(fall.formular.map(f => f.erwartet));
            // Benutzerfeld des ganzen Formulars: das als benutzer erwartete Feld, sonst keins (#51)
            const scan = new FormUtils({ debug: () => {} } as any).getFormFields(form, false, 50);
            const user = scan.actualUsernameIndex < 0 ? null : scan.otherFields[scan.actualUsernameIndex].DOMelement.id;
            const expectedUser = fall.formular.findIndex(f => f.erwartet === "benutzer");
            expect(user).toBe(expectedUser < 0 ? null : "f" + expectedUser);
            if (fall.codeziel) expect((findOtpTarget() ?? []).map(el => el.name)).toEqual(fall.codeziel);
            vi.restoreAllMocks();
        });
    }
});
