import { diag } from "./ferryDiag";
import { getOtpSetupForPopup, getOtpSetupSummary, applyOtpSetup, forgetOtpSetup } from "./otpSetup";
import { parseOtpauth } from "../common/otpauth";
import { forgetAutoFill } from "./otpRepeat";
import { getSelectionSaveForPopup, createSelectionEntry, findEntryForEdit, forgetSelectionSave } from "./selectionSave";
import { takePendingEdit } from "./popupEdit";
import { queryPageFields, fillPageField } from "./pageFields";
import { ENTRY_RECYCLE_FEATURE, FIELD_PROTECTION_FEATURE, HIBP_CHECK_FEATURE, HIBP_LEAKS_FEATURE, EXPIRY_FEATURE, OPTIONS_DIALOG_FEATURE, pluginUpdateAvailable, pluginVersionFrom } from "../common/FeatureFlags";
import { markNewsSeen } from "../common/whatsNew";
import { isFirefox } from "webext-detect-page";
import { ferry, OPEN_POPUP_NOTIFICATION_PREFIX } from "./KF";
import { commandManager } from "./commands";
import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";
import { NetworkAuth, onNetworkRequestCompleted, onNetworkRequestFailed } from "./NetworkAuth";
import { pageStateOf } from "./pageState";
import { appleChangePasswordUrl, changePasswordUrl } from "./changePassword";
import { forgetExpiryNotice } from "./expiryNotice";
import { startPluginUpdate } from "./messageHandlers";
import { copyStringToClipboard } from "../common/copyStringToClipboard";

function appleChangePasswordUrlFor(entryUrl: string): string {
    try {
        const u = new URL(entryUrl);
        return u.protocol === "https:" ? appleChangePasswordUrl(u.hostname) : null;
    } catch {
        return null;
    }
}

// only on dev mode
if (import.meta.hot) {
    // @ts-expect-error for background HMR
    import("/@vite/client");
    // doesn't appear to work in MV3
    // load latest content script
    // import("./contentScriptHMR");
}


let resolveInitialised: (value?: boolean | PromiseLike<boolean>) => void;

// We can't do anything useful if we fail to initialise so just crash and let this Promise get GCd
const initialised: Promise<boolean> = new Promise((resolve, _) => {
    resolveInitialised = resolve;
});

let hasInitialised = false;
let initialising = false;

const userBusySeconds = 60 * 15;
const maxUpdateDelayMinutes = 60 * 8;

// window.FerryPersistentLogger = new PersistentLogger();

const networkAuth = new NetworkAuth();

// Make sure user knows we're not ready yet
chrome.action.setBadgeText({ text: "OFF" });
chrome.action.setBadgeBackgroundColor({ color: "red" });
chrome.action.disable();

//TODO: Remove all 'console.debug("LIFECYCLE: ' messages once dust has settled from MV3 migration
// Since we're not sure of the status of our own logging infrastructure at
// these lifecycle points, we have to just output using the console.
console.debug("LIFECYCLE: main disabled action");

async function ensureStarted() {
    if (initialising || hasInitialised) {
        return;
    }
    try {
        initialising = true;
        await configManager.load();
        console.debug("LIFECYCLE: startup");
        // Useful for interactive debugging:
        // window.FerryPersistentLogger.init(configManager.current.logLevel >= 4);
        FerryLog.attachConfig(configManager.current);
        await showReleaseNotesAfterUpdate();
        resolveInitialised(await ferry.init());
        hasInitialised = true;
        chrome.action.enable();
        console.debug("LIFECYCLE: main enabled action");
    }
    finally {
        initialising = false;
    }
}

async function showReleaseNotesAfterUpdate() {
    // chrome.runtime.onInstalled is not reliably called after an update. E.g.
    // in Firefox after a browser restart. Hence we must track the recent update
    // using our async config store rather than rely on the runtime event being fired.
    // Also a now-fixed Chrome issue - https://issues.chromium.org/issues/41116832
    // Maybe original Firefox bug upon restart has been fixed by now but in any case
    // there are other ongoing issues that require us to track this information
    // ourselves including:
    // https://github.com/w3c/webextensions/issues/353
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1700797
    // Also seems Chrome fails if it is also recovering from a crashed browser
    // as part of the initial install operation (may only be possible in development)
    // KeePassFerry öffnet nach einem Update keine Seite (die alte Kee-Seite warb für KeePassFerry Vault); die Änderungen
    // stehen im CHANGELOG bzw. im GitHub-Release. Das Merkmal bleibt für den verzögerten Neustart (Alarm unten).
    if (configManager.current.mustShowReleaseNotesAtStartup) {
        configManager.setASAP({ mustShowReleaseNotesAtStartup: false });
    }
}

