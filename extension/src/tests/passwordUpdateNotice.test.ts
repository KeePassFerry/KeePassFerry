// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../common/port", () => ({ Port: { postMessage: vi.fn() } }));

import { Port } from "../common/port";
import { cancelPasswordUpdateNotice, offerPasswordUpdateNotice, withdrawSaveNotice } from "../page/passwordUpdateNotice";
import { hideSaveNotice, showSaveNotice } from "../page/SaveNotice";

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
    vi.mocked(Port.postMessage).mockClear();
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
        expect(Port.postMessage).not.toHaveBeenCalled();
    });

    it("bietet nichts an und meldet den Fehlversuch, wenn das Anmeldeformular stehen bleibt", () => {
        const input = addVisiblePasswordField();
        offerPasswordUpdateNotice("max@example.com");
        vi.advanceTimersByTime(11000);
        expect(Port.postMessage).toHaveBeenCalledTimes(1);
        expect(Port.postMessage).toHaveBeenCalledWith({ action: "passwordUpdateNotShown" });
        input.remove();
        vi.advanceTimersByTime(5000);
        expect(notice()).toBeNull();
    });
});

describe("withdrawSaveNotice", () => {
    it("schließt einen gezeigten Hinweis zum Speichern bzw. Aktualisieren", () => {
        offerPasswordUpdateNotice("max@example.com");
        withdrawSaveNotice();
        expect(notice()).toBeNull();
        showSaveNotice("login");
        withdrawSaveNotice();
        expect(notice()).toBeNull();
    });

    it("beendet das Warten, ohne später etwas anzuzeigen oder zu melden", () => {
        const input = addVisiblePasswordField();
        offerPasswordUpdateNotice("max@example.com");
        withdrawSaveNotice();
        input.remove();
        vi.advanceTimersByTime(15000);
        expect(notice()).toBeNull();
        expect(Port.postMessage).not.toHaveBeenCalled();
    });

    it("lässt einen Zwei-Faktor-Hinweis stehen", () => {
        showSaveNotice("otp", "Testseite");
        withdrawSaveNotice();
        expect(notice()?.dataset.kind).toBe("otp");
    });
});
