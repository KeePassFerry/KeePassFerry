import { describe, expect, it } from "vitest";
import { Field } from "../common/model/Field";
import { FormFieldTypeDTO } from "../common/model/PluginDTOs";

// #50: Werte aus in KeePass geschützten Feldern werden verdeckt angezeigt, auch wenn das Feld auf der Seite ein Textfeld ist
describe("Geschützte Formularfelder", () => {
    const dto = (isProtected?: boolean) =>
        ({ displayName: "Kundennummer", name: "kundennummer", id: "kdnr", type: FormFieldTypeDTO.text, value: "4711", page: 1, protected: isProtected }) as any;

    it("übernimmt das Kennzeichen des Plugins und verdeckt den Wert", () => {
        const f = Field.fromPluginFieldDTO(dto(true));
        expect(f.isProtected).toBe(true);
        expect(f.type).toBe("text");
        expect(Field.getDisplayValue(f, false)).toBe("****");
        expect(Field.getDisplayValue(f, true)).toBe("4711");
    });

    it("ungeschützte Felder und ältere Plugins ohne Kennzeichen bleiben im Klartext", () => {
        expect(Field.getDisplayValue(Field.fromPluginFieldDTO(dto(false)), false)).toBe("4711");
        expect(Field.getDisplayValue(Field.fromPluginFieldDTO(dto(undefined)), false)).toBe("4711");
    });

    it("das Kennzeichen bleibt beim Kopieren eines Felds erhalten", () => {
        const copy = new Field({ ...Field.fromPluginFieldDTO(dto(true)), value: "neu" });
        expect(copy.isProtected).toBe(true);
    });
});
