import { Field } from "./model/Field";

export interface SubmittedData {
    url: string;
    fields: Field[];
    title: string;
    // Vom Hintergrund gesetzt: vorhandener Eintrag mit diesem Benutzernamen, aber anderem Passwort (Passwort geändert);
    // label ist der Benutzername bzw. Titel für den Hinweis
    updateTarget?: { uuid: string; dbFileName: string; label: string };
}
