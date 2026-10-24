import { offerPendingOtpSetup } from "./otpSetup";
import { sameSite } from "../common/relatedDomains";
import { diag } from "./ferryDiag";
import { drawLockGlyph, LOCK_COLOR } from "../common/lockGlyph";
import { KeeURL } from "../common/KeeURL";
import { PersistentTabState } from "./PersistentTabState";
import { jsonrpcClient } from "./jsonrpcClient";
import { NetworkAuth } from "./NetworkAuth";
import { NativeNotification } from "./NativeNotification";
import { commandManager } from "./commands";
import {
    browserPopupMessageHandler,
    pageMessageHandler,
    iframeMessageHandler
} from "./messageHandlers";
import { TabState } from "../common/TabState";
import { Utils, utils } from "../common/utils";
import { SearcherAll } from "../common/SearcherAll";
import { configManager } from "../common/ConfigManager";
import { KeeLog } from "../common/Logger";
import type { AddonMessage } from "../common/AddonMessage";
import { FrameState } from "../common/FrameState";
import { KeeNotification } from "../common/KeeNotification";
import { SessionType } from "../common/SessionType";
import { Action } from "../common/Action";
import { Database } from "../common/model/Database";
import { Entry } from "../common/model/Entry";
import { SaveEntryResult } from "../common/SaveEntryResult";
import BackgroundStore from "~/store/BackgroundStore";
import { Mutation } from "~/store/Mutation";
import { KeeBrowserActionIconConfiguration } from "../common/KeeBrowserActionIconConfiguration";

const SAVE_BADGE_COLOR = "#16a34a";
// Windows-Benachrichtigung zu einem Hinweis im Popup: ein Klick darauf öffnet das Popup (main.ts)
export const OPEN_POPUP_NOTIFICATION_PREFIX = "keepassferry-note-";

class Kee {
    tabStates: Map<number, TabState>;
    saveAttentionTimer: number = null;
    persistentTabStates: Map<number, PersistentTabState>;
    utils: Utils;
    search: SearcherAll;
    foregroundTabId: number;
    currentSearchTermTimer: number;

    // Our link to the JSON-RPC objects required for communication with KeePass
    KeePassRPC: jsonrpcClient;

    _installerTabLoaded: boolean;

    processingCallback: boolean;
    pendingCallback: string;
    urlToOpenOnStartup: string;

    browserPopupPort: Partial<chrome.runtime.Port>;
    onPortConnected: (p: chrome.runtime.Port) => void;

    networkAuth: NetworkAuth;
    store: BackgroundStore;

    private static instance: Kee;

    public static getInstance(): Kee {
        if (!Kee.instance) {
            Kee.instance = new Kee();
        }
        return Kee.instance;
    }

