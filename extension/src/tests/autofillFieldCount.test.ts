import { describe, expect, test } from "vitest";
import { autofillFieldCount } from "../page/autofillFieldCount";

describe("autofillFieldCount", () => {
    test("versteckte Felder zählen nicht (#45: Benutzer, Passwort, drei versteckte Textfelder)", () => {
        const fields = [
            { type: "password", id: "pw" },
            { type: "text", id: "user" },
            { type: "text", id: "hidden1" },
            { type: "text", id: "captcha" },
            { type: "text", id: "hidden2" }
        ];
        expect(autofillFieldCount(fields, [true, true, false, false, false])).toBe(2);
    });
    test("ohne Sichtbarkeitsangabe zählen alle", () => {
        expect(autofillFieldCount([{ type: "text", id: "a" }, { type: "password", name: "b" }], [])).toBe(2);
    });
    test("gilt keines als sichtbar, zählen wie bisher alle", () => {
        expect(autofillFieldCount([{ type: "text", id: "a" }, { type: "password", id: "b" }], [false, false])).toBe(2);
    });
    test("Felder ohne id und name sowie andere Typen zählen nicht", () => {
        expect(autofillFieldCount([{ type: "text" }, { type: "checkbox", id: "c" }, { type: "password", id: "p" }], [true, true, true])).toBe(1);
    });
});
