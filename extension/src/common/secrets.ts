import { Entry } from "./model/Entry";
import { Field } from "./model/Field";

/*
secrets.ts: Einträge für Seiten ohne Passwörter und geschützte Werte (#56). Seiten, Feldsymbole, Listen und das
Kontextmenü brauchen nur Titel, Benutzername und Feldbeschreibungen; die Werte des gewählten Eintrags werden erst beim
Ausfüllen, Kopieren oder Anzeigen aus KeePass geholt. Das Plugin liefert solche Einträge selbst
(FindLoginsWithoutSecrets); mit einem älteren Plugin entfernt der Hintergrund die Werte gleich nach dem Empfang.
*/

export const FIND_WITHOUT_SECRETS_FEATURE = "KEEPASSFERRY_FIND_WITHOUT_SECRETS";

// Passwortfelder und geschützte Felder leeren und als valueOmitted markieren; leere Werte bleiben unmarkiert
export function omitSecrets(entry: Entry): Entry {
    if (!entry) return entry;
    const fields = (entry.fields ?? []).map(f => {
        if (!f.value || (f.type !== "password" && !f.isProtected)) return f;
        return new Field({ ...f, value: "", resetValue: "", valueOmitted: true });
    });
    return new Entry({ ...entry, fields });
}

// Darf ein Frame die Werte dieses Eintrags bekommen? Nur Treffer, die der Hintergrund selbst für die Adresse des
// Frames gefunden hat (urlEntries). Die Liste "entries" meldet die Seite selbst und zählt deshalb nicht
export function secretsAllowedFor(
    frame: { urlEntries?: Entry[] } | undefined,
    ref: { uuid: string; dbFileName: string } | undefined
): boolean {
    if (!frame || !ref?.uuid) return false;
    return (frame.urlEntries ?? []).some(e => e.uuid === ref.uuid && e.database?.fileName === ref.dbFileName);
}

// Gibt es zum Feld einen Wert (mitgeschickt oder nur weggelassen)?
export function fieldHasValue(f: Field): boolean {
    return !!f?.value || !!f?.valueOmitted;
}
