// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../common/ConfigManager", () => ({ configManager: { siteConfigFor: () => ({}) } }));

import { FormSaving } from "../page/formSaving";
import { FormUtils } from "../page/formsUtils";

const logger = { debug: () => undefined, warn: () => undefined, info: () => undefined } as any;

// jsdom berechnet kein Layout; die Erkennung zählt nur sichtbare Felder
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
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
    const user = document.getElementById("benutzer") as HTMLInputElement;
    const pass = document.getElementById("passwort") as HTMLInputElement;
    user.value = benutzer;
    pass.value = passwort;
    const port = { postMessage: vi.fn() };
    const saving = new FormSaving(port as any, logger, new FormUtils(logger));
    saving.updateMatchResult({
        lastFilledOther: [{ DOMelement: user, value: benutzer }],
        lastFilledPasswords: [{ DOMelement: pass, value: passwort }]
    } as any);
    saving.addSubmitHandler(null, form);
    const submit = () => form.dispatchEvent(new Event("submit", { cancelable: true }));
    return { pass, port, submit };
}

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
        expect(msg.submittedData.fields.find((f: any) => f.type === "password").value).toBe("test6");
    });
});
