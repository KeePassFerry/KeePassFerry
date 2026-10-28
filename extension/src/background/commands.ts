import { Command } from "./Command";
import { Action } from "../common/Action";
import { KeeLog } from "../common/Logger";
import { kee } from "./KF";
import { Entry } from "../common/model/Entry";

/*
Kontextmenü je passendem Eintrag: "Anmeldung ausfüllen" (wie bisher) und, bei Rechtsklick in ein Eingabefeld,
einzelne Werte gezielt in genau dieses Feld einfügen: Benutzername, Passwort, Einmalcode und eigene Felder des
Eintrags. Das Menü muss vor dem Rechtsklick stehen: es wird sofort mit den bekannten Feldnamen aufgebaut, die
Namen eigener Felder werden danach im Hintergrund geholt und das Menü bei Änderungen neu aufgebaut. Es enthält nur
Feldnamen, Werte eigener Felder und Codes werden erst beim Klick aus KeePass geholt.
*/

type MenuAction =
    | { kind: "login"; frameId: number; index: number }
    | { kind: "value"; value: string }
    | { kind: "otp" | "custom"; uuid: string; dbFileName: string; name?: string };

const ALL_CONTEXTS = ["editable", "frame", "image", "link", "page", "password", "selection"];
const PAGES = ["http://*/*", "https://*/*"];
const EXTRAS_REFRESH_MS = 10 * 1000;

export class KFCommands {
    private contextMenuUpdateLock = false;
    private contextMenuUpdatePending = false;
    private menuActions = new Map<string, MenuAction>();
    private extrasCache = new Map<string, { at: number; names: string[] }>();
    private scheduledUpdate: ReturnType<typeof setTimeout> = null;
    // Treffer der Tab-Adresse, wenn die Seite selbst keine meldet (kein Anmeldeformular, z. B. nur ein Suchfeld)
    private tabUrlEntries = new Map<number, { url: string; at: number; entries: Entry[] }>();
    private tabUrlLookups = new Set<number>();

    public init() {
        chrome.commands.onCommand.addListener(command => {
            const store = kee.store;
            switch (command) {
                case Command.DetectForms:
                    if (store.state.connected && store.state.ActiveKeePassDatabaseIndex >= 0) {
                        kee.tabStates
                            .get(kee.foregroundTabId)
                            .framePorts.forEach(port => {
                                port.postMessage({
                                    action: Action.DetectForms
                                });
                            }, this);
                    }
                    break;
                case Command.PrimaryAction:
                    if (store.state.ActiveKeePassDatabaseIndex < 0) {
                        kee.loginToPasswordManager();
                    } else {
                        kee.tabStates
                            .get(kee.foregroundTabId)
                            .framePorts.forEach(port => {
                                port.postMessage({ action: Action.Primary });
                            }, this);
                    }
                    break;
                case Command.GeneratePassword:
                    kee.initiatePasswordGeneration();
                    break;
            }
        });

        chrome.contextMenus.onClicked.addListener((info, tab) => {
            const id = info.menuItemId as string;
            const store = kee.store;
            switch (id) {
                case Command.DetectForms:
                    if (store.state.connected && store.state.ActiveKeePassDatabaseIndex >= 0) {
                        kee.tabStates
                            .get(kee.foregroundTabId)
                            .framePorts.forEach(port => {
                                port.postMessage({
                                    action: Action.DetectForms
                                });
                            }, this);
                    }
                    break;
                case Command.GeneratePassword:
                    // Rechtsklick in ein Eingabefeld: der Dialog bietet "Einsetzen" in genau dieses Feld an
                    kee.initiatePasswordGeneration(info.editable && tab?.id != null ? { tabId: tab.id, frameId: info.frameId } : null);
                    break;
            }
            const menuAction = this.menuActions.get(id);
            if (menuAction) this.runMenuAction(menuAction, tab?.id ?? kee.foregroundTabId, info.frameId);
        });
    }

    private async runMenuAction(a: MenuAction, tabId: number, clickedFrameId: number) {
        const ports = kee.tabStates.get(tabId)?.framePorts;
        if (!ports) return;
        if (a.kind === "login") {
            ports.get(a.frameId)?.postMessage({ action: Action.ManualFill, selectedEntryIndex: a.index });
            return;
        }
        let value: string = null;
        try {
            if (a.kind === "value") value = a.value;
            else if (a.kind === "otp") value = (await kee.KeePassRPC.getTotp(a.uuid, a.dbFileName))?.code ?? null;
            else value = await kee.KeePassRPC.getEntryFieldValue(a.uuid, a.dbFileName, a.name);
        } catch (e) {
            KeeLog.warn("Context menu value failed: " + e);
        }
        if (value == null) return;
        ports.get(clickedFrameId)?.postMessage({ action: Action.FillContextTarget, fillValue: value });
    }

    private static extrasKey(uuid: string, dbFileName: string) {
        return dbFileName + "|" + uuid;
    }

