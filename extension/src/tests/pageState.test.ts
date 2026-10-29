import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pageMutationOf, pageStateOf } from "../background/pageState";
import { Mutation } from "../store/Mutation";
import * as types from "../store/mutation-types";
import { defaults, KeeState } from "../store/KeeState";

// Voller Zustand des Hintergrunds mit allem, was Seiten nicht bekommen sollen
function fullState(): KeeState {
    return {
        ...defaults,
        connected: true,
        connectedWebsocket: false,
        ActiveKeePassDatabaseIndex: 0,
        KeePassDatabases: [
            {
                name: "Privat",
                fileName: "C:\\KeePass\\privat.kdbx",
                active: true,
                sessionFeatures: ["KPRPC_FIELD_DEFAULT_NAME_AND_ID_EMPTY"],
                root: { title: "Wurzel", entries: [{ title: "Bank", usernameValue: "max" }] }
            } as any
        ],
        saveState: {
            newEntry: { fields: [{ type: "password", value: "geheim-im-dialog" }] },
            submittedData: { url: "https://bank.example", fields: [{ type: "password", value: "gerade-abgeschickt" }] }
        } as any,
        generatedPassword: "erzeugt-123",
        searchResults: [{ title: "Bank", fullDetails: { fields: [{ value: "aus-suche" }] } }] as any,
        notifications: [{ name: "hinweis" }] as any,
        entryUpdateStartedAtTimestamp: 1234
    } as KeeState;
}

describe("pageStateOf", () => {
    it("enthält keine Passwörter, Suchergebnisse oder Einträge mehr", () => {
        const json = JSON.stringify(pageStateOf(fullState()));
        for (const secret of ["geheim-im-dialog", "gerade-abgeschickt", "erzeugt-123", "aus-suche", "Bank", "max", "hinweis"]) {
            expect(json).not.toContain(secret);
        }
    });

    it("behält, was Seiten-Skripte lesen", () => {
        const s = pageStateOf(fullState());
        expect(s.connected).toBe(true);
        expect(s.ActiveKeePassDatabaseIndex).toBe(0);
        expect(s.entryUpdateStartedAtTimestamp).toBe(1234);
        expect(s.KeePassDatabases).toEqual([
            {
                name: "Privat",
                fileName: "C:\\KeePass\\privat.kdbx",
                active: true,
                sessionFeatures: ["KPRPC_FIELD_DEFAULT_NAME_AND_ID_EMPTY"]
            }
        ]);
    });
});

describe("pageMutationOf", () => {
    it("verteilt Verbindung, aktive Datenbank und Bearbeitungszeitpunkt unverändert", () => {
        for (const type of [
            types.updateConnected,
            types.updateConnectedWebsocket,
            types.updateActiveKeePassDatabaseIndex,
            types.updateEntryUpdateStartedAtTimestamp
        ]) {
            const m = new Mutation(type, 1);
            expect(pageMutationOf(m)).toBe(m);
        }
    });

    it("kürzt Datenbanken auf Kennung und Fähigkeiten", () => {
        const m = pageMutationOf(new Mutation(types.updateKeePassDatabases, fullState().KeePassDatabases));
        expect(JSON.stringify(m.payload)).not.toContain("Bank");
        expect(m.payload[0].sessionFeatures).toEqual(["KPRPC_FIELD_DEFAULT_NAME_AND_ID_EMPTY"]);
    });

    it("verteilt Speichern-Zustand, erzeugte Passwörter, Suchergebnisse und Benachrichtigungen nicht an Seiten", () => {
        for (const type of [
            types.updateSaveState,
            types.updateSubmittedData,
            types.updateGeneratedPassword,
            types.updateSearchResults,
            types.updateSearchResultWithFullDetails,
            types.updateCurrentSearchTerm,
            types.updateNotifications,
            types.addNotification,
            types.updatePasswordProfiles,
            types.removeFieldFromActiveEntry,
            types.updateSaveEntryResult,
            types.updateLoginsFound
        ]) {
            expect(pageMutationOf(new Mutation(type, "x"))).toBeNull();
        }
    });
});

// Wächter: Seiten-Code darf nur Zustand lesen, den pageStateOf mitschickt
describe("Seiten-Skripte", () => {
    it("lesen nur Felder, die an Seiten verteilt werden", () => {
        const allowed = new Set(["connected", "connectedWebsocket", "ActiveKeePassDatabaseIndex", "KeePassDatabases", "entryUpdateStartedAtTimestamp"]);
        const dir = join(__dirname, "../page");
        const used = new Set<string>();
        for (const file of readdirSync(dir).filter(f => f.endsWith(".ts"))) {
            const text = readFileSync(join(dir, file), "utf8");
            for (const m of text.matchAll(/store\??\.state\??\.([A-Za-z]+)/g)) used.add(m[1]);
        }
        expect(used.size).toBeGreaterThan(0);
        expect([...used].filter(field => !allowed.has(field))).toEqual([]);
    });
});
