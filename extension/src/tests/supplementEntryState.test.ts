import { describe, expect, it } from "vitest";
import { supplementEntryState, supplementExistingEntry } from "../popup/supplementEntryState";
import { Entry } from "../common/model/Entry";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";
import { SaveState } from "../common/SaveState";

function entry() {
    return new Entry({
        URLs: ["https://example.com/login"],
        title: "Beispiel",
        fields: [
            new Field({ name: "KeePass username", type: "text", value: "nutzer", locators: [new Locator({ type: "text" })] }),
            new Field({ name: "KeePass password", type: "password", value: "geheim", locators: [new Locator({ type: "password" })] })
        ]
    });
}

describe("supplementEntryState", () => {
    // Bearbeiten ohne übermittelte Daten: Änderungen im Bearbeiten-Fenster dürfen den Eintrag der Trefferliste nicht verändern
    it("liefert eigene Kopien von Feldern und Adressen", () => {
        const original = entry();
        const edited = supplementEntryState(original, { submittedData: null } as SaveState, original.URLs);
        edited.fields.splice(0, 1);
        edited.URLs.push("https://other.example");
        expect(original.fields.length).toBe(2);
        expect(original.fields[0].value).toBe("nutzer");
        expect(original.URLs).toEqual(["https://example.com/login"]);
    });

    it("liefert eigene Kopien auch ohne Adressliste", () => {
        const original = entry();
        const edited = supplementEntryState(original, {} as SaveState);
        edited.fields[1].value = "neu";
        expect(original.fields[1].value).toBe("geheim");
        expect(edited.fields.length).toBe(2);
    });
});

describe("supplementExistingEntry", () => {
    const abgeschickt = {
        url: "https://example.com/login",
        title: "Anmelden – Beispiel GmbH",
        fields: [
            new Field({ name: "user", type: "text", value: "nutzer", locators: [new Locator({ type: "text", id: "user" })] }),
            new Field({ name: "pass", type: "password", value: "neu", locators: [new Locator({ type: "password", id: "pass" })] })
        ]
    };

    it("übernimmt das neue Passwort, behält aber den Titel des Eintrags", () => {
        const original = entry();
        const edited = supplementExistingEntry(original, { submittedData: abgeschickt } as SaveState, original.URLs);
        expect(edited.title).toBe("Beispiel");
        const passwort = edited.fields.find(f => f.type === "password");
        expect(passwort.value).toBe("neu");
        expect(passwort.resetValue).toBe("geheim");
    });

    it("ohne abgeschickte Daten bleibt alles wie beim normalen Bearbeiten", () => {
        const original = entry();
        const edited = supplementExistingEntry(original, { submittedData: null } as SaveState, original.URLs);
        expect(edited.title).toBe("Beispiel");
        expect(edited.fields.find(f => f.type === "password").value).toBe("geheim");
    });
});
