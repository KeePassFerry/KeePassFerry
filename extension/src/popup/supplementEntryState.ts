import { SaveState } from "../common/SaveState";
import { Entry } from "../common/model/Entry";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";
import { reconcileFieldLists } from "./reconcileFieldLists";

export function supplementEntryState(entry: Entry, saveState: SaveState, urls?: string[]) {
    const sd = saveState.submittedData;
    const submittedFields = sd ? sd.fields : [];
    // Vor dem Abgleich ergänzen: hier tragen die Felder noch die Namen aus KeePass
    const entryFields = withStandardFields(JSON.parse(JSON.stringify(entry.fields)));
    const newFields = reconcileFieldLists(
        JSON.parse(JSON.stringify(entryFields)),
        submittedFields
    );
    const overwriteWithSubmittedData = (sd
        ? {
              URLs: [sd.url],
              fields: newFields,
              title: sd.title,
              ...(sd.httpRealm ? { httpRealm: sd.httpRealm } : {})
          }
        : {}) as Entry;
    const overwriteWithURLs = (urls
        ? {
              URLs: [...urls]
          }
        : {}) as Entry;
    // Immer eigene Kopien von Feldern und Adressen: sonst ändert das Bearbeiten-Fenster (z. B. Feld entfernen)
    // auch den Eintrag in der Trefferliste, solange keine übermittelten Daten einfließen
    const ownCopies = { fields: entryFields, URLs: [...(entry.URLs ?? [])] } as Entry;
    return Object.assign({}, entry, ownCopies, overwriteWithSubmittedData, overwriteWithURLs);
}

// KeePass liefert leere Felder nicht mit: Ein Eintrag ohne Passwort (oder ohne Benutzername) hätte im
// Bearbeiten-Fenster sonst kein Feld dafür, und ein geleertes ließe sich nie wieder füllen.
export function withStandardFields(fields: Field[]): Field[] {
    const result = [...(fields ?? [])];
    if (!result.some(f => f.name === "KeePass username")) {
        result.unshift(new Field({ name: "KeePass username", type: "text", locators: [new Locator({ type: "text" })] }));
    }
    if (!result.some(f => f.name === "KeePass password")) {
        const afterUsername = result.findIndex(f => f.name === "KeePass username") + 1;
        result.splice(afterUsername, 0, new Field({ name: "KeePass password", type: "password", locators: [new Locator({ type: "password" })] }));
    }
    return result;
}

// Vorhandenen Eintrag mit gerade abgeschickten Anmeldedaten derselben Website bearbeiten (Passwort geändert):
// Felder und Adressen übernehmen, den Titel des Eintrags aber behalten (die Seite heißt meist anders als der Eintrag)
export function supplementExistingEntry(entry: Entry, saveState: SaveState, urls: string[]) {
    const sd = saveState.submittedData;
    return supplementEntryState(entry, sd ? { ...saveState, submittedData: { ...sd, title: entry.title } } : saveState, urls);
}
