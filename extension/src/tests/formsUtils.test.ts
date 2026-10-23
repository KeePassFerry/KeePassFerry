// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { FormUtils } from "../page/formsUtils";
import { findUsernameField } from "../page/loginFields";

const logger = { debug: () => {} } as any;

// jsdom berechnet kein Layout; die Erkennung zählt nur sichtbare Felder
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
});

const usernameOf = (result: ReturnType<FormUtils["getFormFields"]>) =>
    result.otherFields[result.actualUsernameIndex].DOMelement.id;

describe("getFormFields", () => {
    it("includes fields from open shadow roots hosted inside the form", () => {
        document.body.innerHTML = `
            <form>
                <input id="input-username" type="email" autocomplete="username">
                <lux-password></lux-password>
            </form>`;
        const shadowRoot = document.querySelector("lux-password").attachShadow({ mode: "open" });
        shadowRoot.innerHTML = "<input id='password' type='password'>";

        const result = new FormUtils(logger).getFormFields(document.forms[0], false, 50);

        expect(result.pwFields.map(f => f.DOMelement)).toEqual([shadowRoot.getElementById("password")]);
        expect(usernameOf(result)).toBe("input-username");
    });

    it("treats a field with autocomplete=username as the username field", () => {
        document.body.innerHTML = `
            <form>
                <input id="search" type="text">
                <input id="input-username" type="email" autocomplete="username">
            </form>`;

        const result = new FormUtils(logger).getFormFields(document.forms[0], false, 50);

        expect(result.pwFields).toEqual([]);
        expect(usernameOf(result)).toBe("input-username");
    });

    // Registrierung wie bei SourceForge: Name, E-Mail und Benutzername vor dem Passwort
    const registration = `
        <form>
            <input id="fullname" name="name" type="text" autocomplete="name">
            <input id="email" name="email" type="email" autocomplete="email">
            <input id="username" name="username" type="text" autocomplete="username">
            <input id="password" name="password" type="password" autocomplete="new-password">
            <input id="confirm" name="password_confirm" type="password" autocomplete="new-password">
            <input id="phone" name="phone" type="text" autocomplete="work tel-national">
        </form>`;

    it("saves the declared username field, not the name or e-mail field, of a registration form", () => {
        document.body.innerHTML = registration;
        const result = new FormUtils(logger).getFormFields(document.forms[0], false, 50);
        expect(usernameOf(result)).toBe("username");
    });

    it("fills the declared username field of a registration form", () => {
        document.body.innerHTML = registration;
        expect(findUsernameField().id).toBe("username");
    });

    it("uses the text field right before the password when nothing is declared", () => {
        document.body.innerHTML = `
            <form>
                <input id="name" name="name" type="text">
                <input id="login" name="acct" type="text">
                <input id="password" type="password">
            </form>`;
        const result = new FormUtils(logger).getFormFields(document.forms[0], false, 50);
        expect(usernameOf(result)).toBe("login");
    });

    it("still treats an e-mail field as the username when the form has no username field", () => {
        document.body.innerHTML = `
            <form>
                <input id="email" type="email" autocomplete="email">
                <input id="password" type="password" autocomplete="current-password">
            </form>`;
        const result = new FormUtils(logger).getFormFields(document.forms[0], false, 50);
        expect(usernameOf(result)).toBe("email");
        expect(findUsernameField().id).toBe("email");
    });
});
