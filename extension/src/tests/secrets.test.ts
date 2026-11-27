import { describe, expect, it } from "vitest";
import { Entry } from "../common/model/Entry";
import { Field } from "../common/model/Field";
import { EntrySummary } from "../common/model/EntrySummary";
import { Locator } from "../common/model/Locator";
import { fieldHasValue, omitSecrets, secretsAllowedFor } from "../common/secrets";

// #56: Treffer für Seiten ohne Passwörter und geschützte Werte; Werte erst beim Ausfüllen
const field = (name: string, type: "text" | "password", value: string, isProtected = false) =>
    new Field({ name, type, value, resetValue: value, isProtected, locators: [new Locator({ type })] });

const entry = () =>
    new Entry({
        uuid: "u1",
        title: "Spielwiese",
        database: { fileName: "db.kdbx" } as any,
        parentGroup: { path: "Internet" } as any,
        fields: [
            field("KeePass username", "text", "alice"),
            field("KeePass password", "password", "geheim"),
            field("PIN", "text", "1234", true),
            field("Land", "text", "DE")
        ]
    });

describe("omitSecrets", () => {
    it("leert Passwort und geschützte Felder, markiert sie und lässt den Rest", () => {
        const e = omitSecrets(entry());
        expect(e.fields.map(f => [f.name, f.value, f.resetValue, !!f.valueOmitted])).toEqual([
            ["KeePass username", "alice", "alice", false],
            ["KeePass password", "", "", true],
            ["PIN", "", "", true],
            ["Land", "DE", "DE", false]
        ]);
        expect(e.secretsOmitted).toBe(true);
        expect(JSON.stringify(e)).not.toContain("geheim");
        expect(JSON.stringify(e)).not.toContain("1234");
    });

    it("leere Werte bleiben unmarkiert; Eintrag ohne Geheimnisse gilt nicht als gekürzt", () => {
        const e = omitSecrets(new Entry({ fields: [field("KeePass username", "text", "bob"), field("KeePass password", "password", "")] }));
        expect(e.fields[1].valueOmitted).toBe(false);
        expect(e.secretsOmitted).toBe(false);
    });

    it("weggelassene Werte zählen als vorhanden (Bewertung, Menüpunkt Passwort)", () => {
        const e = omitSecrets(entry());
        expect(fieldHasValue(Entry.getPasswordField(e))).toBe(true);
        expect(fieldHasValue(field("leer", "password", ""))).toBe(false);
    });

    it("Kennzeichen übersteht Kopien wie in der Seite (new Entry({...e})) und Nachrichten (JSON)", () => {
        const e = omitSecrets(entry());
        expect(new Entry({ ...e }).secretsOmitted).toBe(true);
        expect(new Entry(JSON.parse(JSON.stringify(e))).secretsOmitted).toBe(true);
        // Werte geholt: Felder ersetzt, Kennzeichen weg
        expect(new Entry({ ...e, fields: entry().fields, secretsOmitted: false }).secretsOmitted).toBe(false);
    });

    it("Popup: Zusammenfassung ohne Details (werden beim Aufklappen geholt), Gruppe trotzdem bekannt", () => {
        const s = EntrySummary.fromEntry(omitSecrets(entry()));
        expect(s.fullDetails).toBeUndefined();
        expect(s.path).toBe("Internet");
        expect(EntrySummary.fromEntry(entry()).fullDetails).toBeDefined();
    });
});

describe("secretsAllowedFor", () => {
    const frame = { urlEntries: [omitSecrets(entry())], entries: [new Entry({ uuid: "fremd", database: { fileName: "db.kdbx" } as any })] };

    it("erlaubt nur Treffer, die der Hintergrund für den Frame gefunden hat", () => {
        expect(secretsAllowedFor(frame, { uuid: "u1", dbFileName: "db.kdbx" })).toBe(true);
        expect(secretsAllowedFor(frame, { uuid: "fremd", dbFileName: "db.kdbx" })).toBe(false);
        expect(secretsAllowedFor(frame, { uuid: "u1", dbFileName: "andere.kdbx" })).toBe(false);
        expect(secretsAllowedFor(undefined, { uuid: "u1", dbFileName: "db.kdbx" })).toBe(false);
        expect(secretsAllowedFor({ urlEntries: [] }, { uuid: "u1", dbFileName: "db.kdbx" })).toBe(false);
    });
});
