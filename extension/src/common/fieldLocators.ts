import type { Field } from "./model/Field";
import type { Locator } from "./model/Locator";

/*
fieldLocators.ts: Zusatzfelder eines Eintrags sind alle Felder außer dem ersten Text- und dem ersten Passwortfeld
(Benutzername und Passwort). Sie gehören zu genau einem Eingabefeld der Seite und werden nur dort eingetragen, wenn
"id" oder "name" passen; sonst landete z. B. eine PIN in einem fremden Feld desselben Typs.
*/

export function sameFieldTarget(a: Pick<Locator, "id" | "name">, b: Pick<Locator, "id" | "name">): boolean {
    return (!!a?.id && a.id === b?.id) || (!!a?.name && a.name === b?.name);
}

export function extraFields(fields: Field[]): Field[] {
    const firstText = fields.findIndex(f => f.type !== "password");
    const firstPassword = fields.findIndex(f => f.type === "password");
    return fields.filter((_, i) => i !== firstText && i !== firstPassword);
}