function onTabActivated(tabId) {
    updateForegroundTab(tabId);

    if (ferry) {
        // May not have set up KeePassFerry yet
        commandManager.setupContextMenuItems();
    }
}

function updateForegroundTab(tabId: number) {
    if (ferry && ferry.foregroundTabId !== tabId) {
        // May not have set up KeePassFerry yet
        ferry.foregroundTabId = tabId;
        const ports = ferry.tabStates.get(tabId)?.framePorts;
        if (ports) {
            // May not have set up port yet
            if (FerryLog && FerryLog.debug) FerryLog.debug("KeePassFerry activated on tab: " + tabId);

            ports.forEach((port, frameIndex) => {
                try {
                    port.postMessage({
                        isForegroundTab: true,
                        action: Action.DetectForms,
                        resetState: pageStateOf(ferry.store.state)
                    } as AddonMessage);
                } catch (e) {
                    if (FerryLog && FerryLog.warn) FerryLog.warn("Failed to post a message to a foreground tab port. Will remove the port now.");
                    ports.delete(frameIndex);
                }
            });
        }
    }
}

//TODO: Below seems likely still required. need to check if friefox has changed behaviour in mv3 mode too.
// Some browsers (e.g. Firefox) automatically inject content scripts on install/update
// but others don't (e.g. Chrome). To ensure every existing tab has exactly one
// instance of this content script running in it, we programmatically inject the script.
if (!isFirefox()) {
    chrome.runtime.onInstalled.addListener(() => {
        chrome.runtime.getManifest().content_scripts?.forEach(async script => {
            const allFrames = script.all_frames;
            const url = script.matches;

            const loadOperations = [];
            const loadContentScripts = (tab: chrome.tabs.Tab) => {
                // Firefox used to open every new tab with an about page so maybe it was important
                // to not block that injection but I think that is no longer an issue so we can
                // avoid the log noise by skipping those pages now.
                if (tab.url && /^(about|chrome|edge):/.test(tab.url)) return;
                // Seiten ohne Zugriff für Erweiterungen (Add-on-Stores, PDF-Ansicht, Fehlerseiten) lehnen das Einspielen
                // ab: je Tab abfangen, sonst erscheinen die übrigen Ablehnungen als "Uncaught" in der Fehlerliste
                const quiet = (p: Promise<unknown>) =>
                    p.catch(e => {
                        if (FerryLog && FerryLog.debug) FerryLog.debug("Content script not injected into tab " + tab.id + ": " + e?.message);
                    });
                if (script?.js?.length > 0) {
                    loadOperations.push(quiet(chrome.scripting.executeScript({
                        target: { tabId: tab.id, allFrames },
                        files: script.js,
                        // Passkey-Skript gehört in die Seitenwelt (MAIN), alle anderen in die Erweiterungswelt
                        world: (script as any).world === "MAIN" ? "MAIN" : "ISOLATED"
                    } as any)));
                }
                if (script?.css?.length > 0) {
                    loadOperations.push(quiet(chrome.scripting.insertCSS({
                        target: { tabId: tab.id, allFrames },
                        files: script.css
                    })));
                }
            };
            try {
                const tabs = await chrome.tabs.query({ url });
                tabs.forEach(loadContentScripts);
                await Promise.all(loadOperations);
            } catch (e) {
                if (!(e.message as string).endsWith(" is showing error page")) {
                    if (FerryLog && FerryLog.error) FerryLog.error(e.message);
                    else console.error(e);
                }
            }
        });
    });
}

chrome.runtime.onInstalled.addListener(async function (details) {
    if (details.reason === "install") {
        // Neue Nutzer bekommen die Installationsseite, keinen Hinweis "Neu in dieser Version"
        markNewsSeen();
        chrome.tabs.create({
            url: "/dist/install-notes/index.html"
        });
    }
});

