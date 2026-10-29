// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelPasswordUpdateNotice, offerPasswordUpdateNotice } from "../page/passwordUpdateNotice";
import { hideSaveNotice } from "../page/SaveNotice";

const notice = () => document.getElementById("keepassferry-save-notice");

// jsdom berechnet kein Layout: Passwortfeld als sichtbar ausgeben
function addVisiblePasswordField() {
    const input = document.createElement("input");
    input.type = "password";
    Object.defineProperty(input, "offsetWidth", { value: 120 });
    Object.defineProperty(input, "offsetHeight", { value: 24 });
    document.body.appendChild(input);
    return input;
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
});

afterEach(() => {
    cancelPasswordUpdateNotice();
    hideSaveNotice();
    vi.useRealTimers();
});

describe("offerPasswordUpdateNotice", () => {
    it("zeigt den Hinweis sofort, wenn kein Anmeldeformular zu sehen ist", () => {
        offerPasswordUpdateNotice("max@example.com");
        expect(notice()?.dataset.kind).toBe("update");
    });

    it("wartet, solange ein Passwortfeld zu sehen ist (z. B. Anmeldung ohne Neuladen)", () => {
        const input = addVisiblePasswordField();
        offerPasswordUpdateNotice("max@example.com");
        expect(notice()).toBeNull();
        vi.advanceTimersByTime(3000);
        expect(notice()).toBeNull();
        input.remove();
        vi.advanceTimersByTime(1000);
        expect(notice()?.dataset.kind).toBe("update");
    });

    it("bietet nichts an, wenn das Anmeldeformular stehen bleibt (Anmeldung fehlgeschlagen)", () => {
        const input = addVisiblePasswordField();
        offerPasswordUpdateNotice("max@example.com");
        vi.advanceTimersByTime(11000);
        input.remove();
        vi.advanceTimersByTime(5000);
        expect(notice()).toBeNull();
    });
});
