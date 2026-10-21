import type { SubmittedData } from "../common/SubmittedData";

export class PersistentDataItem {
    itemType: "submittedData";
    submittedData?: SubmittedData;
    creationDate: Date;
    // Hinweis "Speichern?" in der Seite wurde für diese Anmeldung weggeklickt
    noticeDismissed?: boolean;
}
