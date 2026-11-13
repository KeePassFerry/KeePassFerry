import { describe, expect, it } from "vitest";
import { entryWithNewPassword } from "../common/passwordUpdate";
import { Entry } from "../common/model/Entry";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";

function entry(withPassword = true) {
    const fields = [new Field({ name: "KeePass username", type: "text", value: "nutzer", locators: [new Locator({ type: "text", id: "user" })] })];
    if (withPassword) fields.push(new Field({ name: "KeePass password", type: "password", value: "alt", locators: [new Locator({ type: "password", id: "pass" })] }));
    fields.push(new Field({ name: "Kundennummer", type: "text", value: "4711", locators: [new Locator({ type: "text", id: "kd" })] }));
    return new Entry({ uuid: "u1", title: "Beispiel", URLs: ["https://example.com/login", "https://login.example.org/"], fields });
}

describe("Passwort direkt aktualisieren", () => {
    it("ändert nur das Passwort", () => {
        const original = entry();
        const updated = entryWithNewPassword(original, "neu");
        expect(updated.fields.map(f => [f.name, f.value])).toEqual([["KeePass username", "nutzer"], ["KeePass password", "neu"], ["Kundennummer", "4711"]]);
        expect(updated.title).toBe("Beispiel");
        expect(updated.URLs).toEqual(["https://example.com/login", "https://login.example.org/"]);
        expect(updated.fields[1].locators[0].id).toBe("pass");
    });

    it("lässt den übergebenen Eintrag unverändert", () => {
        const original = entry();
        entryWithNewPassword(original, "neu");
        expect(original.fields[1].value).toBe("alt");
        expect(original.uuid).toBe("u1");
    });

    it("ergänzt das Passwortfeld hinter dem Benutzernamen, wenn der Eintrag keines hat", () => {
        const updated = entryWithNewPassword(entry(false), "neu");
        expect(updated.fields.map(f => f.name)).toEqual(["KeePass username", "KeePass password", "Kundennummer"]);
        expect(updated.fields[1].value).toBe("neu");
    });

    it("übergibt dem Plugin weder die Kennung noch die Gruppe des Eintrags", () => {
        const updated = entryWithNewPassword(entry(), "neu");
        expect(updated.uuid).not.toBe("u1");
        expect(updated.parentGroup).toBeNull();
    });

    it("schickt das bisherige Symbol nicht mit, ein Website-Symbol nur wenn übergeben", () => {
        const original = new Entry({ ...entry(), icon: { version: 1, iconImageData: "ALT" } });
        expect(entryWithNewPassword(original, "neu").icon.iconImageData).toBe("");
        expect(entryWithNewPassword(original, "neu", "SEITE").icon.iconImageData).toBe("SEITE");
    });
});
