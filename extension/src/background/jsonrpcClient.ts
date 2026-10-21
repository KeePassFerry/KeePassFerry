import { kprpcClient } from "./kprpcClient";
import { SessionType } from "../common/SessionType";
import { PasswordProfile } from "../common/model/PasswordProfile";
import { KeeLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { NativeSessionManager } from "./NativeSession";
import { DatabaseDto, EntryDto } from "../common/model/KPRPCDTOs";
import { Database } from "../common/model/Database";
import { Entry } from "../common/model/Entry";
import { DatabaseSummary } from "../common/model/DatabaseSummary";
import BackgroundStore from "../store/BackgroundStore";
import { kee } from "./KF";

/*
jsonrpcClient provides a JSON-RPC client and method proxies for
communication between Kee and a KeePassRPC server.
*/

export class jsonrpcClient {
    public kprpcClient: kprpcClient;

    constructor(private store: BackgroundStore) {
        this.kprpcClient = new kprpcClient(store);
        this.kprpcClient.startNativeSessionManager();
    }

    sessionManagerForFilename(dbFileName: string) {
        // Pfadschreibweise kann abweichen (Groß-/Kleinschreibung, / statt \); ohne Treffer die native Verbindung
        const norm = (s: string) => (s ?? "").replace(/\//g, "\\").toLowerCase();
        const dbs = this.store.state.KeePassDatabases;
        const db = dbs.find(d => d.fileName === dbFileName) ?? dbs.find(d => norm(d.fileName) === norm(dbFileName));
        return this.kprpcClient.getSessionManagerByType(db?.sessionType ?? SessionType.Websocket);
    }

    sessionManagerForPasswordProfile(profile: string) {
        const sessionType = this.store.state.PasswordProfiles.find(p => p.name === profile).sessionType;
        return this.kprpcClient.getSessionManagerByType(sessionType);
    }

    public get websocketSessionManagerIsActive(): boolean {
        return this.kprpcClient.getSessionManagerByType(SessionType.Websocket).isActive();
    }

    //***************************************
    // Functions below orchestrate requests to one or more KPRPC servers,
    // targeting methods exposed in the KeePassRPC server.
    // See KeePassRPCService.cs for more detail on what each method does.
    //***************************************

    launchGroupEditor(uuid: string, dbFileName: string) {
        this.kprpcClient.request(
            [this.sessionManagerForFilename(dbFileName)],
            "LaunchGroupEditor",
            [uuid, dbFileName]
        );
    }

    launchLoginEditor(uuid: string, dbFileName: string) {
        this.kprpcClient.request(
            [this.sessionManagerForFilename(dbFileName)],
            "LaunchLoginEditor",
            [uuid, dbFileName]
        );
    }

    selectAndFocusDatabase(keepassFilename: string) {
        const sessionManager = this.kprpcClient.getPrimarySessionManager();
        if (!sessionManager) {
            KeeLog.info("No active session found");
            return null;
        }
        this.kprpcClient.request([sessionManager], "OpenAndFocusDatabase", [keepassFilename, false]);
        return SessionType.Websocket;
    }

    selectDB(fileName: string, requestFocusReturn: boolean, sessionType: SessionType) {
        const sessionManager = sessionType
            ? this.kprpcClient.getSessionManagerByType(sessionType)
            : null;

        // Requesting return focus is default behaviour for ChangeDatabase so we know if we want to
        // suppress that behaviour we must use the OpenAndFocusDatabase feature.
        if (!requestFocusReturn) {
            this.kprpcClient.request([sessionManager], "OpenAndFocusDatabase", [
                fileName,
                requestFocusReturn
            ]);
        } else {
            this.kprpcClient.request([sessionManager], "ChangeDatabase", [fileName, false]);
        }
    }

    async addLogin(entry: Entry, parentUUID: string, dbFileName: string) {
        const jslogin = Entry.toKPRPCEntryDTO(entry);
        const sessionResponses = await this.kprpcClient.request(
            [this.sessionManagerForFilename(dbFileName)],
            "AddLogin",
            [jslogin, parentUUID, dbFileName]
        );
        const result = sessionResponses?.[0].resultWrapper?.result;
        if (result) {
            const db = DatabaseSummary.fromKPRPCDatabaseSummaryDTO(result.db);
            return Entry.fromKPRPCEntryDTO(result, db);
        }
        return null;
    }

    async updateLogin(entry: Entry, oldLoginUUID: string, dbFileName: string) {
        const jslogin = Entry.toKPRPCEntryDTO(entry);
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        const urlMergeMode = sessionManager
            .features()
            .some(f => f === "KPRPC_FEATURE_ENTRY_URL_REPLACEMENT")
            ? 5
            : 2;
        const sessionResponses = await this.kprpcClient.request([sessionManager], "UpdateLogin", [
            jslogin,
            oldLoginUUID,
            urlMergeMode,
            dbFileName
        ]);
        const result = sessionResponses?.[0].resultWrapper?.result;
        if (result) {
            const db = DatabaseSummary.fromKPRPCDatabaseSummaryDTO(result.db);
            return Entry.fromKPRPCEntryDTO(result, db);
        }
        return null;
    }

    async findLogins(
        fullURL: string,
        httpRealm: string,
        uuid: string,
        dbFileName: string,
        freeText: string,
        username: string
    ) {
        if (this.store.state.KeePassDatabases.length <= 0) {
            return [];
        }

        // This has no meaning any more and is ignored in KPRPC 1.10+ but if
        // we don't supply it to older versions of KPRPC, all non-matching
        // entries will have their URLs tested twice before they are determined
        // to be not a match.
        const lst = "LSTnoForms";

        if (dbFileName == undefined || dbFileName == null || dbFileName == "") {
            if (!configManager.current.searchAllOpenDBs) {
                dbFileName =
                    this.store.state.KeePassDatabases[this.store.state.ActiveKeePassDatabaseIndex].fileName;
            } else dbFileName = "";
        }

        // If we have been asked to search in a specific DB filename (possibly implicitly by
        // user settings) we can search in just that session, otherwise we search them all
        const potentialSessionManagers: NativeSessionManager[] = [];
        if (dbFileName) potentialSessionManagers.push(this.sessionManagerForFilename(dbFileName));
        else {
            potentialSessionManagers.push(...this.kprpcClient.getManagersForActiveSessions());
        }

        const sessionManagers = potentialSessionManagers.filter(() => this.store.state.KeePassDatabases.length > 0);

        if (sessionManagers.length <= 0) {
            return [];
        }

        const urls = [];

        if (fullURL) {
            urls.push(fullURL);

            // Google treat youtube.com and google.com as the same property when authenticating
            //TODO:v: extend to wider concept of equivelent domains (beware ownership changes)
            if (fullURL.search(/$https:\/\/accounts\.youtube\.com\/?/) >= 0) {
                urls.push("https://accounts.google.com");
            }
        }

        const sessionResponses = await this.kprpcClient.request(sessionManagers, "FindLogins", [
            urls,
            null,
            httpRealm,
            lst,
            false,
            uuid,
            dbFileName,
            freeText,
            username
        ]);
        const results: Entry[] = [];
        for (const sessionResponse of sessionResponses) {
            if (sessionResponse.resultWrapper?.result?.[0]) {
                const db = DatabaseSummary.fromKPRPCDatabaseSummaryDTO(
                    sessionResponse.resultWrapper.result[0].db
                );
                results.push(
                    ...sessionResponse.resultWrapper.result.map((res: EntryDto) =>
                        Entry.fromKPRPCEntryDTO(res, db)
                    )
                );
            }
        }
        return results;
    }

    // Bild als Anhang an einen Eintrag hängen; liefert den gespeicherten Dateinamen oder null
    async addImageAttachment(uuid: string, dbFileName: string, fileName: string, dataBase64: string): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.kprpcClient.request([sessionManager], "AddImageAttachment", [uuid, dbFileName, fileName, dataBase64]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Eigene Felder (geschützte ohne Wert) und Anhänge eines Eintrags
    async getEntryExtras(uuid: string, dbFileName: string): Promise<{
        fields: { name: string; isProtected: boolean; value: string }[];
        attachments: { name: string; size: number }[];
    }> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.kprpcClient.request([sessionManager], "GetEntryExtras", [uuid, dbFileName]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Eigenes Feld (kind "field") oder Anhang (kind "attachment") entfernen
    async removeEntryExtra(uuid: string, dbFileName: string, kind: string, name: string): Promise<boolean> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return false;
        const responses = await this.kprpcClient.request([sessionManager], "RemoveEntryExtra", [uuid, dbFileName, kind, name]);
        return !!responses?.[0]?.resultWrapper?.result;
    }

    // Textfeld anlegen (vorhandene Namen bekommen eine Nummer) oder Text an die Notizen hängen; liefert den Feldnamen oder null
    async addEntryText(uuid: string, dbFileName: string, fieldName: string, value: string, protect: boolean, toNotes: boolean): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.kprpcClient.request([sessionManager], "AddEntryText", [uuid, dbFileName, fieldName, value, protect, toNotes]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Gesperrte Datenbank im Hintergrund entsperren lassen (Schlüsselabfrage/Windows Hello, ohne KeePass-Fenster)
    async requestUnlock(): Promise<string> {
        const sessionManager = this.kprpcClient.getSessionManagerByType(SessionType.Websocket);
        if (!sessionManager?.isActive()) return "notConnected";
        this.kprpcClient.allowKeePassForeground();
        const responses = await this.kprpcClient.request([sessionManager], "RequestUnlock", []);
        return responses?.[0]?.resultWrapper?.result ?? "error";
    }

    // Passkeys: Aufrufe an das Plugin über die KeePass-Sitzung (alle offenen Datenbanken)
    private async passkeyRpc(method: string, params: any[]): Promise<any> {
        const sessionManager = this.kprpcClient.getSessionManagerByType(SessionType.Websocket);
        if (!sessionManager?.isActive()) return null;
        const responses = await this.kprpcClient.request([sessionManager], method, params);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    passkeyCandidates(rpId: string) {
        return this.passkeyRpc("PasskeyCandidates", [rpId]);
    }

    passkeyFind(rpId: string, allowCredentialIds: string[]) {
        return this.passkeyRpc("PasskeyFind", [rpId, allowCredentialIds ?? []]);
    }

    passkeyCreate(rpId: string, rpName: string, userId: string, userName: string, origin: string, targetUuid: string, dbFileName: string, overwrite: boolean) {
        return this.passkeyRpc("PasskeyCreate", [rpId, rpName, userId, userName, origin, targetUuid, dbFileName, overwrite]);
    }

    passkeyGetAssertion(uuid: string, dbFileName: string, rpId: string, clientDataHash: string) {
        return this.passkeyRpc("PasskeyGetAssertion", [uuid, dbFileName, rpId, clientDataHash]);
    }

    // Diagnoseprotokoll: Zeilen an das Plugin, das sie in die Protokolldatei schreibt
    ferryDiagLog(lines: string[]): Promise<boolean> {
        return this.passkeyRpc("FerryDiagLog", [lines]);
    }

    passkeyRemove(uuid: string, dbFileName: string, rpId: string, credentialId: string): Promise<string> {
        return this.passkeyRpc("PasskeyRemove", [uuid, dbFileName, rpId, credentialId]);
    }

    passkeyUpdateUser(uuid: string, dbFileName: string, rpId: string, credentialId: string, name: string): Promise<string> {
        return this.passkeyRpc("PasskeyUpdateUser", [uuid, dbFileName, rpId, credentialId, name]);
    }

    // Aktueller TOTP-Code eines Eintrags (null, wenn der Eintrag keinen hat)
    async getTotp(uuid: string, dbFileName: string): Promise<{ code: string; remainingSeconds: number; period: number }> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.kprpcClient.request([sessionManager], "GetTotp", [uuid, dbFileName]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Schreibt eine otpauth-URI in einen Eintrag; status "ok" | "exists" | "invalid" | "notfound"
    async setTotp(uuid: string, dbFileName: string, otpauthUri: string, overwrite: boolean): Promise<{ status: string; code: string }> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.kprpcClient.request([sessionManager], "SetTotp", [uuid, dbFileName, otpauthUri, overwrite]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    async getAllDatabases() {
        const activeSessions = this.kprpcClient.getManagersForActiveSessions();

        const sessionResponses = await this.kprpcClient.request(
            activeSessions,
            "GetAllDatabases",
            null
        );
        const dbs: Database[] = [];
        for (const sessionResponse of sessionResponses) {
            if (sessionResponse.resultWrapper.result !== null) {
                const recievedDBs = sessionResponse.resultWrapper.result;
                for (const db of recievedDBs as Array<DatabaseDto>) {
                    if (!db) {
                        KeeLog.warn("Missing db for sessiontype: " + sessionResponse.sessionType);
                    } else if (!dbs.find(d => d.fileName === db.fileName)) {
                        dbs.push(
                            Database.fromKPRPCDatabaseDTO(
                                db,
                                sessionResponse.sessionType,
                                sessionResponse.features
                            )
                        );
                    } else {
                        KeeLog.warn("Database with duplicate file name found. Ignoring.");
                    }
                }
            }
        }
        kee.updateKeePassDatabases(dbs);
    }

    async getPasswordProfiles() {
        const activeSessions = this.kprpcClient.getManagersForActiveSessions();

        const sessionResponses = await this.kprpcClient.request(
            activeSessions,
            "GetPasswordProfiles",
            null
        );
        const profiles: PasswordProfile[] = [];
        for (const sessionResponse of sessionResponses) {
            if (sessionResponse.resultWrapper.result !== null) {
                for (const profileName of sessionResponse.resultWrapper.result as string[]) {
                    if (!profiles.find(p => p.name === profileName)) {
                        profiles.push({
                            name: profileName,
                            sessionType: sessionResponse.sessionType
                        });
                    } else {
                        KeeLog.debug("Password profile with duplicate name found. Ignoring.");
                    }
                }
            }
        }
        return profiles;
    }

    async generatePassword(profileName: string, url: string): Promise<string> {
        const session = this.sessionManagerForPasswordProfile(profileName);
        const sessionResponses = await this.kprpcClient.request([session], "GeneratePassword", [
            profileName,
            url
        ]);
        const sessionResponse = sessionResponses[0];
        if (sessionResponse.resultWrapper.result !== null) {
            return sessionResponse.resultWrapper.result;
        }
    }
}
