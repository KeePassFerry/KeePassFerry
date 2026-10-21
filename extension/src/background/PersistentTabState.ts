import { PersistentDataItem } from "./PersistentDataItem";

export class PersistentTabState {
    items: PersistentDataItem[];
    // Zuletzt in diesem Tab ausgefüllter Eintrag; bleibt über Seitenwechsel erhalten (mehrseitige Anmeldung, OTP)
    lastFilledEntry?: { uuid: string; dbFileName: string; domain: string; at: number };
}