    // Jede Plugin-Anfrage bei gesperrter Datenbank stößt in KeePass die Entsperrabfrage an (EnsureDBisOpen).
    // Das Menü fragt deshalb nur bei offener Datenbank an; entsperrt wird nur durch den Nutzer (z. B. Klick aufs Symbol).
    private static databaseOpen() {
        return kee.store.state.connected && kee.store.state.KeePassDatabases.length > 0;
    }

    // Eigene Felder eines Eintrags wurden im Popup geändert: Menü sofort mit den neuen Namen aufbauen
    public entryExtrasChanged(uuid: string, dbFileName: string) {
        this.extrasCache.delete(KFCommands.extrasKey(uuid, dbFileName));
        this.setupContextMenuItems();
    }

    // Namen eigener Felder im Hintergrund holen (Plugin vor 1.0.7: keine); bei Änderungen Menü neu aufbauen
    private async refreshCustomFieldNames(entries: Entry[]) {
        if (!KFCommands.databaseOpen()) return;
        let changed = false;
        await Promise.all(
            entries.map(async e => {
                const key = KFCommands.extrasKey(e.uuid, e.database.fileName);
                const cached = this.extrasCache.get(key);
                if (cached && Date.now() - cached.at < EXTRAS_REFRESH_MS) return;
                let names: string[] = cached?.names ?? [];
                try {
                    const extras = await kee.KeePassRPC.getEntryExtras(e.uuid, e.database.fileName);
                    if (extras) names = (extras.fields ?? []).map(f => f.name).filter(n => !!n);
                } catch (err) {
                    // alter Stand bleibt
                }
                if (!cached || cached.names.join("\n") !== names.join("\n")) changed = true;
                this.extrasCache.set(key, { at: Date.now(), names });
            })
        );
        if (changed) this.setupContextMenuItems();
    }

    // Wie das Popup selbst nach der Adresse suchen; bei geänderten Treffern Menü neu aufbauen
    private async lookupTabEntries(tabId: number, url: string) {
        if (this.tabUrlLookups.has(tabId) || !KFCommands.databaseOpen()) return;
        this.tabUrlLookups.add(tabId);
        try {
            const found: Entry[] = (await kee.findLogins(url, null, null, null, null, null)) ?? [];
            const before = this.tabUrlEntries.get(tabId);
            this.tabUrlEntries.set(tabId, { url, at: Date.now(), entries: found });
            const ids = (list: Entry[]) => list.map(e => e.uuid).join(",");
            if (!before || before.url !== url || ids(before.entries) !== ids(found)) this.setupContextMenuItems();
        } catch (e) {
            KeeLog.warn("Context menu lookup failed: " + e);
        } finally {
            this.tabUrlLookups.delete(tabId);
        }
    }

    // Menüpunkt anlegen; Chrome kennt den Kontext "password" nicht, dann ohne ihn
    private createMenuItem(props: chrome.contextMenus.CreateProperties) {
        const withoutPassword = () =>
            chrome.contextMenus.create({ ...props, contexts: (props.contexts as string[]).filter(c => c !== "password") as any });
        try {
            chrome.contextMenus.create(props, () => {
                if (chrome.runtime.lastError) withoutPassword();
            });
        } catch (e) {
            withoutPassword();
        }
    }

    private addEntryMenus() {
        const state = kee.tabStates.get(kee.foregroundTabId);
        if (kee.foregroundTabId < 0 || !state?.frames) return;
        // Zuerst Einträge eines erkannten Anmeldeformulars (mit "Anmeldung ausfüllen"), dann übrige Treffer der Adresse
        const seen = new Set<string>();
        const entries: { entry: Entry; frameId: number; index: number }[] = [];
        const collect = (list: Entry[], frameId: number, withLogin: boolean) =>
            (list ?? []).forEach((entry, index) => {
                const key = entry.database?.fileName + "|" + entry.uuid;
                if (seen.has(key)) return;
                seen.add(key);
                entries.push({ entry, frameId, index: withLogin ? index : -1 });
            });
        state.frames.forEach((frame, frameId) => collect(frame.entries, frameId, true));
        state.frames.forEach((frame, frameId) => collect(frame.urlEntries, frameId, false));
        if (entries.length === 0 && state.url) {
            const cached = this.tabUrlEntries.get(kee.foregroundTabId);
            if (cached?.url === state.url) collect(cached.entries, 0, false);
            if (!cached || cached.url !== state.url || Date.now() - cached.at > EXTRAS_REFRESH_MS) {
                this.lookupTabEntries(kee.foregroundTabId, state.url);
            }
        }
        const customNames = entries.map(
            e => this.extrasCache.get(KFCommands.extrasKey(e.entry.uuid, e.entry.database.fileName))?.names ?? []
        );
        this.refreshCustomFieldNames(entries.map(e => e.entry));

        let n = 0;
        const add = (parentId: string, title: string, contexts: string[], action: MenuAction) => {
            const id = "kf-" + n++;
            this.menuActions.set(id, action);
            this.createMenuItem({ id, parentId, title, contexts: contexts as any, documentUrlPatterns: PAGES });
        };
        entries.forEach(({ entry, frameId, index }, i) => {
            const parentId = "kf-entry-" + i;
            const username = Entry.getUsernameField(entry)?.value ?? "";
            const title = (entry.title || username || "?") + (entry.title && username ? " (" + username + ")" : "");
            const password = Entry.getPasswordField(entry)?.value ?? "";
            const editable = ["editable", "password"];
            // Ohne erkanntes Formular gibt es nur die Einfüge-Punkte, der Eintrag erscheint dann nur in Eingabefeldern
            this.createMenuItem({ id: parentId, title, contexts: (index >= 0 ? ALL_CONTEXTS : editable) as any, documentUrlPatterns: PAGES });
            if (index >= 0) add(parentId, $STR("ferry_menu_fill_login"), ALL_CONTEXTS, { kind: "login", frameId, index });

            const ref = { uuid: entry.uuid, dbFileName: entry.database.fileName };
            if (username || password || entry.hasOtp || customNames[i].length) {
                this.createMenuItem({ id: parentId + "-sep", parentId, type: "separator", contexts: editable as any, documentUrlPatterns: PAGES });
            }
            if (username) add(parentId, $STR("ferry_menu_insert_username"), editable, { kind: "value", value: username });
            if (password) add(parentId, $STR("ferry_menu_insert_password"), editable, { kind: "value", value: password });
            if (entry.hasOtp) add(parentId, $STR("ferry_menu_insert_otp"), editable, { kind: "otp", ...ref });
            for (const name of customNames[i]) add(parentId, name, editable, { kind: "custom", ...ref, name });
        });
    }

