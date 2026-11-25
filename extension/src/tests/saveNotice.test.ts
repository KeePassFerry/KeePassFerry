// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hideSaveNotice, showSaveNotice } from "../page/SaveNotice";

const notice = () => document.getElementById("keepassferry-save-notice");

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
});

afterEach(() => {
    vi.useRealTimers();
});

describe("hideSaveNotice", () => {
    it("schließt mit Art nur einen Hinweis dieser Art", () => {
        showSaveNotice("login");
        hideSaveNotice("otp");
        expect(notice()).not.toBeNull();
        hideSaveNotice("login");
        expect(notice()).toBeNull();
    });

    it("schließt den Zwei-Faktor-Hinweis", () => {
        showSaveNotice("otp", "Testseite");
        expect(notice()?.dataset.kind).toBe("otp");
        hideSaveNotice("otp");
        expect(notice()).toBeNull();
    });

    it("schließt ohne Art jeden Hinweis", () => {
        showSaveNotice("otp", "Testseite");
        hideSaveNotice();
        expect(notice()).toBeNull();
    });
});

// #53: Dialoge der Seite schließen sich bei pointerdown/mousedown/focusin außerhalb; der Hinweis zählt nicht als außerhalb
describe("Hinweis und Ereignisse der Seite", () => {
    it("lässt Zeiger- und Fokusereignisse nicht zur Seite durch, Klicks schon", () => {
        const seen: string[] = [];
        const types = ["pointerdown", "mousedown", "mouseup", "focusin", "click"];
        for (const t of types) {
            document.addEventListener(t, () => seen.push("document " + t));
            document.addEventListener(t, () => seen.push("document capture " + t), true);
        }
        showSaveNotice("otp", "Testseite");
        const host = notice();
        for (const t of types) {
            host.dispatchEvent(new Event(t, { bubbles: true, composed: true, cancelable: true }));
        }
        expect(seen).toEqual(["document capture click", "document click"]);
    });

    it("verhindert bei mousedown den Fokuswechsel, außerhalb des Hinweises nicht", () => {
        showSaveNotice("otp", "Testseite");
        const onHint = new Event("mousedown", { bubbles: true, composed: true, cancelable: true });
        notice().dispatchEvent(onHint);
        expect(onHint.defaultPrevented).toBe(true);

        const elsewhere = new Event("mousedown", { bubbles: true, composed: true, cancelable: true });
        document.body.dispatchEvent(elsewhere);
        expect(elsewhere.defaultPrevented).toBe(false);
    });
});
