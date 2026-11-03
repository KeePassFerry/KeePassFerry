import { diag } from "./ferryDiag";
import { pluginClient } from "./pluginClient";
import { SessionType } from "../common/SessionType";
import { PasswordProfile } from "../common/model/PasswordProfile";
import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { NativeSessionManager } from "./NativeSession";
import { DatabaseDto, EntryDto } from "../common/model/PluginDTOs";
import { Database } from "../common/model/Database";
import { Entry } from "../common/model/Entry";
import { DatabaseSummary } from "../common/model/DatabaseSummary";
import BackgroundStore from "../store/BackgroundStore";
import { ferry } from "./KF";
import { FerryURL } from "../common/FerryURL";
import { hostInDomains, relatedDomains } from "../common/relatedDomains";

/*
jsonrpcClient provides a JSON-RPC client and method proxies for
communication between the extension and the KeePassFerry plugin.
*/

export class jsonrpcClient {
    public pluginClient: pluginClient;

    constructor(private store: BackgroundStore) {
        this.pluginClient = new pluginClient(store);
        this.pluginClient.startNativeSessionManager();
    }

    sessionManagerForFilename(dbFileName: string) {
        // Pfadschreibweise kann abweichen (Groß-/Kleinschreibung, / statt \); ohne Treffer die native Verbindung
        const norm = (s: string) => (s ?? "").replace(/\//g, "\\").toLowerCase();
        const dbs = this.store.state.KeePassDatabases;
        const db = dbs.find(d => d.fileName === dbFileName) ?? dbs.find(d => norm(d.fileName) === norm(dbFileName));
        return this.pluginClient.getSessionManagerByType(db?.sessionType ?? SessionType.Native);
    }

    sessionManagerForPasswordProfile(profile: string) {
        const sessionType = this.store.state.PasswordProfiles.find(p => p.name === profile).sessionType;
        return this.pluginClient.getSessionManagerByType(sessionType);
    }

    public get nativeSessionIsActive(): boolean {
        return this.pluginClient.getSessionManagerByType(SessionType.Native).isActive();
    }

    //***************************************
    // Functions below orchestrate requests to the plugin,
    // targeting methods exposed by the KeePassFerry plugin.
    // See FerryService*.cs in the plugin for more detail on what each method does.
    //***************************************

    launchGroupEditor(uuid: string, dbFileName: string) {
        this.pluginClient.request(
            [this.sessionManagerForFilename(dbFileName)],
            "LaunchGroupEditor",
            [uuid, dbFileName]
        );
    }

    launchLoginEditor(uuid: string, dbFileName: string) {
        this.pluginClient.request(
            [this.sessionManagerForFilename(dbFileName)],
            "LaunchLoginEditor",
            [uuid, dbFileName]
        );
    }

    selectAndFocusDatabase(keepassFilename: string) {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) {
            FerryLog.info("No active session found");
            return null;
        }
        this.pluginClient.request([sessionManager], "OpenAndFocusDatabase", [keepassFilename, false]);
        return SessionType.Native;
    }

    selectDB(fileName: string, requestFocusReturn: boolean, sessionType: SessionType) {
        const sessionManager = sessionType
            ? this.pluginClient.getSessionManagerByType(sessionType)
            : null;

        // Requesting return focus is default behaviour for ChangeDatabase so we know if we want to
        // suppress that behaviour we must use the OpenAndFocusDatabase feature.
        if (!requestFocusReturn) {
            this.pluginClient.request([sessionManager], "OpenAndFocusDatabase", [
                fileName,
                requestFocusReturn
            ]);
        } else {
            this.pluginClient.request([sessionManager], "ChangeDatabase", [fileName, false]);
        }
    }

    async addLogin(entry: Entry, parentUUID: string, dbFileName: string) {
        const jslogin = Entry.toPluginEntryDTO(entry);
        const sessionResponses = await this.pluginClient.request(
            [this.sessionManagerForFilename(dbFileName)],
            "AddLogin",
            [jslogin, parentUUID, dbFileName]
        );
        const result = sessionResponses?.[0].resultWrapper?.result;
        if (result) {
            const db = DatabaseSummary.fromPluginDatabaseSummaryDTO(result.db);
            return Entry.fromPluginEntryDTO(result, db);
        }
        return null;
    }