chrome.windows.onFocusChanged.addListener(async function (windowId) {
    if (FerryLog && FerryLog.debug) FerryLog.debug("Focus changed for id: " + windowId);
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        const tabs = await chrome.tabs.query({
            active: true,
            windowId: windowId
        });
        if (tabs[0] && tabs[0].id != null) onTabActivated(tabs[0].id);
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const request = msg?.keepassferry;
    if (!request) return;
    // Nur Seiten der Erweiterung selbst (Popup); Inhaltsskripte haben die URL der Webseite als Absender
    const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
    if (!fromExtensionPage || !ferry?.rpc) {
        sendResponse(null);
        return;
    }
    let work: Promise<any>;
    switch (request) {
        case "getTotp":
            work = ferry.rpc.getTotp(msg.uuid, msg.dbFileName);
            break;
        case "copyTotp":
            // Liste am Feld: Code holen und hier kopieren; die Liste schließt sich danach, das Kopieren darf nicht an
            // ihrem iframe hängen
            work = ferry.rpc.getTotp(msg.uuid, msg.dbFileName).then(async totp => {
                if (!totp?.code) return false;
                await copyStringToClipboard(totp.code);
                return true;
            });
            break;
        case "getOtpSetup":
            work = getOtpSetupForPopup(ferry.foregroundTabId);
            break;
        case "getOtpSetupSummary":
            work = getOtpSetupSummary(ferry.foregroundTabId);
            break;
        case "discardOtpSetup":
            forgetOtpSetup(ferry.foregroundTabId);
            work = Promise.resolve(true);
            break;
        case "applyOtpSetup":
            work = applyOtpSetup(ferry.foregroundTabId, msg.uuid, msg.dbFileName, !!msg.overwrite);
            break;
        case "getSelectionSave":
            work = getSelectionSaveForPopup(ferry.foregroundTabId);
            break;
        case "createSelectionEntry":
            work = createSelectionEntry(ferry.foregroundTabId, msg.title ?? "", msg.dbFileName ?? "", msg.groupUuid ?? "");
            break;
        case "findEntryForEdit":
            work = findEntryForEdit(msg.uuid, msg.dbFileName);
            break;
        case "takePendingEdit":
            work = Promise.resolve(takePendingEdit());
            break;
        case "discardSelectionSave":
            forgetSelectionSave(ferry.foregroundTabId);
            work = Promise.resolve(true);
            break;
        case "addImageAttachment":
            work = ferry.rpc.addImageAttachment(msg.uuid, msg.dbFileName, msg.fileName ?? "", msg.data ?? "");
            break;
        case "startPluginUpdate":
            work = startPluginUpdate();
            break;
        case "connectionStatus":
            work = ferry.rpc.pluginClient.nativeSessionManager.status().then(s => {
                const features = ferry.rpc.pluginClient.nativeSessionManager.features();
                // Plugin zu alt für das Protokoll: nur "Jetzt aktualisieren", keine Plugin-Einstellungen
                const usable = s.connected && !!ferry.rpc.pluginClient.getPrimarySessionManager();
                return {
                    ...s,
                    databases: ferry.store.state.KeePassDatabases.map(db => db.name || db.fileName),
                    pluginVersion: s.connected ? pluginVersionFrom(features) : null,
                    pluginOutdated: s.connected ? pluginUpdateAvailable(features) : false,
                    fieldProtection: usable && (features ?? []).includes(FIELD_PROTECTION_FEATURE),
                    entryRecycle: usable && (features ?? []).includes(ENTRY_RECYCLE_FEATURE),
                    hibpCheck: usable && (features ?? []).includes(HIBP_CHECK_FEATURE),
                    expiry: usable && (features ?? []).includes(EXPIRY_FEATURE),
                    optionsDialog: usable && (features ?? []).includes(OPTIONS_DIALOG_FEATURE)
                };
            });
            break;
        case "requestUnlock":
            work = chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
                const result = await ferry.requestBackgroundUnlock(tab?.id ?? -1, tab?.url ?? "", true);
                if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) ferry.openKeePass();
                return result;
            });
            break;
        case "getEntryExtras":
            work = ferry.rpc.getEntryExtras(msg.uuid, msg.dbFileName);
            break;
        case "getEntryAttachment":
            work = ferry.rpc.getEntryAttachment(msg.uuid, msg.dbFileName, msg.name);
            break;
        case "openEntryAttachmentExternally":
            work = ferry.rpc.openEntryAttachmentExternally(msg.uuid, msg.dbFileName, msg.name);
            break;
        case "openEntryNotesExternally":
            work = ferry.rpc.openEntryNotesExternally(msg.uuid, msg.dbFileName, msg.fileName ?? "");
            break;
        case "getEntryFieldValue":
            work = ferry.rpc.getEntryFieldValue(msg.uuid, msg.dbFileName, msg.name);
            break;
        case "removeEntryExtra":
            work = ferry.rpc.removeEntryExtra(msg.uuid, msg.dbFileName, msg.kind, msg.name);
            work.then(() => commandManager.entryExtrasChanged(msg.uuid, msg.dbFileName), () => undefined);
            break;
        case "addEntryText":
            work = ferry.rpc.addEntryText(msg.uuid, msg.dbFileName, msg.fieldName ?? "", msg.value ?? "", !!msg.protect, !!msg.toNotes);
            work.then(() => commandManager.entryExtrasChanged(msg.uuid, msg.dbFileName), () => undefined);
            break;
        case "updateEntryText":
            work = ferry.rpc.updateEntryText(msg.uuid, msg.dbFileName, msg.name ?? "", msg.value ?? "", !!msg.toNotes);
            break;
        case "moveEntryToRecycleBin":
            work = ferry.rpc.moveEntryToRecycleBin(msg.uuid, msg.dbFileName);
            break;
        case "setEntryFieldProtection":
            work = ferry.rpc.setEntryFieldProtection(msg.uuid, msg.dbFileName, msg.name ?? "", !!msg.protect);
            break;
        case "setTotp":
            // Aus dem Popup eingefügter Schlüssel/QR-Code; nur gültige otpauth-TOTP-URIs
            work = parseOtpauth(msg.uri ?? "")
                ? ferry.rpc.setTotp(msg.uuid, msg.dbFileName, msg.uri, !!msg.overwrite)
                : Promise.resolve({ status: "invalid" });
            break;
        case "pageFields":
            work = queryPageFields(ferry.foregroundTabId);
            break;
        case "fillField":
            work = fillPageField(ferry.foregroundTabId, msg.kind, msg.uuid, msg.dbFileName, msg.value);
            break;
        case "resetPairing":
            // Alte Kopplung zuerst in KeePass entfernen (Plugin ab 1.0.19), sonst sammeln sie sich in den Optionen an
            work = ferry.rpc
                .removeOwnPairing()
                .catch(() => false)
                .then(() => ferry.rpc.pluginClient.nativeSessionManager.resetPairing())
                .then(() => true);
            break;
        case "capturePageAnalysis": {
            // Alle Frames des Tabs schreiben ihren Aufbau ins Diagnoseprotokoll
            const ports = ferry.tabStates.get(ferry.foregroundTabId)?.framePorts;
            // Angefragte Frames mit Herkunft (wer nicht mit "seiten-analyse" antwortet, hat kein Inhaltsskript o. Ä.)
            const frames: string[] = [];
            ports?.forEach((port, id) => {
                let origin = "?";
                try {
                    origin = new URL(port.sender?.url ?? "").origin;
                } catch (e) {
                    // ohne Adresse
                }
                frames.push("f" + id + " " + origin);
            });
            diag("hintergrund", "seiten-analyse angefordert", {
                frames,
                erweiterung: chrome.runtime.getManifest().version,
                plugin: pluginVersionFrom(ferry.rpc.pluginClient.nativeSessionManager.features()),
                browser: navigator.userAgent.replace(/^.*\) /, "").slice(0, 80)
            });
            ports?.forEach(port => {
                try {
                    port.postMessage({ action: Action.CapturePageAnalysis } as AddonMessage);
                } catch (e) {
                    // Frame ist weg
                }
            });
            work = Promise.resolve(!!ports?.size);
            break;
        }
        case "openKeePassOptions":
            work = ferry.rpc.openOptions();
            break;
        case "getHideExpired":
            work = ferry.rpc.getHideExpired();
            break;
        case "getHibpLeaks":
            work = (ferry.rpc.pluginClient.nativeSessionManager.features() ?? []).includes(HIBP_LEAKS_FEATURE)
                ? ferry.rpc.getHibpLeaks(msg.since ?? "")
                : Promise.resolve([]);
            break;
        case "getFerryTips":
            work = ferry.rpc.getFerryTips();
            break;
        case "popupTiming":
            diag("popup", "angezeigt", msg.timing ?? {});
            work = Promise.resolve(true);
            break;
        case "changePasswordUrl":
            // quick: nur Apples Liste (ohne Netz), sonst auch /.well-known/change-password bei der Website prüfen
            work = msg.quick
                ? Promise.resolve(appleChangePasswordUrlFor(msg.url))
                : changePasswordUrl(msg.url ?? "");
            break;
        default:
            sendResponse(null);
            return;
    }
    // Änderungen an Einträgen aus dem Popup: Ansicht und Seitentreffer auffrischen
    if (["setTotp", "addEntryText", "updateEntryText", "removeEntryExtra", "addImageAttachment", "applyOtpSetup"].includes(request)) {
        work = work.then(async result => {
            await ferry.refreshAfterEntryChange();
            return result;
        });
    }
    work.then(result => sendResponse(result)).catch(() => sendResponse(null));
    return true;
});

