import { SaveState } from "../common/SaveState";
import { Entry } from "../common/model/Entry";
import { reconcileFieldLists } from "./reconcileFieldLists";

export function supplementEntryState(entry: Entry, saveState: SaveState, urls?: string[]) {
    const sd = saveState.submittedData;
    const submittedFields = sd ? sd.fields : [];
    const newFields = reconcileFieldLists(
        JSON.parse(JSON.stringify(entry.fields)),
        submittedFields
    );
    const overwriteWithSubmittedData = (sd
        ? {
              URLs: [sd.url],
              fields: newFields,
              title: sd.title
          }
        : {}) as Entry;
    const overwriteWithURLs = (urls
        ? {
              URLs: [...urls]
          }
        : {}) as Entry;
    // Immer eigene Kopien von Feldern und Adressen: sonst ändert das Bearbeiten-Fenster (z. B. Feld entfernen)
    // auch den Eintrag in der Trefferliste, solange keine übermittelten Daten einfließen
    const ownCopies = { fields: JSON.parse(JSON.stringify(entry.fields)), URLs: [...(entry.URLs ?? [])] } as Entry;
    return Object.assign({}, entry, ownCopies, overwriteWithSubmittedData, overwriteWithURLs);
}

// Vorhandenen Eintrag mit gerade abgeschickten Anmeldedaten derselben Website bearbeiten (Passwort geändert):
// Felder und Adressen übernehmen, den Titel des Eintrags aber behalten (die Seite heißt meist anders als der Eintrag)
export function supplementExistingEntry(entry: Entry, saveState: SaveState, urls: string[]) {
    const sd = saveState.submittedData;
    return supplementEntryState(entry, sd ? { ...saveState, submittedData: { ...sd, title: entry.title } } : saveState, urls);
}
