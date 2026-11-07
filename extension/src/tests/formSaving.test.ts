// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../common/ConfigManager", () => ({ configManager: { siteConfigFor: () => ({}) } }));

import { FormSaving } from "../page/formSaving";
import { FormUtils } from "../page/formsUtils";

const logger = { debug: () => undefined, warn: () => undefined, info: () => undefined } as any;

// jsdom berechnet kein Layout; die Erkennung zählt nur sichtbare Felder
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
});

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

// Anmeldeformular, das KeePassFerry mit benutzer/passwort ausgefüllt hat
function filledLoginForm(benutzer: string, passwort: string) {
    document.body.innerHTML = `
        <form>
            <input id="benutzer" type="email" autocomplete="username">
            <input id="passwort" type="password" autocomplete="current-password">
            <button type="submit">Anmelden</button>
        </form>`;
    const form = document.forms[0];
    // Wie eine Seite, die selbst prüft und nicht neu lädt
    form.addEventListener("submit", e => e.preventDefault());
    const user = document.getElementById("benutzer") as HTMLInputElement;
    const pass = document.getElementById("passwort") as HTMLInputElement;
    const button = form.querySelector("button");
    user.value = benutzer;
    pass.value = passwort;
    const port = { postMessage: vi.fn() };
    const saving = new FormSaving(port as any, logger, new FormUtils(logger));
    saving.updateMatchResult({
        lastFilledOther: [{ DOMelement: user, value: benutzer }],
        lastFilledPasswords: [{ DOMelement: pass, value: passwort }]
    } as any);
    saving.addSubmitHandler(button, form);
    const submit = () => form.dispatchEvent(new Event("submit", { cancelable: true }));
    return { button, pass, port, submit };
}

// Registrierung: Felder wie auf der Seite, abgeschickt ohne vorheriges Ausfüllen durch KeePassFerry
function submitRegistration(html: string) {
    document.body.innerHTML = `<form>${html}<button type="submit">Registrieren</button></form>`;
    const form = document.forms[0];
    form.addEventListener("submit", e => e.preventDefault());
    const port = { postMessage: vi.fn() };
    const saving = new FormSaving(port as any, logger, new FormUtils(logger));
    saving.addSubmitHandler(form.querySelector("button"), form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    return port.postMessage.mock.calls[0][0].submittedData.fields.map((f: any) => [f.type, f.value]);
}

const sentPassword = (msg: any) => msg.submittedData?.fields.find((f: any) => f.type === "password").value;

describe("FormSaving beim Absenden", () => {
    it("meldet eine unverändert abgeschickte Anmeldung nur mit dem Benutzernamen, ohne Zugangsdaten", () => {
        const { port, submit } = filledLoginForm("max@example.com", "test3");
        submit();
        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledWith({ action: "filledLoginSubmitted", submittedUsername: "max@example.com" });
    });

    it("schickt geänderte Zugangsdaten wie bisher zum Speichern", () => {
        const { pass, port, submit } = filledLoginForm("max@example.com", "test3");
        pass.value = "test6";
        submit();
        expect(port.postMessage).toHaveBeenCalledTimes(1);
        const msg = port.postMessage.mock.calls[0][0];
        expect(msg.action).toBeUndefined();
        expect(sentPassword(msg)).toBe("test6");
    });

    it("übernimmt aus einer Registrierung nur Benutzername und Passwort", () => {
        const fields = submitRegistration(`
            <input name="strasse" value="Musterweg 1">
            <input name="plz" value="94469">
            <input type="checkbox" name="agb" checked>
            <select name="land"><option value="de" selected>DE</option></select>
            <input name="email" type="email" autocomplete="email" value="max@example.com">
            <input name="pw" type="password" value="geheim">
            <input name="pw2" type="password" value="geheim">`);
        expect(fields).toEqual([["text", "max@example.com"], ["password", "geheim"]]);
    });

    it("nimmt das E-Mail-Feld, wenn direkt vor dem Passwort ein anderes Textfeld steht", () => {
        const fields = submitRegistration(`
            <input name="mail" type="email" value="max@example.com">
            <input name="ort" value="Grafling">
            <input name="pw" type="password" value="geheim">`);
        expect(fields).toEqual([["text", "max@example.com"], ["password", "geheim"]]);
    });

    it("nimmt das Feld vor dem Passwort, wenn nichts auf ein anderes Anmeldefeld hinweist", () => {
        const fields = submitRegistration(`
            <input name="firma" value="Muster GmbH">
            <input name="kdnr" value="123456">
            <input name="pw" type="password" value="geheim">`);
        expect(fields).toEqual([["text", "123456"], ["password", "geheim"]]);
    });

    it("findet den Benutzernamen auch, wenn davor ein leeres Feld steht", () => {
        const fields = submitRegistration(`
            <input name="titel" value="">
            <input name="benutzer" value="max">
            <input name="pw" type="password" value="geheim">`);
        expect(fields).toEqual([["text", "max"], ["password", "geheim"]]);
    });

    it("wertet Klick auf den Absende-Knopf und das folgende Absenden nur einmal aus", () => {
        const { button, pass, port } = filledLoginForm("max@example.com", "test3");
        pass.value = "test6";
        button.click();
        expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    it("erkennt einen weiteren Versuch auf derselben Seite (vertippt, dann richtig, ohne Neuladen)", () => {
        const { pass, port, submit } = filledLoginForm("max@example.com", "test3");
        pass.value = "test6";
        submit();
        vi.advanceTimersByTime(3000);
        pass.value = "test3";
        submit();
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(sentPassword(port.postMessage.mock.calls[0][0])).toBe("test6");
        expect(port.postMessage.mock.calls[1][0]).toEqual({
            action: "filledLoginSubmitted",
            submittedUsername: "max@example.com"
        });
    });
});