// Klick aufs Icon ohne Popup (nur im Zustand "verbunden, aber gesperrt"): KeePass zum Entsperren nach vorne holen
chrome.action.onClicked.addListener(async () => {
    if (!ferry) return;
    diag("hintergrund", "symbol geklickt (gesperrt-modus)", { verbunden: ferry.store.state.connected });
    if (ferry.store.state.connected) {
        // Bewusster Klick: ohne Bremsen im Hintergrund entsperren (Windows Hello), sonst wie bisher KeePass holen
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const result = await ferry.requestBackgroundUnlock(tab?.id ?? -1, tab?.url ?? "", true);
        if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) ferry.openKeePass();
        return;
    }
    // Zustand hat sich inzwischen geändert: normales Popup zeigen
    await chrome.action.setPopup({ popup: "dist/popup/index.html" });
    try {
        await chrome.action.openPopup();
    } catch (e) {
        FerryLog.warn("Could not open popup: " + e);
    }
});

// Klick auf die Windows-Benachrichtigung zu einem Hinweis: Browserfenster nach vorne und Popup mit dem Hinweis öffnen
chrome.notifications.onClicked.addListener(async id => {
    if (!id.startsWith(OPEN_POPUP_NOTIFICATION_PREFIX)) return;
    chrome.notifications.clear(id);
    try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
        if (win?.id != null) await chrome.windows.update(win.id, { focused: true });
        await chrome.action.openPopup();
    } catch (e) {
        FerryLog.warn("Could not open popup from notification: " + e);
    }
});

