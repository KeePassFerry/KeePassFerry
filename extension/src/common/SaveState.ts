import type { SubmittedData } from "./SubmittedData";
import { Entry } from "./model/Entry";

export class SaveState {
    originalEntry?: Entry;
    newEntry: Entry = new Entry({});
    titleResetValue: string;
    submittedData?: SubmittedData;
    lastActiveAt?: Date;
    showURLMismatchWarning: boolean;
    favicon?: string;
    // Adresse der Seite, von der das Website-Symbol stammt (nur dazu passende Einträge bekommen es, #43)
    faviconPageUrl?: string;
}
