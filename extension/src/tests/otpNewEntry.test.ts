import { describe, expect, it, vi } from "vitest";

vi.mock("../background/KF", () => ({ ferry: {} }));
vi.mock("jsqr", () => ({ default: () => null }));

import { newEntryFields } from "../background/otpSetup";
import { Entry } from "../common/model/Entry";
import { FormFieldTypeDTO } from "../common/model/PluginDTOs";

// #54: neuer Eintrag aus der Zwei-Faktor-Einrichtung; die Felder müssen sich für AddLogin umwandeln lassen
const toDto = (fields: { name: string; type: string; value: string }[]) =>
    Entry.toPluginEntryDTO(new Entry({ title: "Spielwiese", URLs: ["http://localhost:8081/"], fields: newEntryFields(fields as any) }));

describe("newEntryFields", () => {
    it("Benutzername und Passwort werden zu Benutzername- und Passwortfeld", () => {
        const dto = toDto([
            { name: "KeePass username", type: "text", value: "Testkonto" },
            { name: "KeePass password", type: "password", value: "geheim" }
        ]);
        expect(dto.formFieldList.map(f => [f.type, f.value])).toEqual([
            [FormFieldTypeDTO.username, "Testkonto"],
            [FormFieldTypeDTO.password, "geheim"]
        ]);
    });

    it("lässt leere Felder weg", () => {
        const dto = toDto([
            { name: "KeePass username", type: "text", value: "Testkonto" },
            { name: "KeePass password", type: "password", value: "" }
        ]);
        expect(dto.formFieldList.map(f => f.type)).toEqual([FormFieldTypeDTO.username]);
    });

    it("nur Passwort: bleibt ein Passwortfeld", () => {
        const dto = toDto([
            { name: "KeePass password", type: "password", value: "geheim" },
            { name: "KeePass username", type: "text", value: "" }
        ]);
        expect(dto.formFieldList.map(f => f.type)).toEqual([FormFieldTypeDTO.password]);
    });

    it("Benutzername steht vor dem Passwort, auch in anderer Reihenfolge", () => {
        const dto = toDto([
            { name: "KeePass password", type: "password", value: "geheim" },
            { name: "KeePass username", type: "text", value: "Testkonto" }
        ]);
        expect(dto.formFieldList.map(f => f.type)).toEqual([FormFieldTypeDTO.username, FormFieldTypeDTO.password]);
    });
});