// Geschlossener Tab: abgefangene Zugangsdaten und gemerkten Eintrag sofort verwerfen
chrome.tabs.onRemoved.addListener(tabId => {
    ferry?.persistentTabStates?.delete(tabId);
    forgetOtpSetup(tabId);
    forgetAutoFill(tabId);
    forgetExpiryNotice(tabId);
    ferry?.deleteTabState?.(tabId);
});

chrome.tabs.onActivated.addListener(event => {
    if (FerryLog && FerryLog.debug) FerryLog.debug("Tab activated with id: " + event.tabId);
    onTabActivated(event.tabId);
});

// Beim Start (auch nach Neustart des Service Workers) den aktiven Tab übernehmen, ohne auf einen Tabwechsel zu warten
self.setTimeout(async () => {
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs[0] && tabs[0].id != null) onTabActivated(tabs[0].id);
    } catch (e) {
        // ohne Fenster (z. B. beim Browserstart) kommt der Wert mit dem ersten Tabwechsel
    }
}, 1000);

chrome.runtime.onUpdateAvailable.addListener(async () => {
    await configManager.setASAP({ mustShowReleaseNotesAtStartup: true });
    if ((await chrome.idle.queryState(userBusySeconds)) === "idle") {
        chrome.runtime.reload();
    } else {
        // restart at least by maxUpdateDelayMinutes. Shorter durations are
        // likely, triggered by the idle state changing to not "active".
        await chrome.alarms.create("updateAvailableIdleMaximum", { delayInMinutes: maxUpdateDelayMinutes });
    }
});

chrome.alarms.onAlarm.addListener(alarm => {
    switch (alarm.name) {
        case "updateAvailableIdleMaximum":
            // Only reload if we have not already by inferring if release notes have been shown yet
            if (configManager.current.mustShowReleaseNotesAtStartup) {
                chrome.runtime.reload();
            }
            break;

        case "ensureActive":
            ensureStarted();
            break;
    }
});

