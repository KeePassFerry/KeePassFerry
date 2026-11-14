import { describe, expect, it } from "vitest";
import { passkeyGroupChoices } from "../common/passkeyGroups";

const db = {
    fileName: "a.kdbx",
    name: "Privat",
    root: {
        uuid: "r",
        title: "Privat",
        groups: [
            { uuid: "i", title: "Internet", path: "Internet", groups: [{ uuid: "s", title: "Shopping", path: "Internet/Shopping" }] },
            { uuid: "b", title: "Bank", path: "Bank" }
        ]
    }
};
const PRIMARY = "{<{{<<ferry-primary>>}}>}";

describe("Gruppe für einen neuen Passkey-Eintrag", () => {
    it("listet alle Gruppen in Baumreihenfolge mit Pfad", () => {
        const r = passkeyGroupChoices([db], 0, {}, false);
        expect(r.groups.map(g => g.label)).toEqual(["Privat", "Internet", "Internet › Shopping", "Bank"]);
    });

    it("liefert den Baum: eigener Name, Ebene und übergeordnete Gruppe", () => {
        const r = passkeyGroupChoices([db], 0, {}, false);
        expect(r.groups.map(g => [g.name, g.depth, g.parentKey, g.hasChildren])).toEqual([
            ["Privat", 0, "", true],
            ["Internet", 1, "a.kdbx|r", true],
            ["Shopping", 2, "a.kdbx|i", false],
            ["Bank", 1, "a.kdbx|r", false]
        ]);
    });

    it("mehrere Datenbanken: Gruppen beider Datenbanken, jeweils mit Datenbanknamen davor", () => {
        const second = { fileName: "b.kdbx", name: "Familie", root: { uuid: "r2", title: "Familie", groups: [{ uuid: "v", title: "Versicherung", path: "Versicherung" }] } };
        const r = passkeyGroupChoices([db, second], 1, {}, false);
        expect(r.groups.map(g => g.label)).toEqual([
            "Privat", "Privat › Internet", "Privat › Internet › Shopping", "Privat › Bank", "Familie", "Familie › Versicherung"
        ]);
        // Ohne gemerkte Gruppe: Wurzel der aktiven Datenbank
        expect(r.preferredKey).toBe("b.kdbx|r2");
    });

    it("ohne zuletzt benutzte Gruppe: Wurzel vorausgewählt, es wird gefragt", () => {
        const r = passkeyGroupChoices([db], 0, {}, true);
        expect(r.preferredKey).toBe("a.kdbx|r");
        expect(r.ask).toBe(true);
    });

    it("zuletzt benutzte Gruppe vorausgewählt; gefragt wird nur, wenn \"Gruppe merken\" aus ist", () => {
        expect(passkeyGroupChoices([db], 0, { [PRIMARY]: "s" }, false)).toMatchObject({ preferredKey: "a.kdbx|s", ask: true });
        expect(passkeyGroupChoices([db], 0, { [PRIMARY]: "s" }, true)).toMatchObject({ preferredKey: "a.kdbx|s", ask: false });
    });

    it("gelöschte zuletzt benutzte Gruppe zählt nicht; schreibgeschützte Datenbanken fehlen", () => {
        expect(passkeyGroupChoices([db], 0, { [PRIMARY]: "weg" }, true)).toMatchObject({ preferredKey: "a.kdbx|r", ask: true });
        const ro = { ...db, fileName: "ro.kdbx", readOnly: true };
        const r = passkeyGroupChoices([ro, db], 0, {}, false);
        expect(r.groups.every(g => g.dbFileName === "a.kdbx")).toBe(true);
        expect(r.preferredKey).toBe("a.kdbx|r");
    });
});
