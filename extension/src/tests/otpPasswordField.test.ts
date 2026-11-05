// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isOtpField } from "../page/OtpFields";

function input(attrs: Record<string, string>): HTMLInputElement {
    const el = document.createElement("input");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
}

describe("Codefeld als Passwortfeld", () => {
    it("Passwortfeld mit eindeutigem Code-Namen ist ein Codefeld (Sharekhan: name=totp)", () => {
        expect(isOtpField(input({ type: "password", name: "totp", autocomplete: "off" }))).toBe(true);
        expect(isOtpField(input({ type: "password", autocomplete: "one-time-code" }))).toBe(true);
    });

    it("normales Passwortfeld und allgemeine Namen bleiben Passwortfelder", () => {
        expect(isOtpField(input({ type: "password", name: "password" }))).toBe(false);
        expect(isOtpField(input({ type: "password", name: "pin" }))).toBe(false);
        expect(isOtpField(input({ type: "password", name: "code" }))).toBe(false);
    });

    it("SMS-Code im Passwortfeld ist kein TOTP", () => {
        expect(isOtpField(input({ type: "password", name: "sms_otp" }))).toBe(false);
    });
});
