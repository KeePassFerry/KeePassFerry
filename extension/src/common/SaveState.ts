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
    // Neuer Eintrag aus der Zwei-Faktor-Auswahl oder dem Kontextmenü, den erst "Speichern" anlegt (#54): Popup im
    // selben Tab geht dorthin zurück, das Symbol bleibt hervorgehoben, bis gespeichert oder abgebrochen ist
    // groupUuid: im Fenster gewählte Gruppe, damit sie das Fortsetzen übersteht
    pendingCreate?: { kind: "otp" | "selection"; tabId: number; groupUuid?: string };
    // "Hinzufügen" im Bearbeiten-Fenster (EntryAddition): offen, Eingaben, Vorgemerktes – übersteht ein Schließen des
    // Popups (#54). Gilt nur für den Eintrag mit dieser uuid; jede neue Bearbeitung beginnt ohne
    additionDraft?: AdditionDraft;
}

export interface AdditionDraft {
    uuid: string;
    adding: boolean;
    kind: string;
    name: string;
    value: string;
    protect: boolean;
    imageName: string;
    // Vorgemerkte neue Zeilen (Bilder als Base64 in data)
    staged: Record<string, unknown>[];
    // Vorgemerkte Änderungen vorhandener Zeilen
    changes: { key: string; removed?: boolean; newValue?: string; newProtect?: boolean }[];
}
