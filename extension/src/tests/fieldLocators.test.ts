import { describe, expect, it } from "vitest";
import { extraFields, sameFieldTarget } from "../common/fieldLocators";
import { addPageField } from "../popup/addPageField";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";

const field = (type: "text" | "password", value: string, id: string, name = "") =>
    new Field({ type, value, name: id, locators: [new Locator({ id, name, type })] });

describe("sameFieldTarget", () => {
    it("verlangt eine gleiche, nicht leere Kennung", () => {
        expect(sameFieldTarget({ id: "pin", name: "" }, { id: "pin", name: "x" })).toBe(true);
        expect(sameFieldTarget({ id: "a", name: "pin" }, { id: "b", name: "pin" })).toBe(true);
        expect(sameFieldTarget({ id: "", name: "" }, { id: "", name: "" })).toBe(false);
        expect(sameFieldTarget({ id: "suche", name: "q" }, { id: "pin", name: "pin" })).toBe(false);
    });
});

describe("extraFields", () => {
    it("lässt Benutzername und Passwort aus", () => {
        const fields = [field("text", "max", "user"), field("password", "geheim", "pw"), field("text", "1234", "pin"), field("password", "x", "pw2")];
        expect(extraFields(fields).map(f => f.locators[0].id)).toEqual(["pin", "pw2"]);
    });
});

describe("addPageField", () => {
    const entry = [field("text", "max", "user"), field("password", "geheim", "pw")];

    it("hängt ein neues Feld an", () => {
        const result = addPageField(entry, field("text", "1234", "pin"));
        expect(result.map(f => f.locators[0].id)).toEqual(["user", "pw", "pin"]);
    });

    it("gibt einem bekannten Feld den neuen Wert und behält den alten zum Zurücksetzen", () => {
        const result = addPageField([...entry, field("text", "1234", "pin")], field("text", "9999", "pin"));
        expect(result).toHaveLength(3);
        expect(result[2].value).toBe("9999");
        expect(result[2].resetValue).toBe("1234");
    });

    it("überschreibt ein bekanntes Feld nicht mit einem leeren Wert", () => {
        const known = [...entry, field("text", "1234", "pin")];
        expect(addPageField(known, field("text", "", "pin"))).toBe(known);
    });
});
