// @vitest-environment jsdom
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { isOtpField } from "../page/OtpFields";
import { isUsernameField } from "../page/loginFields";

/*
archivedPages.test.ts: Gegencheck der Felderkennung mit archivierten Problemseiten (seiten-analysen/faelle.json,
nur lokal, nicht im Repo). Baut je Fall die Felder nach und prüft die Einordnung (code, benutzer, passwort, keins).
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
    erwartet: "code" | "benutzer" | "passwort" | "keins";
}

const FILE = resolve(__dirname, "../../../seiten-analysen/faelle.json");
const faelle: { seite: string; kontext2fa: boolean; formular: Feld[] }[] = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, "utf-8")).faelle
    : [];

// jsdom berechnet kein Layout; die Erkennung zählt nur sichtbare Felder
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 200 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 30 });
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
                form.appendChild(el);
                return el;
            });
            const actual = inputs.map(einordnen);
            expect(actual).toEqual(fall.formular.map(f => f.erwartet));
            vi.restoreAllMocks();
        });
    }
});
