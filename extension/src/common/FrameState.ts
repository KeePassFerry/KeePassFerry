import { Entry } from "./model/Entry";

export class FrameState {
    entries: Entry[] = [];
    // Alle zur Adresse passenden Einträge, auch ohne erkanntes Anmeldeformular (Kontextmenü "Einfügen")
    urlEntries: Entry[] = [];
    url: string;
}