    // Treffer einer Seite im aktiven Tab sind da (Laden, Datenbank geändert): Menü neu aufbauen, mehrere Frames gebündelt
    public scheduleContextMenuUpdate() {
        if (this.scheduledUpdate !== null) return;
        this.scheduledUpdate = setTimeout(() => {
            this.scheduledUpdate = null;
            this.setupContextMenuItems();
        }, 150);
    }

    public async setupContextMenuItems() {
        if (commandManager.contextMenuUpdateLock) {
            // Läuft gerade: danach mit dem neuesten Stand wiederholen
            commandManager.contextMenuUpdatePending = true;
            return;
        }
        const store = kee.store;
        commandManager.contextMenuUpdateLock = true;
        try {
            await chrome.contextMenus.removeAll();
            this.menuActions.clear();
            if (KFCommands.databaseOpen()) {
                this.addEntryMenus();
            } else {
                // Gesperrt: keine Einträge (samt Werten) aus der Zeit vor dem Sperren behalten
                this.tabUrlEntries.clear();
                this.extrasCache.clear();
            }

            chrome.contextMenus.create({
                type: "separator",
                id: "separator1",
                documentUrlPatterns: ["http://*/*", "https://*/*"]
            });

            if (store.state.connected && store.state.ActiveKeePassDatabaseIndex >= 0) {
                try {
                    chrome.contextMenus.create({
                        id: Command.DetectForms,
                        title: $STR("Menu_Button_fillCurrentDocument_label"),
                        documentUrlPatterns: ["http://*/*", "https://*/*"],
                        contexts: [
                            "editable",
                            "frame",
                            "image",
                            "link",
                            "page",
                            "password",
                            "selection"
                        ] as any
                    });
                } catch (e) {
                    // try again with Chrome-supported contexts
                    chrome.contextMenus.create({
                        id: Command.DetectForms,
                        title: $STR("Menu_Button_fillCurrentDocument_label"),
                        documentUrlPatterns: ["http://*/*", "https://*/*"],
                        contexts: ["editable", "frame", "image", "link", "page", "selection"]
                    });
                }
            }

            if (store.state.connected) {
                try {
                    chrome.contextMenus.create({
                        id: Command.GeneratePassword,
                        title: $STR("Menu_Button_copyNewPasswordToClipboard_label"),
                        documentUrlPatterns: ["http://*/*", "https://*/*"],
                        contexts: [
                            "editable",
                            "frame",
                            "image",
                            "link",
                            "page",
                            "password",
                            "selection"
                        ] as any
                    });
                } catch (e) {
                    // try again with Chrome-supported contexts
                    chrome.contextMenus.create({
                        id: Command.GeneratePassword,
                        title: $STR("Menu_Button_copyNewPasswordToClipboard_label"),
                        documentUrlPatterns: ["http://*/*", "https://*/*"],
                        contexts: ["editable", "frame", "image", "link", "page", "selection"]
                    });
                }
            }

        } finally {
            commandManager.contextMenuUpdateLock = false;
        }
        if (commandManager.contextMenuUpdatePending) {
            commandManager.contextMenuUpdatePending = false;
            await this.setupContextMenuItems();
        }
    }
}

// initialise the command system
export const commandManager = new KFCommands();
commandManager.init();
