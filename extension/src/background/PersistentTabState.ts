import { PersistentDataItem } from "./PersistentDataItem";
import type { Field } from "../common/model/Field";

export class PersistentTabState {
    items: PersistentDataItem[];
    // Zuletzt in diesem Tab ausgefüllter Eintrag; bleibt über Seitenwechsel erhalten (mehrseitige Anmeldung, OTP)
    lastFilledEntry?: { uuid: string; dbFileName: string; domain: string; at: number };
    // Benutzername aus einem abgeschickten Formular ohne Passwort (erster Schritt einer mehrstufigen Anmeldung)
    pendingUsername?: { field: Field; domain: string; at: number };
}
