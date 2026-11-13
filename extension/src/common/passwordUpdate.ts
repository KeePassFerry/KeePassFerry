import { Entry } from "./model/Entry";
import { Field } from "./model/Field";
import { Locator } from "./model/Locator";

/*
passwordUpdate.ts: "Aktualisieren" im Seitenhinweis "Neues Passwort erkannt" speichert direkt, ohne Bearbeiten-Fenster.
Geändert wird nur das Passwort des Eintrags; Titel, Benutzername, Adressen und übrige Felder bleiben, wie sie sind
(das alte Passwort legt KeePass in der Chronik des Eintrags ab). Ein mitgeschicktes Website-Symbol übernimmt das
Plugin nur bei Einträgen mit dem Standard-Schlüssel (#43).
*/

// Kopie des Eintrags mit neuem Passwort, in der Form, die das Plugin beim Aktualisieren erwartet
export function entryWithNewPassword(entry: Entry, password: string, favicon: string = null): Entry {
    const fields = (entry.fields ?? []).map(f => new Field({ ...f }));
    const index = fields.findIndex(f => f.name === "KeePass password");
    const target = index >= 0 ? index : fields.findIndex(f => f.type === "password");
    if (target >= 0) {
        fields[target] = new Field({ ...fields[target], value: password });
    } else {
        // Eintrag ohne Passwort: KeePass liefert leere Felder nicht mit
        const afterUsername = fields.findIndex(f => f.name === "KeePass username") + 1;
        fields.splice(afterUsername, 0, new Field({ name: "KeePass password", type: "password", value: password, locators: [new Locator({ type: "password" })] }));
    }
    return new Entry(
        Object.assign(Object.assign({} as Entry, entry) as Entry, {
            fields,
            // Erwartung des Plugins beim Aktualisieren (wie beim Speichern aus dem Bearbeiten-Fenster)
            parentGroup: undefined,
            uuid: null,
            database: undefined,
            icon: favicon ? { version: 1, iconImageData: favicon } : null
        })
    );
}
