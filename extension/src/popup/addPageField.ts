import { Field } from "../common/model/Field";
import { sameFieldTarget } from "../common/fieldLocators";

// Feld von der Seite in die Feldliste eines Eintrags aufnehmen. Kennt der Eintrag dieses Eingabefeld schon, bekommt es den
// neuen Wert (ein leeres Feld auf der Seite ändert nichts)
export function addPageField(fields: Field[], added: Field): Field[] {
    const index = fields.findIndex(f => f.type === added.type && sameFieldTarget(f.locators[0], added.locators[0]));
    if (index < 0) return [...fields, added];
    if (!added.value) return fields;
    return fields.map((f, i) => (i === index ? new Field({ ...f, value: added.value, resetValue: f.value }) : f));
}