    private constructor() {
        this.store = new BackgroundStore((mutation: Mutation, excludedPort: chrome.runtime.Port) => {

            function tryPostMessage(port: Partial<chrome.runtime.Port>, mutationObj: any): boolean {
                try {
                    port.postMessage({ mutation: mutationObj } as AddonMessage);
                    return true;
                } catch (e) {
                    KeeLog.warn("Dead port found", e);
                    // Sometimes dead ports are left lying around by the browser (especially
                    // during upgrades, etc.). We can do nothing about this except try to
                    // tidy up our reference to it and must not let it cause a failure to post to any valid ports.
                    return false;
                }
            }
            //TODO:f: Find a way to more efficiently distribute Pinia Patch objects / Vue3 Proxy objects without this additional JSON mapping / manipulation
            const json = JSON.stringify(mutation);
            KeeLog.debug("New background mutation for distribution");
            const mutationObj = JSON.parse(json);

            //TODO:f: Maybe try to tidy up these ports too? Should already be dealt with elsewhere and they are a bit more complex because some things expect them to always exist as at least a stub.
            if (this.browserPopupPort !== excludedPort) tryPostMessage(this.browserPopupPort, mutationObj);

            const foregroundTabState = this.tabStates.get(this.foregroundTabId);
            if (foregroundTabState) {
                for (const [id, port] of foregroundTabState.framePorts) {
                    if (port !== excludedPort && !tryPostMessage(port, mutationObj)) {
                        foregroundTabState.framePorts.delete(id);
                    }
                }
                for (const [id, port] of foregroundTabState.ourIframePorts) {
                    if (port !== excludedPort && !tryPostMessage(port, mutationObj)) {
                        foregroundTabState.ourIframePorts.delete(id);
                    }
                }
            }
        });

        this.tabStates = new Map<number, TabState>();
        this.persistentTabStates = new Map<number, PersistentTabState>();

        this.foregroundTabId = -1;

        this.utils = utils;

        this.search = new SearcherAll(this.store.state, {
            version: 1,
            searchAllDatabases: configManager.current.searchAllOpenDBs
        });

        // eslint-disable-next-line @typescript-eslint/no-empty-function
        this.browserPopupPort = { postMessage: _msg => { } };
        this.onPortConnected = async function (p: chrome.runtime.Port) {
            if (KeeLog && KeeLog.debug) KeeLog.debug(p.name + " port connected");
            let name = p.name;
            let parentFrameId: number;
            if (name.startsWith("iframe")) {
                parentFrameId = parseInt(name.substr(7));
                name = "iframe";
            }
            switch (name) {
                case "browserPopup": {
                    clearTimeout(this.currentSearchTermTimer);
                    p.onMessage.addListener(browserPopupMessageHandler.bind(p));
                    p.onDisconnect.addListener(() => {
                        this.browserPopupPort = {
                            // eslint-disable-next-line @typescript-eslint/no-empty-function
                            postMessage: _msg => { }
                        };
                        this.currentSearchTermTimer = self.setTimeout(() => {
                            this?.store?.updateCurrentSearchTerm(null);
                            this?.store?.updateSearchResults(null);
                        }, configManager.current.currentSearchTermTimeout * 1000);
                    });

                    let submittedData: any = null;
                    let loginsFound = false;

                    if (this.persistentTabStates.get(this.foregroundTabId)) {
                        this.persistentTabStates
                            .get(this.foregroundTabId)
                            .items.forEach(item => {
                                if (item.itemType === "submittedData") {
                                    submittedData = item.submittedData;
                                }
                            });
                    }

                    const matchedLogins: any = {};
                    if (this.tabStates.has(this.foregroundTabId)) {
                        const frames = this.tabStates.get(this.foregroundTabId).frames;
                        const matchedFrameID = this.frameIdWithMatchedLogins(frames);
                        if (matchedFrameID >= 0) {
                            loginsFound = true;
                            matchedLogins.entries = frames.get(matchedFrameID).entries;
                            matchedLogins.frameId = matchedFrameID;
                            matchedLogins.tabId = this.foregroundTabId;
                        }
                    }

                    this.store.updateSubmittedData(submittedData);
                    this.store.updateLoginsFound(loginsFound);

                    const connectMessage = {
                        initialState: this.store.state
                    } as AddonMessage;

                    if (matchedLogins.entries) {
                        connectMessage.entries = matchedLogins.entries;
                        connectMessage.frameId = matchedLogins.frameId;
                        connectMessage.tabId = matchedLogins.tabId;
                    } else {
                        const siteEntries = await this.siteEntriesForPopup(this.foregroundTabId);
                        if (siteEntries.length > 0) (connectMessage as any).siteEntries = siteEntries;
                    }

                    try {
                        p.postMessage(connectMessage);
                    } catch (e) {
                        KeeLog.error("postMessage error", e);
                    }
                    this.browserPopupPort = p;

                    //TODO:f: Do we still want to do this all the time? Even when showing
                    // the number of matches on the label/title? Also will want to reset
                    // the title and label so rename the method?
                    this.resetBrowserActionColor();
                    break;
                }
                case "page": {
                    p.onMessage.addListener(pageMessageHandler.bind(p));

                    const tabId = p.sender.tab.id;
                    const frameId = p.sender.frameId;
                    const connectMessage = {
                        initialState: this.store.state,
                        frameId,
                        tabId,
                        isForegroundTab: tabId === this.foregroundTabId
                    } as AddonMessage;

                    //TODO:f: This may be a potential performance improvement but, at least
                    // in Firefox, it isn't guaranteed that a reloading page has its port
                    // disconnected before the new one is connected. Since we may have the
                    // same tab and frame ids, we could end up breaking the new port instead.
                    // p.onDisconnect.addListener(() => {
                    //     const states = this.tabStates.get(tabId);
                    //     states.frames.delete(frameId);
                    //     states.framePorts.delete(frameId);
                    // });
                    this.createTabStateIfMissing(tabId);

                    if (frameId === 0) {
                        this.tabStates.get(tabId).url = p.sender.tab.url;

                        if (this.persistentTabStates.get(tabId)?.items?.length > 0) {
                            this.persistentTabStates.get(
                                tabId
                            ).items = this.persistentTabStates
                                .get(tabId)
                                .items.filter(
                                    item =>
                                        item.itemType !== "submittedData" ||
                                        item.creationDate > new Date(Date.now() - 3600000)
                                );
                        }
                    }
                    this.tabStates.get(tabId).frames.set(frameId, new FrameState());
                    this.tabStates.get(tabId).framePorts.set(frameId, p);
                    p.postMessage(connectMessage);
                    if (frameId === 0) {
                        this.offerSaveNotice(tabId);
                        offerPendingOtpSetup(tabId, p.sender.url ?? p.sender.tab.url);
                    }
                    break;
                }
                case "iframe": {
                    p.onMessage.addListener(iframeMessageHandler.bind(p));
                    p.onDisconnect.addListener(() => {
                        this.tabStates
                            .get(p.sender.tab.id)
                            ?.ourIframePorts?.delete(p.sender.frameId);
                    });

                    const connectMessage = {
                        initialState: this.store.state,
                        frameState: this.tabStates
                            .get(p.sender.tab.id)
                            .frames.get(parentFrameId),
                        frameId: p.sender.frameId,
                        tabId: p.sender.tab.id,
                        isForegroundTab: p.sender.tab.id === this.foregroundTabId
                    } as AddonMessage;

                    if (this.persistentTabStates.get(p.sender.tab.id)) {
                        this.persistentTabStates.get(p.sender.tab.id).items.forEach(item => {
                            if (item.itemType === "submittedData") {
                                connectMessage.submittedData = item.submittedData;
                            }
                        });
                    }

                    p.postMessage(connectMessage);
                    this.tabStates
                        .get(p.sender.tab.id)
                        .ourIframePorts.set(p.sender.frameId, p);
                    break;
                }
            }
        };
    }

