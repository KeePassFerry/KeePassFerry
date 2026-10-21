// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FormUtils } from "../page/formsUtils";

const logger = { debug: () => {} } as any;

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
        expect(result.otherFields[result.actualUsernameIndex].DOMelement.id).toBe("input-username");
    });

    it("treats a field with autocomplete=username as the username field", () => {
        document.body.innerHTML = `
            <form>
                <input id="search" type="text">
                <input id="input-username" type="email" autocomplete="username">
            </form>`;

        const result = new FormUtils(logger).getFormFields(document.forms[0], false, 50);

        expect(result.pwFields).toEqual([]);
        expect(result.otherFields[result.actualUsernameIndex].DOMelement.id).toBe("input-username");
    });
});
