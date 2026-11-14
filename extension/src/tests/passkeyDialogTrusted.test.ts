// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { showPasskeyDialog, type DialogResult } from "../page/PasskeyDialog";

// GHSA-3v3v-566f-2q4x: von Seitenskripten ausgelöste Ereignisse dürfen den Passkey-Dialog nicht bestätigen
beforeAll(() => {
    (globalThis as any).$STR = (key: string) => key;
    // Geschlossenen Shadow DOM im Test öffnen, damit die Knöpfe erreichbar sind
    const attach = HTMLElement.prototype.attachShadow;
    HTMLElement.prototype.attachShadow = function (init: ShadowRootInit) {
        return attach.call(this, { ...init, mode: "open" });
    };
});

afterEach(() => document.body.replaceChildren());

function open() {
    let result: DialogResult | "offen" = "offen";
    showPasskeyDialog({
        heading: "Anmelden",
        subheading: "example.org",
        question: "Passkey wählen",
        items: [{ key: "demo", title: "Demo", subtitle: "Testnutzer" }],
        selectedKey: "demo",
        primaryLabel: () => "Anmelden"
    }).then(r => (result = r));
    const shadow = document.getElementById("keepassferry-passkey-dialog").querySelector("div").shadowRoot;
    return { shadow, result: async () => (await Promise.resolve(), result) };
}

describe("Passkey-Dialog nimmt nur echte Eingaben an", () => {
    it("Enter aus einem Seitenskript bestätigt nicht", async () => {
        const d = open();
        const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        expect(event.isTrusted).toBe(false);
        document.dispatchEvent(event);
        expect(await d.result()).toBe("offen");
    });

    it("Klick, Doppelklick und Escape aus einem Seitenskript wirken nicht", async () => {
        const d = open();
        (d.shadow.querySelector("button.primary") as HTMLButtonElement).click();
        d.shadow.querySelector("button.item").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(await d.result()).toBe("offen");
        expect(document.getElementById("keepassferry-passkey-dialog")).not.toBeNull();
    });
});