    frameIdWithMatchedLogins(frames: Map<number, FrameState>) {
        let frameId = -1;
        frames.forEach((frame, i) => {
            if (frameId == -1 && frame && frame.entries && frame.entries.length > 0) frameId = i;
        });
        return frameId;
    }

    async init(): Promise<boolean> {
        this._keeBrowserStartup();

        // Edges eigene Passwortspeicherung nur abschalten, wenn gewünscht (Einstellung, Standard an)
        try {
            if (configManager.current.ferryDisableBrowserPasswordSaving !== false) {
                await chrome.privacy.services.passwordSavingEnabled.set({ value: false });
            } else {
                await chrome.privacy.services.passwordSavingEnabled.clear({});
            }
        } catch (e) {
            KeeLog.warn("Could not change the browser's password saving setting: " + e);
        }

        if (chrome.runtime.lastError != null) {
            KeeLog.warn(
                "KeeFox was unable to disable built-in password manager saving - confusion may ensue! " +
                chrome.runtime.lastError.message
            );
        }
        return true;
    }

    notifyUser(notification: KeeNotification, nativeNotification?: NativeNotification) {
        this.removeUserNotifications((n: KeeNotification) => n.name != notification.name);
        this.store.addNotification(notification);
        this.configureBrowserActionIcon();
        if (nativeNotification) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
                title: nativeNotification.title,
                message: nativeNotification.message
            });
        } else {
            if (configManager.current.notificationCountGeneric < 5) {
                // Der eigentliche Hinweis statt eines allgemeinen Texts; ein Klick öffnet das Popup mit dem ganzen Hinweis
                chrome.notifications.create(OPEN_POPUP_NOTIFICATION_PREFIX + notification.id, {
                    type: "basic",
                    iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
                    title: "KeePassFerry",
                    message: notification.messages?.[0] ?? $STR("notification_raised_title"),
                    contextMessage: $STR("ferry_notification_click_to_open")
                });
                configManager.setASAP({
                    notificationCountGeneric: configManager.current.notificationCountGeneric + 1
                });
            }
        }
    }

    removeUserNotifications(unlessTrue: (notification: KeeNotification) => boolean) {
        this.store.updateNotifications(this.store.state.notifications.filter(unlessTrue));
    }

    configureBrowserActionIcon() {
        const actionConfig = new KeeBrowserActionIconConfiguration();

        actionConfig.saveAvailable = false;
        if (this.persistentTabStates.get(this.foregroundTabId)) {
            this.persistentTabStates
                .get(this.foregroundTabId)
                .items.forEach(item => {
                    if (item.itemType === "submittedData") {
                        actionConfig.saveAvailable = true;
                    }
                });
        }

        actionConfig.matchedEntries = 0;
        //TODO:f: Support number of matched entries on the icon if we can find a way to ensure the data in the store or
        // tabState is up to date and relevant for the current tab when this function runs.
        // if (this.tabStates.has(this.foregroundTabId)) {
        //     const frames = this.tabStates.get(this.foregroundTabId).frames;
        //     const matchedFrameID = this.frameIdWithMatchedLogins(frames);
        //     if (matchedFrameID >= 0) {
        //         actionConfig.matchedEntries = frames.get(matchedFrameID).entries.length;
        //     }
        // }

        actionConfig.connectionAvailable = this.store.state.connected;
        actionConfig.dbAvailable = this.store.state.KeePassDatabases.length > 0;
        actionConfig.notificationAvailable = this.store.state.notifications.length > 0;

        const iconPath = actionConfig.notificationAvailable || actionConfig.saveAvailable ? "/assets/images/highlight-48.png" : "/assets/images/48.png";
        const offline = !actionConfig.connectionAvailable || !actionConfig.dbAvailable;
        const showSave = !offline && actionConfig.saveAvailable;
        // Gesperrt: Schloss im Symbol selbst (wie am Feld), kein Textabzeichen
        const text = !actionConfig.connectionAvailable ? "OFF" : !actionConfig.dbAvailable ? "" : showSave ? "+" : (actionConfig.matchedEntries > 0 ? actionConfig.matchedEntries.toString() : "");
        const color = !actionConfig.connectionAvailable ? "red" : !actionConfig.dbAvailable ? "orange" : showSave ? SAVE_BADGE_COLOR : "blue";
        const notRunning = !actionConfig.connectionAvailable;
        const locked = actionConfig.connectionAvailable && !actionConfig.dbAvailable;
        const title = notRunning
            ? $STR("action_keepass_not_running")
            : locked
                ? $STR("action_unlock_keepass")
                : showSave
                    ? $STR("saveNotice_title")
                    : "KeePassFerry";
        // Gesperrt: Klick aufs Icon entsperrt direkt (kein Popup dazwischen)
        chrome.action.setPopup({ popup: locked ? "" : "dist/popup/index.html" });
        if (this.saveAttentionTimer !== null) {
            // Blinken läuft: nur Icon und Titel setzen, das Badge steuert der Timer
            chrome.action.setIcon({ path: iconPath });
            chrome.action.setTitle({ title: title });
            return;
        }
        if (locked) {
            this.lockedActionIcon()
                .then(imageData => chrome.action.setIcon({ imageData }))
                .catch(() => chrome.action.setIcon({ path: iconPath }));
        } else {
            chrome.action.setIcon({ path: iconPath });
        }
        chrome.action.setBadgeText({ text: text });
        chrome.action.setBadgeBackgroundColor({ color: color });
        chrome.action.setTitle({title: title});
    }

    // Symbol der Symbolleiste für "gesperrt": KeePassFerry-Symbol mit oranger Plakette und weißem Schloss unten rechts
    private lockedActionIconPromise: Promise<Record<string, ImageData>> = null;
    private lockedActionIcon(): Promise<Record<string, ImageData>> {
        if (!this.lockedActionIconPromise) {
            this.lockedActionIconPromise = (async () => {
                const blob = await (await fetch(chrome.runtime.getURL("/assets/images/48.png"))).blob();
                const bitmap = await createImageBitmap(blob);
                const result: Record<string, ImageData> = {};
                for (const size of [16, 32]) {
                    const canvas = new OffscreenCanvas(size, size);
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(bitmap, 0, 0, size, size);
                    const r = size * 0.3;
                    const cx = size - r;
                    const cy = size - r;
                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath();
                    ctx.arc(cx, cy, r + Math.max(1, size * 0.05), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = LOCK_COLOR;
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fill();
                    drawLockGlyph(ctx, cx, cy, r * 1.25);
                    result[String(size)] = ctx.getImageData(0, 0, size, size);
                }
                bitmap.close();
                return result;
            })();
            this.lockedActionIconPromise.catch(() => (this.lockedActionIconPromise = null));
        }
        return this.lockedActionIconPromise;
    }

    private unlockGlobalPauseUntil = 0;
    private unlockDomainPauseUntil = new Map<string, number>();
    private unlockAttempt: { domain: string; at: number } = null;

    // KeePass ist verbunden, aber gesperrt, und eine Seite braucht Zugangsdaten: im Hintergrund entsperren
    // lassen (KeePassWinHello zeigt dabei nur die Windows-Hello-Abfrage). Bremsen: nur aktiver Tab im
    // fokussierten Fenster, nie zwei Abfragen gleichzeitig; nach Abbruch 1 min insgesamt und 10 min je Seite Ruhe.
    async requestBackgroundUnlock(tabId: number, url: string, manual = false): Promise<string> {
        diag("hintergrund", "entsperren gewünscht", {
            manuell: manual,
            verbunden: this.store.state.connected,
            offeneDbs: this.store.state.KeePassDatabases.length,
            letzterVersuchVorSek: this.unlockAttempt ? Math.round((Date.now() - this.unlockAttempt.at) / 1000) : null
        });
        if (!this.store.state.connected || this.store.state.KeePassDatabases.length > 0) return "notLocked";
        const domain = KeeURL.fromString(url ?? "")?.domainOrIPAddress ?? "";
        const now = Date.now();
        if (!manual) {
            if (now < this.unlockGlobalPauseUntil) return "paused";
            if (domain && now < (this.unlockDomainPauseUntil.get(domain) ?? 0)) return "paused";
            try {
                const tab = await chrome.tabs.get(tabId);
                const win = await chrome.windows.get(tab.windowId);
                if (!tab.active || !win.focused) return "background";
            } catch (e) {
                return "background";
            }
        }
        // Bewusster Klick: immer an KeePass weitergeben (holt ggf. den offenen Dialog nach vorne)
        if (!manual && this.unlockAttempt && now - this.unlockAttempt.at < 30000) return "busy";

        const result = await this.KeePassRPC.requestUnlock();
        diag("hintergrund", "entsperren angestoßen", { manuell: manual, ergebnis: result });
        if (result !== "started") return result;
        const attempt = { domain, at: now };
        this.unlockAttempt = attempt;
        // Bleibt die Datenbank gesperrt, wurde die Abfrage wohl abgebrochen: eine Weile nicht erneut fragen
        self.setTimeout(() => {
            if (this.unlockAttempt !== attempt) return;
            this.unlockAttempt = null;
            if (this.store.state.KeePassDatabases.length === 0) {
                this.unlockGlobalPauseUntil = Date.now() + 60 * 1000;
                if (attempt.domain) this.unlockDomainPauseUntil.set(attempt.domain, Date.now() + 10 * 60 * 1000);
            }
        }, 45000);
        return result;
    }

    // "Speichern möglich": ruhiges "+" am Symbol; auffällig ist der Hinweis auf der Seite, kein Blinken mehr
    startSaveAttention() {
        if (this.saveAttentionTimer !== null) clearInterval(this.saveAttentionTimer);
        this.saveAttentionTimer = null;
        this.configureBrowserActionIcon();
    }

    // Schickt den Speichern-Hinweis an den obersten Frame des Tabs, falls noch nicht weggeklickt
    offerSaveNotice(tabId: number) {
        const item = this.persistentTabStates
            .get(tabId)
            ?.items?.find(i => i.itemType === "submittedData");
        if (!item || item.noticeDismissed) return;
        if (!this.store.state.connected || this.store.state.KeePassDatabases.length === 0) return;
        try {
            this.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({ action: Action.ShowSaveNotice });
        } catch (e) {
            // Seite lädt gerade neu; der Hinweis kommt beim nächsten Verbinden
        }
    }

    // Sucht den passenden Eintrag mit TOTP für eine Seite und liefert den aktuellen Code.
    // Ist der zuletzt im Tab ausgefüllte Eintrag bekannt (gleiche Domain, < 15 min), zählt nur dieser.
    // Sonst nur, wenn genau ein passender Eintrag der Seite ein TOTP hat (mehrere Konten = nicht eindeutig).
    async findTotpCode(tabId: number, url: string): Promise<{ code: string; remainingSeconds: number; period: number }> {
        const domain = KeeURL.fromString(url)?.domainOrIPAddress;
        if (!domain) return null;

        const getTotp = async (candidate: { uuid: string; dbFileName: string }) => {
            try {
                const result = await this.KeePassRPC.getTotp(candidate.uuid, candidate.dbFileName);
                diag("hintergrund", "otp eintrag geprüft", { uuid: candidate.uuid, hatOtp: !!result?.code });
                return result?.code ? result : null;
            } catch (e) {
                diag("hintergrund", "otp abfrage fehlgeschlagen", { uuid: candidate.uuid, db: candidate.dbFileName, fehler: String(e) });
                return null;
            }
        };

        let chosen: { uuid: string; dbFileName: string } = null;
        let result: { code: string; remainingSeconds: number; period: number } = null;
        const last = this.persistentTabStates.get(tabId)?.lastFilledEntry;
        if (last && sameSite(last.domain, domain) && last.at > Date.now() - 15 * 60 * 1000) {
            chosen = { uuid: last.uuid, dbFileName: last.dbFileName };
            result = await getTotp(chosen);
            diag("hintergrund", "otp kandidaten", {
                domain,
                zuletztBenutzt: { uuid: last.uuid, alterSek: Math.round((Date.now() - last.at) / 1000) },
                hatOtp: !!result
            });
        } else {
            const found = await this.KeePassRPC.findLogins(url, null, null, null, null, null);
            const withTotp: { candidate: { uuid: string; dbFileName: string }; result: typeof result }[] = [];
            for (const entry of (found ?? []).slice(0, 10)) {
                const candidate = { uuid: entry.uuid, dbFileName: entry.database.fileName };
                const r = await getTotp(candidate);
                if (r) withTotp.push({ candidate, result: r });
                if (withTotp.length > 1) break;
            }
            diag("hintergrund", "otp kandidaten", {
                domain,
                zuletztBenutzt: null,
                seitenTreffer: (found ?? []).length,
                mitOtp: withTotp.map(w => w.candidate.uuid)
            });
            if (withTotp.length === 1) {
                chosen = withTotp[0].candidate;
                result = withTotp[0].result;
            }
        }
        if (!result) return null;

        // Kurz vor dem Wechsel lieber auf den nächsten Code warten
        if (result.remainingSeconds <= 2) {
            await new Promise(resolve => self.setTimeout(resolve, (result.remainingSeconds + 1) * 1000));
            result = await getTotp(chosen);
        }
        return result ? { code: result.code, remainingSeconds: result.remainingSeconds, period: result.period || 30 } : null;
    }

    resetBrowserActionColor() {
        chrome.action.setIcon({ path: "/assets/images/48.png" });
    }

    _keeBrowserStartup() {
        KeeLog.debug("Kee initialising");
        this.KeePassRPC = new jsonrpcClient(this.store);
        KeeLog.info(
            "Kee initialised OK although the connection to a KeePassRPC server is probably not established just yet..."
        );
    }

    // Temporarily disable Kee. Used (for e.g.) when KeePass is shut down.
    _pauseKee() {
        KeeLog.debug("Pausing Kee.");
        this.store.updateKeePassDatabases([]);
        this.store.updateActiveKeePassDatabaseIndex(-1);
        this.store.updateConnected(false);
        this.store.updateConnectedWebsocket(false);
        this.store.updateCurrentSearchTerm(null);
        this.store.updateSearchResults(null);

        try {
            this.refreshFormStatus(Action.ResetForms);
        } catch (e) {
            KeeLog.error(
                "Uncaught exception posting message in _pauseKee: " + e.message + " : " + e.stack
            );
        }
        this.configureBrowserActionIcon();

        commandManager.setupContextMenuItems();

        KeeLog.info("Kee paused.");
    }

    _refreshKPDB() {
        this.getAllDatabases();
        KeeLog.debug("Refresh of Kee's view of the KeePass database initiated.");
    }

    // Prüft abgeschickte Formulardaten gegen KeePass: true, wenn ein Eintrag der Seite denselben Benutzernamen
    // und (falls mitgeschickt) dasselbe Passwort hat. Ohne Verbindung oder bei Fehlern: false (Hinweis wie bisher).
    async submittedDataIsKnown(submitted: { url: string; fields: { type: string; value: string }[] }): Promise<boolean> {
        try {
            if (!this.store.state.connected || this.store.state.KeePassDatabases.length === 0) return false;
            const fields = submitted?.fields ?? [];
            const password = fields.find(f => f.type === "password" && f.value)?.value ?? null;
            const username = fields.find(f => f.type !== "password" && f.type !== "boolean" && f.value)?.value ?? null;
            if (!password && !username) return false;
            const entries: Entry[] =
                (await Promise.race([
                    this.KeePassRPC.findLogins(submitted.url, null, null, null, null, null),
                    new Promise<Entry[]>(resolve => self.setTimeout(() => resolve(null), 2000))
                ])) ?? [];
            return entries.some(e => {
                const user = Entry.getUsernameField(e)?.value ?? "";
                const pass = Entry.getPasswordField(e)?.value ?? "";
                if (password && pass !== password) return false;
                if (username && user.toLowerCase() !== username.toLowerCase()) return false;
                return true;
            });
        } catch (e) {
            KeeLog.debug("submittedDataIsKnown failed: " + e);
            return false;
        }
    }

    // Popup auf Seiten ohne Anmeldeformular (z. B. Zwei-Faktor-Abfrage): Einträge dieser Website, der im Tab
    // zuletzt benutzte zuerst, dann direkte Treffer, dann über zugehörige Domains. Höchstens 2,5 s warten
    // (mit zugehörigen Domains sind es zwei Suchen), damit das Popup nicht hängt.
    async siteEntriesForPopup(tabId: number): Promise<Entry[]> {
        try {
            if (!this.store.state.connected || this.store.state.KeePassDatabases.length === 0) return [];
            const tab = await chrome.tabs.get(tabId);
            if (!tab?.url || !/^https?:/.test(tab.url)) return [];
            const timeout = <T>(p: Promise<T>) =>
                Promise.race([p, new Promise<T>(resolve => self.setTimeout(() => resolve(null), 2500))]);

            const result: Entry[] = [];
            const last = this.persistentTabStates.get(tabId)?.lastFilledEntry;
            const domain = KeeURL.fromString(tab.url)?.domainOrIPAddress;
            if (last && sameSite(last.domain, domain)) {
                const lastEntries: Entry[] = (await timeout(this.KeePassRPC.findLogins(tab.url, null, last.uuid, last.dbFileName, null, null))) ?? [];
                result.push(...lastEntries.filter(e => e.uuid === last.uuid));
            }
            const found: Entry[] = (await timeout(this.KeePassRPC.findLogins(tab.url, null, null, null, null, null))) ?? [];
            for (const e of found) if (!result.some(r => r.uuid === e.uuid)) result.push(e);
            // Seiten großer Anbieter (z. B. Microsoft) passen mit zugehörigen Domains zu vielen Einträgen; die Liste scrollt
            return result.slice(0, 30);
        } catch (e) {
            KeeLog.debug("siteEntriesForPopup failed: " + e);
            return [];
        }
    }

    updateKeePassDatabases(newDatabases: Database[]) {
        //TODO:5: To improve performance we might need to determine if anything
        // has actually changed before doing the dispatches and poking the
        // current tab frames to find entries
        let newDatabaseActiveIndex = -1;
        for (let i = 0; i < newDatabases.length; i++) {
            if (newDatabases[i].active) {
                newDatabaseActiveIndex = i;
                break;
            }
        }
        // Bleiben dieselben Datenbanken offen (z. B. nach dem Speichern eines Eintrags), Suche im Popup behalten:
        // mit gleichem Suchbegriff neu ausführen und bereits geladene Details aufgeklappter Einträge übernehmen
        const previousTerm = this.store.state.currentSearchTerm;
        const becameAvailable = this.store.state.KeePassDatabases.length === 0 && newDatabases.length > 0;
        const previousResults = this.store.state.searchResults ?? [];
        const sameDatabases =
            this.store.state.KeePassDatabases.map(db => db.fileName).join("|") ===
            newDatabases.map(db => db.fileName).join("|");

        this.store.updateConnected(true);
        this.store.updateConnectedWebsocket(this.KeePassRPC.websocketSessionManagerIsActive);
        this.store.updateKeePassDatabases(newDatabases);
        this.store.updateActiveKeePassDatabaseIndex(newDatabaseActiveIndex);
        if (newDatabases.length > 0) this.unlockAttempt = null;
        if (sameDatabases && previousTerm) {
            const fresh = (this.search.execute(previousTerm, undefined, []) ?? []) as any[];
            const merged = fresh.map(r => {
                const old = previousResults.find(o => o.uuid === r.uuid && o.dbFileName === r.dbFileName);
                return old?.fullDetails ? { ...r, fullDetails: old.fullDetails } : r;
            });
            this.store.updateSearchResults(merged);
        } else {
            this.store.updateSearchResults(null);
            this.store.updateCurrentSearchTerm(null);
        }

        KeeLog.info("Number of databases open: " + newDatabases.length);

        this.configureBrowserActionIcon();

        if (configManager.current.rememberMRUDB) {
            const MRUFN = this.getDatabaseFileName();
            if (MRUFN != null && MRUFN != undefined) configManager.current.keePassMRUDB = MRUFN;
            configManager.save();
        }

        try {
            this.refreshFormStatus(Action.DetectForms);
        } catch (e) {
            KeeLog.error(
                "Uncaught exception posting message in updateKeePassDatabases: " +
                e.message +
                " : " +
                e.stack
            );
        }

        commandManager.setupContextMenuItems();

        // Nach dem Entsperren die Seite im aktiven Tab sofort neu durchsuchen (damit gleich ausgefüllt wird)
        if (becameAvailable) this.rescanActiveTab();
    }

    private async rescanActiveTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab || tab.id == null) return;
            this.foregroundTabId = tab.id;
            this.tabStates.get(tab.id)?.framePorts?.forEach(port => {
                try {
                    port.postMessage({ action: Action.DetectForms, resetState: this.store.state } as AddonMessage);
                } catch (e) {
                    // Frame gibt es nicht mehr
                }
            });
        } catch (e) {
            KeeLog.debug("Rescan after unlock failed: " + e);
        }
    }

    private refreshFormStatus(action: Action) {
        this.tabStates.forEach((ts, tabId) => {
            //TODO:5: This should be equivalent but much faster than testing in the inner
            // loop. Unless tabId does not equal port.sender.tab.id?
            //if (tabId !== this.foregroundTabId) return;

            ts.framePorts.forEach((port, key, map) => {
                try {
                    if (port.sender.tab.id === this.foregroundTabId) {
                        port.postMessage({ action } as AddonMessage);
                    }
                } catch (e) {
                    if (KeeLog && KeeLog.info) {
                        KeeLog.info(
                            "failed to request form field reset/update on tab " +
                            tabId +
                            ". Assuming port is broken (possible browser bug) and deleting the port. " +
                            "Kee may no longer work in the affected tab, if indeed the tab even " +
                            "exists any more. The exception that caused this is: " +
                            e.message +
                            " : " +
                            e.stack
                        );
                    }
                    map.delete(key);
                }
            }, this);
        }, this);
    }

    // if the MRU database is known, open that but otherwise send empty string which will cause user
    // to be prompted to choose a DB to open
    getKeePassFileNameToOpen() {
        return configManager.current.keePassDBToOpen || configManager.current.keePassMRUDB || "";
    }

    openKeePass() {
        const hasWebsocketDBs = this.store.state.KeePassDatabases.some(
            db => db.sessionType === SessionType.Websocket
        );
        const supportsWebsocketFocus = this.store.state.KeePassDatabases.some(
            db =>
                db.sessionType === SessionType.Websocket &&
                db.sessionFeatures.indexOf("KPRPC_OPEN_AND_FOCUS_DATABASE") >= 0
        );

        if (hasWebsocketDBs && !supportsWebsocketFocus) {
            KeeLog.warn(
                "Can't open KeePass because KeePassRPC version does not support KPRPC_OPEN_AND_FOCUS_DATABASE"
            );
            return;
        }

        this.selectDatabase(
            this.getKeePassFileNameToOpen(),
            !hasWebsocketDBs,
            SessionType.Websocket
        );
    }

    async loginToPasswordManager() {
        await this.selectAndFocusDatabase(this.getKeePassFileNameToOpen());
    }

    recordEntrySaveResult(saveType: "updated" | "created", entry?: Entry) {
        if (!entry) {
            this.store.updateSaveEntryResult({
                result: "error",
                receivedAt: new Date()
            } as SaveEntryResult);
            return false;
        } else {
            this.store.updateSaveEntryResult({
                result: saveType,
                receivedAt: new Date(),
                fileName: entry.database.fileName,
                uuid: entry.uuid
            } as SaveEntryResult);
            return true;
        }
    }

    /*******************************************
    / These functions are essentially wrappers for the actions that
    / Kee needs to take against KeePass via the KeePassRPC plugin connection.
    /*******************************************/

    getDatabaseName(index) {
        if (index == undefined) index = this.store.state.ActiveKeePassDatabaseIndex;
        if (
            this.store.state.KeePassDatabases.length > 0 &&
            this.store.state.KeePassDatabases[index] != null &&
            this.store.state.KeePassDatabases[index].root != null
        ) {
            return this.store.state.KeePassDatabases[index].name;
        } else return null;
    }

    getDatabaseFileName(index?) {
        if (index == undefined) index = this.store.state.ActiveKeePassDatabaseIndex;
        if (
            this.store.state.KeePassDatabases.length > 0 &&
            this.store.state.KeePassDatabases[index] != null &&
            this.store.state.KeePassDatabases[index].root != null
        ) {
            return this.store.state.KeePassDatabases[index].fileName;
        } else return null;
    }

    selectDatabase(fileName, requestReturnFocus, sessionType?: SessionType) {
        try {
            this.KeePassRPC.selectDB(fileName, requestReturnFocus, sessionType);
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    selectAndFocusDatabase(keepassFilename: string) {
        try {
            return this.KeePassRPC.selectAndFocusDatabase(keepassFilename);
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    async addLogin(
        entry: Entry,
        parentUUID: string,
        dbFileName: string,
        clearSubmittedData: () => void
    ) {
        try {
            const newEntry = await this.KeePassRPC.addLogin(entry, parentUUID, dbFileName);
            const success = this.recordEntrySaveResult("created", newEntry);
            if (success) {
                clearSubmittedData();
                await this.refreshAfterEntryChange();
            }
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    async updateLogin(
        entry: Entry,
        oldLoginUUID: string,
        dbFileName: string,
        clearSubmittedData: () => void
    ) {
        try {
            const changedEntry = await this.KeePassRPC.updateLogin(entry, oldLoginUUID, dbFileName);
            const success = this.recordEntrySaveResult("updated", changedEntry);
            if (success) {
                clearSubmittedData();
                await this.refreshAfterEntryChange();
            }
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    // Nach dem Ändern eines Eintrags: Datenbankansicht neu laden und die Seite neu nach passenden Einträgen
    // suchen lassen (sonst zeigen Popup und Feldsymbole die beim Laden der Seite gefundenen, alten Daten)
    async refreshAfterEntryChange() {
        try {
            await this.KeePassRPC.getAllDatabases();
        } catch (e) {
            KeeLog.debug("Refresh after entry change failed: " + e);
        }
        this.refreshFormStatus(Action.DetectForms);
    }

    getAllDatabases() {
        try {
            return this.KeePassRPC.getAllDatabases();
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    async findLogins(fullURL, httpRealm, uuid, dbFileName, freeText, username) {
        try {
            return this.KeePassRPC.findLogins(
                fullURL,
                httpRealm,
                uuid,
                dbFileName,
                freeText,
                username
            );
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    launchLoginEditor(uuid, dbFileName) {
        try {
            this.KeePassRPC.launchLoginEditor(uuid, dbFileName);
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    launchGroupEditor(uuid, dbFileName) {
        try {
            this.KeePassRPC.launchGroupEditor(uuid, dbFileName);
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    async getPasswordProfiles() {
        try {
            return this.KeePassRPC.getPasswordProfiles();
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    async generatePassword(profileName: string, url: string) {
        try {
            return this.KeePassRPC.generatePassword(profileName, url);
        } catch (e) {
            KeeLog.error(
                "Unexpected exception while connecting to KeePassRPC. Please inform the Kee team that they should be handling this exception: " +
                e
            );
            throw e;
        }
    }

    // Could use multiple callback functions but just one keeps KeePassRPC simpler
    // this is only called once no matter how many windows are open. so functions
    // within need to handle all open windows for now, that just means every
    // window although in future maybe there could be a need to store a list of
    // relevant windows and call those instead
    KPRPCListener(sig) {
        const sigTime = Date();

        KeeLog.debug("Signal received by KPRPCListener (" + sig + ") @" + sigTime);

        let refresh = false;

        switch (sig) {
            case "0":
                KeeLog.warn("KeePassRPC is requesting authentication [deprecated].");
                break;
            case "3":
                KeeLog.info("KeePass' currently active DB is about to be opened.");
                break;
            case "4":
                KeeLog.info("KeePass' currently active DB has just been opened.");
                refresh = true;
                break;
            case "5":
                KeeLog.info("KeePass' currently active DB is about to be closed.");
                break;
            case "6":
                KeeLog.info("KeePass' currently active DB has just been closed.");
                refresh = true;
                break;
            case "7":
                KeeLog.info("KeePass' currently active DB is about to be saved.");
                break;
            case "8":
                KeeLog.info("KeePass' currently active DB has just been saved.");
                refresh = true;
                break;
            case "9":
                KeeLog.info("KeePass' currently active DB is about to be deleted.");
                break;
            case "10":
                KeeLog.info("KeePass' currently active DB has just been deleted.");
                break;
            case "11":
                KeeLog.info("KeePass' active DB has been changed/selected.");
                refresh = true;
                break;
            case "12":
                KeeLog.info(
                    "KeePass is shutting down. [deprecated: Now inferred from connection loss]"
                );
                break;
            default:
                KeeLog.error("Invalid signal received by KPRPCListener (" + sig + ")");
                break;
        }

        if (!refresh) return;

        const now = new Date().getTime();
        if (refresh) {
            this.store.updateLastKeePassRPCRefresh(now);
            this._refreshKPDB();
        }

        KeeLog.debug("Signal handled. @" + sigTime);
    }

    createTabStateIfMissing(tabId: number) {
        if (!this.tabStates.has(tabId)) {
            this.tabStates.set(tabId, new TabState());
        }
    }

    deleteTabState(tabId: number) {
        this.tabStates.delete(tabId);
    }

    initiatePasswordGeneration() {
        if (this.store.state.connected) {
            const tabState = this.tabStates.get(this.foregroundTabId);
            if (tabState) {
                const framePort = tabState.framePorts.get(0);
                if (framePort) {
                    framePort.postMessage({ action: Action.GeneratePassword });
                    return;
                }
            }
        }
    }
}

export const kee = Kee.getInstance();
