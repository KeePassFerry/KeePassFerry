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
