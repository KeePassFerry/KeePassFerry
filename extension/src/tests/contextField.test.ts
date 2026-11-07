// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../common/ConfigManager", () => ({ configManager: { current: {} } }));

import { describeContextTarget, trackContextTarget } from "../page/fieldFill";

beforeAll(() => trackContextTarget());

function rightClick(html: string) {
    document.body.innerHTML = html;
    const el = document.body.firstElementChild;
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));
    return describeContextTarget();
}

describe("describeContextTarget", () => {
    it("liefert Kennung, Beschriftung und Wert eines nicht erkannten Felds", () => {
        const { field, problem } = rightClick("<input id=\"pin\" name=\"kunden_pin\" aria-label=\"Ihre PIN\" value=\"1234\">");
        expect(problem).toBeUndefined();
        expect(field.value).toBe("1234");
        expect(field.type).toBe("text");
        expect(field.name).toBe("ihre pin");
        expect(field.locators[0]).toMatchObject({ id: "pin", name: "kunden_pin" });
    });

    it("behält bei einem Passwortfeld den Typ", () => {
        expect(rightClick("<input id=\"pin\" type=\"password\" value=\"1234\">").field.type).toBe("password");
    });

    it("lehnt ein Feld ohne Kennung ab", () => {
        expect(rightClick("<input value=\"1234\">")).toEqual({ problem: "noIdentifier" });
    });

    it("lehnt ein Codefeld ab", () => {
        expect(rightClick("<input id=\"otp\" autocomplete=\"one-time-code\">")).toEqual({ problem: "otp" });
    });

    it("lehnt mehrzeilige und schreibgeschützte Felder ab", () => {
        expect(rightClick("<textarea id=\"t\"></textarea>")).toEqual({ problem: "noTarget" });
        expect(rightClick("<input id=\"r\" readonly value=\"x\">")).toEqual({ problem: "noTarget" });
    });
});
