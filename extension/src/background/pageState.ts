import type { KeeState } from "../store/KeeState";
import { SaveState } from "../common/SaveState";
import { Database } from "../common/model/Database";
import { Mutation } from "../store/Mutation";
import * as types from "../store/mutation-types";

/*
pageState.ts: Was die Inhaltsskripte in Webseiten vom Zustand erfahren. Sie laufen im Prozess der jeweiligen Webseite
(auch in fremden iframes) und lesen nur Verbindung, offene Datenbanken (Dateiname, Fähigkeiten) und den Zeitpunkt der
letzten Eintragsänderung. Passwörter aus dem Speichern- bzw. Bearbeiten-Fenster, erzeugte Passwörter, Suchergebnisse,
Benachrichtigungen und der Datenbankbaum mit allen Einträgen bleiben im Hintergrund, im Popup und in den eigenen Panels.
*/

// Je Datenbank nur Kennung und Fähigkeiten, nicht der Baum mit allen Gruppen und Einträgen
export function pageDatabasesOf(databases: Database[]): Database[] {
    return (databases ?? []).map(
        db => ({ name: db.name, fileName: db.fileName, active: db.active, sessionFeatures: db.sessionFeatures }) as Database
    );
}

// Jedes Feld frisch aufgebaut: der Store nutzt "defaults" selbst als lebenden Zustand, eine Kopie davon enthielte
// den aktuellen Speichern-Zustand, das erzeugte Passwort und die Suchergebnisse
export function pageStateOf(state: KeeState): KeeState {
    return {
        latestConnectionError: "",
        lastKeePassRPCRefresh: 0,
        ActiveKeePassDatabaseIndex: state.ActiveKeePassDatabaseIndex,
        KeePassDatabases: pageDatabasesOf(state.KeePassDatabases),
        PasswordProfiles: [],
        notifications: [],
        connected: state.connected,
        connectedWebsocket: state.connectedWebsocket,
        currentSearchTerm: null,
        loginsFound: false,
        searchResults: null,
        saveState: new SaveState(),
        generatedPassword: "",
        saveEntryResult: { result: null, receivedAt: new Date(), fileName: null, uuid: null },
        entryUpdateStartedAtTimestamp: state.entryUpdateStartedAtTimestamp
    };
}

// Änderungen für Inhaltsskripte: nur die Werte von pageStateOf; alles andere wird dorthin nicht verteilt (null)
export function pageMutationOf(mutation: Mutation): Mutation {
    switch (mutation.type) {
        case types.updateConnected:
        case types.updateConnectedWebsocket:
        case types.updateActiveKeePassDatabaseIndex:
        case types.updateEntryUpdateStartedAtTimestamp:
            return mutation;
        case types.updateKeePassDatabases:
            return new Mutation(mutation.type, pageDatabasesOf(mutation.payload));
        default:
            return null;
    }
}