chrome.idle.setDetectionInterval(userBusySeconds);
chrome.idle.onStateChanged.addListener(status => {
    if (status !== "active" && configManager.current.mustShowReleaseNotesAtStartup) {
        chrome.runtime.reload();
    }
});

// We need to regularly poll an external application to enable our primary functionality,
// as well as needing to consider every page load and some page requests from all websites,
// tabs and windows. Restarting the service worker thus comes at a much higher cost to the
// user than just keeping it running at all times. This timer thus allows us to keep
// things working at the lowest cost to users.
const keepAlive = () => setInterval(chrome.runtime.getPlatformInfo, 22500);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();

// This alarm lets us restart our regular polling (for plugin presence) and avoid
// unnecessary user delays during page loads, etc. by ensuring that we are reactivated
// shortly after any unexpected crashes, operating system standby/resume events, etc.
chrome.alarms.create("ensureActive", { periodInMinutes: 0.5 });

chrome.runtime.onConnect.addListener(async port => {
    console.debug("LIFECYCLE: await init port");
    // We can defer the initial response to the port until we have finished initialising.
    // It shouldn't take long but there is a theoretical risk of a rapidly (presumably
    // automatically) created and destroyed frame having gone away before we run the
    // connection startup process. Don't think that will cause any serious problems but
    // may lead to some noisy warnings so maybe one day we can add some extra defence here.
    await initialised;
    console.debug("LIFECYCLE: init port completed");
    ferry.onPortConnected(port);
});

// With MV3 we must always listen to httpauth requests and decide whether to handle them
// based on whether we have already initialised the pinia store, got connected to the plugin, have open DBs, etc.
if (isFirefox()) {
    chrome.webRequest.onAuthRequired.addListener(
        async (requestDetails): Promise<chrome.webRequest.BlockingResponse> => {
            if (FerryLog?.debug) FerryLog.debug("onAuthRequired request started");
            // We may crash at startup / session restore if we're not initialised yet
            await Promise.race([initialised, new Promise(resolve => self.setTimeout(resolve, 20000))]);
            if (FerryLog?.debug) FerryLog.debug("onAuthRequired request ongoing");
            const result = await networkAuth.provideCredentialsAsync(requestDetails);
            return result;
        },
        { urls: ["<all_urls>"] },
        ["blocking"]
    );
} else {
    chrome.webRequest.onAuthRequired.addListener(
        (requestDetails, callback) => {
            if (FerryLog?.debug) FerryLog.debug("onAuthRequired request started");
            Promise.race([
                initialised,
                new Promise(resolve => self.setTimeout(resolve, 20000))
            ])
            .then(() => {
                if (FerryLog?.debug) FerryLog.debug("onAuthRequired request ongoing");
                networkAuth.provideCredentialsAsyncBlockingCallback(requestDetails, callback);
            });
        },
        { urls: ["<all_urls>"] },
        ["asyncBlocking"]
    );
}

// Netzwerkanmeldung mit "In KeePass speichern": erst nach angenommener Anmeldung das Speichern-Popup
chrome.webRequest.onCompleted.addListener(details => onNetworkRequestCompleted(details), { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener(details => onNetworkRequestFailed(details), { urls: ["<all_urls>"] });

// This can be used instead once Chrome either supports Promises in "blocking" mode
// or, more likely, a new flag, which then Firefox would have to support too but we
// could still just use a conditional in the mean time to keep compatibility with a
// wider range of Firefox versions.
// https://github.com/w3c/webextensions/issues/490
// https://issues.chromium.org/issues/41483002
// chrome.webRequest.onAuthRequired.addListener(
//     async (requestDetails): Promise<chrome.webRequest.BlockingResponse> => {
//         if (FerryLog?.debug) FerryLog.debug("onAuthRequired request started");
//         // We may crash at startup / session restore if we're not initialised yet
//         await Promise.race([initialised, new Promise(resolve => self.setTimeout(resolve, 20000))]);
//         if (FerryLog?.debug) FerryLog.debug("onAuthRequired request ongoing");
//         const result = await networkAuth.provideCredentialsAsync(requestDetails);
//         return result;
//     },
//     { urls: ["<all_urls>"] },
//     [isFirefox() ? "blocking" : "asyncBlockingPromise"]
// );

(async () => {
    await ensureStarted();
})();

console.debug("LIFECYCLE: main end");