    async updateLogin(entry: Entry, oldLoginUUID: string, dbFileName: string) {
        const jslogin = Entry.toPluginEntryDTO(entry);
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        const urlMergeMode = sessionManager
            .features()
            .some(f => f === "KEEPASSFERRY_ENTRY_URL_REPLACEMENT")
            ? 5
            : 2;
        const sessionResponses = await this.pluginClient.request([sessionManager], "UpdateLogin", [
            jslogin,
            oldLoginUUID,
            urlMergeMode,
            dbFileName
        ]);
        const result = sessionResponses?.[0].resultWrapper?.result;
        if (result) {
            const db = DatabaseSummary.fromPluginDatabaseSummaryDTO(result.db);
            return Entry.fromPluginEntryDTO(result, db);
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

        // This has no meaning any more and is ignored by the plugin but if
        // we don't supply it to older versions, all non-matching
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
            potentialSessionManagers.push(...this.pluginClient.getManagersForActiveSessions());
        }

        const sessionManagers = potentialSessionManagers.filter(() => this.store.state.KeePassDatabases.length > 0);

        if (sessionManagers.length <= 0) {
            return [];
        }

        const request = async (urls: string[]): Promise<Entry[]> => {
            const started = Date.now();
            const sessionResponses = await this.pluginClient.request(sessionManagers, "FindLogins", [
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
            const found: Entry[] = [];
            for (const sessionResponse of sessionResponses) {
                if (sessionResponse.resultWrapper?.result?.[0]) {
                    const db = DatabaseSummary.fromPluginDatabaseSummaryDTO(sessionResponse.resultWrapper.result[0].db);
                    found.push(...sessionResponse.resultWrapper.result.map((res: EntryDto) => Entry.fromPluginEntryDTO(res, db)));
                }
            }
            diag("hintergrund", "suche in keepass", { ms: Date.now() - started, adressen: urls.length, eintrag: !!uuid, treffer: found.length });
            return found;
        };

        const results = await request(fullURL ? [fullURL] : []);

        // Zugehörige Domains (z. B. login.live.com für einen Eintrag mit outlook.com): zweite Suche, neue Treffer
        // nachrangig (matchAccuracy 0) und gekennzeichnet. Nicht bei Suche nach Eintrag, Text oder Benutzername.
        const domain = fullURL && !uuid && !freeText && !username ? FerryURL.fromString(fullURL)?.domainOrIPAddress : null;
        const related = domain ? relatedDomains(domain) : [];
        if (related.length > 0) {
            const known = new Set(results.map(e => e.database.fileName + "|" + e.uuid));
            for (const e of await request(related.map(d => "https://" + d))) {
                if (known.has(e.database.fileName + "|" + e.uuid)) continue;
                known.add(e.database.fileName + "|" + e.uuid);
                const via = e.URLs.map(u => hostInDomains(FerryURL.fromString(u)?.url?.hostname, related)).find(Boolean);
                results.push(new Entry({ ...e, matchAccuracy: 0, relatedDomain: via ?? related[0] }));
            }
        }
        return results;
    }

    // Bild als Anhang an einen Eintrag hängen; liefert den gespeicherten Dateinamen oder null
    async addImageAttachment(uuid: string, dbFileName: string, fileName: string, dataBase64: string): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "AddImageAttachment", [uuid, dbFileName, fileName, dataBase64]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Plugin per Setup aktualisieren; "started", "uptodate", "download_failed", "checksum_mismatch", "cancelled",
    // "start_failed" oder null (Plugin kennt die Methode nicht)
    async startPluginUpdate(): Promise<string> {
        const sessionManager = this.pluginClient.getUpdateSessionManager();
        if (!sessionManager) return null;
        // KeePass darf nach vorne: sonst erscheint die Windows-Abfrage (UAC) für das Setup nur in der Taskleiste
        this.pluginClient.allowKeePassForeground();
        const responses = await this.pluginClient.request([sessionManager], "StartPluginUpdate", []);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Inhalt eines Anhangs (Base64) bzw. Wert eines eigenen (auch geschützten) Felds, erst auf Klick geladen
    async getEntryAttachment(uuid: string, dbFileName: string, name: string): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "GetEntryAttachment", [uuid, dbFileName, name]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    async getEntryFieldValue(uuid: string, dbFileName: string, name: string): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "GetEntryFieldValue", [uuid, dbFileName, name]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Anhang im Standardprogramm von Windows öffnen; das Plugin startet es, darf dafür in den Vordergrund
    // (sonst bliebe das Programm hinter dem Browser)
    async openEntryAttachmentExternally(uuid: string, dbFileName: string, name: string): Promise<boolean> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return false;
        this.pluginClient.allowKeePassForeground();
        const responses = await this.pluginClient.request([sessionManager], "OpenEntryAttachmentExternally", [uuid, dbFileName, name]);
        return !!responses?.[0]?.resultWrapper?.result;
    }

    // Notizen als Textdatei im Standard-Editor öffnen (fileName ohne Endung, übersetzt)
    async openEntryNotesExternally(uuid: string, dbFileName: string, fileName: string): Promise<boolean> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return false;
        this.pluginClient.allowKeePassForeground();
        const responses = await this.pluginClient.request([sessionManager], "OpenEntryNotesExternally", [uuid, dbFileName, fileName]);
        return !!responses?.[0]?.resultWrapper?.result;
    }

    // Eigene Felder (geschützte ohne Wert), Notizen und Anhänge eines Eintrags
    async getEntryExtras(uuid: string, dbFileName: string): Promise<{
        fields: { name: string; isProtected: boolean; value: string }[];
        attachments: { name: string; size: number }[];
        notes?: string;
    }> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "GetEntryExtras", [uuid, dbFileName]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Schutz eines vorhandenen eigenen Felds umschalten (Plugin mit KEEPASSFERRY_FIELD_PROTECTION)
    async setEntryFieldProtection(uuid: string, dbFileName: string, name: string, protect: boolean): Promise<boolean> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return false;
        const responses = await this.pluginClient.request([sessionManager], "SetEntryFieldProtection", [uuid, dbFileName, name, protect]);
        return !!responses?.[0]?.resultWrapper?.result;
    }

    // Abgelaufene Einträge ausblenden statt daran erinnern (Einstellung liegt im Plugin, das sie dann nicht liefert)
    // Vorwarnung vor dem Ablaufdatum in Tagen (KeePassFerry-Optionen in KeePass); null ohne Antwort
    async getExpiryWarnDays(): Promise<number> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "GetExpiryWarnDays", []);
        const result = responses?.[0]?.resultWrapper?.result;
        return typeof result === "number" ? result : null;
    }

    // KeePassFerry-Optionen in KeePass öffnen (KeePass kommt nach vorne)
    async openOptions(): Promise<boolean> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return false;
        this.pluginClient.allowKeePassForeground();
        const responses = await this.pluginClient.request([sessionManager], "OpenOptions", []);
        return responses?.[0]?.resultWrapper?.result === true;
    }

    async getHideExpired(): Promise<boolean> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "GetHideExpired", []);
        // null = keine Antwort (nicht "aus"), damit die Einstellungen keinen falschen Stand zeigen
        const result = responses?.[0]?.resultWrapper?.result;
        return typeof result === "boolean" ? result : null;
    }

    // Geleakte Einträge: seit "since" (ISO) neu gefundene, mit leerem "since" alle (nur Titel, Adresse, Anzahl)
    async getHibpLeaks(since: string): Promise<{ uuid: string; dbFileName: string; title: string; url: string; count: number; leakedAt: string }[]> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return [];
        const responses = await this.pluginClient.request([sessionManager], "GetHibpLeaks", [since ?? ""]);
        return responses?.[0]?.resultWrapper?.result ?? [];
    }

    // Merkmale für die Tipps: { winHello, anyOtp, hibpCheck } (keine Inhalte)
    async getFerryTips(): Promise<{ winHello: boolean; anyOtp: boolean; anyPasskey?: boolean; hibpCheck: boolean }> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "GetFerryTips", []);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Eintrag in den Papierkorb verschieben (nie endgültig): "recycled", "disabled", "inrecyclebin", "notfound", "error"
    async moveEntryToRecycleBin(uuid: string, dbFileName: string): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return "error";
        const responses = await this.pluginClient.request([sessionManager], "MoveEntryToRecycleBin", [uuid, dbFileName]);
        return responses?.[0]?.resultWrapper?.result ?? "error";
    }

    // Eigenes Feld (kind "field") oder Anhang (kind "attachment") entfernen
    async removeEntryExtra(uuid: string, dbFileName: string, kind: string, name: string): Promise<boolean> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return false;
        const responses = await this.pluginClient.request([sessionManager], "RemoveEntryExtra", [uuid, dbFileName, kind, name]);
        return !!responses?.[0]?.resultWrapper?.result;
    }

    // Textfeld anlegen (vorhandene Namen bekommen eine Nummer) oder Text an die Notizen hängen; liefert den Feldnamen oder null
    async addEntryText(uuid: string, dbFileName: string, fieldName: string, value: string, protect: boolean, toNotes: boolean): Promise<string> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "AddEntryText", [uuid, dbFileName, fieldName, value, protect, toNotes]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Wert eines vorhandenen eigenen Felds ändern oder die Notizen ersetzen (Plugin ab 1.0.7)
    async updateEntryText(uuid: string, dbFileName: string, name: string, value: string, toNotes: boolean): Promise<boolean> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return false;
        const responses = await this.pluginClient.request([sessionManager], "UpdateEntryText", [uuid, dbFileName, name, value, toNotes]);
        return !!responses?.[0]?.resultWrapper?.result;
    }

    // Gesperrte Datenbank im Hintergrund entsperren lassen (Schlüsselabfrage/Windows Hello, ohne KeePass-Fenster)
    async requestUnlock(): Promise<string> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return "notConnected";
        this.pluginClient.allowKeePassForeground();
        const responses = await this.pluginClient.request([sessionManager], "RequestUnlock", []);
        return responses?.[0]?.resultWrapper?.result ?? "error";
    }

    // Passkeys: Aufrufe an das Plugin über die KeePass-Sitzung (alle offenen Datenbanken)
    private async passkeyRpc(method: string, params: any[]): Promise<any> {
        const sessionManager = this.pluginClient.getPrimarySessionManager();
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], method, params);
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
        const responses = await this.pluginClient.request([sessionManager], "GetTotp", [uuid, dbFileName]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    // Schreibt eine otpauth-URI in einen Eintrag; status "ok" | "exists" | "invalid" | "notfound"
    async setTotp(uuid: string, dbFileName: string, otpauthUri: string, overwrite: boolean): Promise<{ status: string; code: string }> {
        const sessionManager = this.sessionManagerForFilename(dbFileName);
        if (!sessionManager) return null;
        const responses = await this.pluginClient.request([sessionManager], "SetTotp", [uuid, dbFileName, otpauthUri, overwrite]);
        return responses?.[0]?.resultWrapper?.result ?? null;
    }

    async getAllDatabases() {
        const activeSessions = this.pluginClient.getManagersForActiveSessions();

        const sessionResponses = await this.pluginClient.request(
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
                        FerryLog.warn("Missing db for sessiontype: " + sessionResponse.sessionType);
                    } else if (!dbs.find(d => d.fileName === db.fileName)) {
                        dbs.push(
                            Database.fromPluginDatabaseDTO(
                                db,
                                sessionResponse.sessionType,
                                sessionResponse.features
                            )
                        );
                    } else {
                        FerryLog.warn("Database with duplicate file name found. Ignoring.");
                    }
                }
            }
        }
        ferry.updateKeePassDatabases(dbs);
    }

    async getPasswordProfiles() {
        const activeSessions = this.pluginClient.getManagersForActiveSessions();

        const sessionResponses = await this.pluginClient.request(
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
                        FerryLog.debug("Password profile with duplicate name found. Ignoring.");
                    }
                }
            }
        }
        return profiles;
    }

    async generatePassword(profileName: string, url: string): Promise<string> {
        const session = this.sessionManagerForPasswordProfile(profileName);
        const sessionResponses = await this.pluginClient.request([session], "GeneratePassword", [
            profileName,
            url
        ]);
        const sessionResponse = sessionResponses[0];
        if (sessionResponse.resultWrapper.result !== null) {
            return sessionResponse.resultWrapper.result;
        }
    }
}
