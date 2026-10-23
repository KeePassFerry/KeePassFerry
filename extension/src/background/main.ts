import { diag } from "./ferryDiag";
import { getOtpSetupForPopup, getOtpSetupSummary, applyOtpSetup, forgetOtpSetup, parseOtpauth } from "./otpSetup";
import { queryPageFields, fillPageField } from "./pageFields";
import { pluginIsOutdated, pluginVersionFrom } from "../common/FeatureFlags";
import { isFirefox } from "webext-detect-page";
import { kee } from "./KF";
import { commandManager } from "./commands";
import { KeeLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";
import { NetworkAuth } from "./NetworkAuth";

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

// window.KeePersistentLogger = new PersistentLogger();

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
        // window.KeePersistentLogger.init(configManager.current.logLevel >= 4);
        KeeLog.attachConfig(configManager.current);
        await showReleaseNotesAfterUpdate();
        resolveInitialised(await kee.init());
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
    // KeePassFerry öffnet nach einem Update keine Seite (die alte Kee-Seite warb für Kee Vault); die Änderungen
    // stehen im CHANGELOG bzw. im GitHub-Release. Das Merkmal bleibt für den verzögerten Neustart (Alarm unten).
    if (configManager.current.mustShowReleaseNotesAtStartup) {
        configManager.setASAP({ mustShowReleaseNotesAtStartup: false });
    }
}

function onTabActivated(tabId) {
    updateForegroundTab(tabId);

    if (kee) {
        // May not have set up kee yet
        commandManager.setupContextMenuItems();
    }
}

function updateForegroundTab(tabId: number) {
    if (kee && kee.foregroundTabId !== tabId) {
        // May not have set up kee yet
        kee.foregroundTabId = tabId;
        const ports = kee.tabStates.get(tabId)?.framePorts;
        if (ports) {
            // May not have set up port yet
            if (KeeLog && KeeLog.debug) KeeLog.debug("kee activated on tab: " + tabId);

            ports.forEach((port, frameIndex) => {
                try {
                    port.postMessage({
                        isForegroundTab: true,
                        action: Action.DetectForms,
                        resetState: kee.store.state
                    } as AddonMessage);
                } catch (e) {
                    if (KeeLog && KeeLog.warn) KeeLog.warn("Failed to post a message to a foreground tab port. Will remove the port now.");
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
                if (tab.url && tab.url.startsWith("about:")) return;
                if (tab.url && tab.url.startsWith("chrome://")) return;
                if (script?.js?.length > 0) {
                    loadOperations.push(chrome.scripting.executeScript({
                        target: { tabId: tab.id, allFrames },
                        files: script.js,
                        // Passkey-Skript gehört in die Seitenwelt (MAIN), alle anderen in die Erweiterungswelt
                        world: (script as any).world === "MAIN" ? "MAIN" : "ISOLATED"
                    } as any));
                }
                if (script?.css?.length > 0) {
                    loadOperations.push(chrome.scripting.insertCSS({
                        target: { tabId: tab.id, allFrames },
                        files: script.css
                    }));
                }
            };
            try {
                const tabs = await chrome.tabs.query({ url });
                tabs.forEach(loadContentScripts);
                await Promise.all(loadOperations);
            } catch (e) {
                if (!(e.message as string).endsWith(" is showing error page")) {
                    if (KeeLog && KeeLog.error) KeeLog.error(e.message);
                    else console.error(e);
                }
            }
        });
    });
}

chrome.runtime.onInstalled.addListener(async function (details) {
    if (details.reason === "install") {
        chrome.tabs.create({
            url: "/dist/install-notes/index.html"
        });
    }
});

chrome.windows.onFocusChanged.addListener(async function (windowId) {
    if (KeeLog && KeeLog.debug) KeeLog.debug("Focus changed for id: " + windowId);
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
    if (!fromExtensionPage || !kee?.KeePassRPC) {
        sendResponse(null);
        return;
    }
    let work: Promise<any>;
    switch (request) {
        case "getTotp":
            work = kee.KeePassRPC.getTotp(msg.uuid, msg.dbFileName);
            break;
        case "getOtpSetup":
            work = getOtpSetupForPopup(kee.foregroundTabId);
            break;
        case "getOtpSetupSummary":
            work = getOtpSetupSummary(kee.foregroundTabId);
            break;
        case "discardOtpSetup":
            forgetOtpSetup(kee.foregroundTabId);
            work = Promise.resolve(true);
            break;
        case "applyOtpSetup":
            work = applyOtpSetup(kee.foregroundTabId, msg.uuid, msg.dbFileName, !!msg.overwrite);
            break;
        case "addImageAttachment":
            work = kee.KeePassRPC.addImageAttachment(msg.uuid, msg.dbFileName, msg.fileName ?? "", msg.data ?? "");
            break;
        case "connectionStatus":
            work = kee.KeePassRPC.kprpcClient.nativeSessionManager.status().then(s => {
                const features = kee.KeePassRPC.kprpcClient.nativeSessionManager.features();
                return {
                    ...s,
                    databases: kee.store.state.KeePassDatabases.map(db => db.name || db.fileName),
                    pluginVersion: s.connected ? pluginVersionFrom(features) : null,
                    pluginOutdated: s.connected ? pluginIsOutdated(features) : false
                };
            });
            break;
        case "requestUnlock":
            work = chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
                const result = await kee.requestBackgroundUnlock(tab?.id ?? -1, tab?.url ?? "", true);
                if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) kee.openKeePass();
                return result;
            });
            break;
        case "getEntryExtras":
            work = kee.KeePassRPC.getEntryExtras(msg.uuid, msg.dbFileName);
            break;
        case "getEntryAttachment":
            work = kee.KeePassRPC.getEntryAttachment(msg.uuid, msg.dbFileName, msg.name);
            break;
        case "getEntryFieldValue":
            work = kee.KeePassRPC.getEntryFieldValue(msg.uuid, msg.dbFileName, msg.name);
            break;
        case "removeEntryExtra":
            work = kee.KeePassRPC.removeEntryExtra(msg.uuid, msg.dbFileName, msg.kind, msg.name);
            break;
        case "addEntryText":
            work = kee.KeePassRPC.addEntryText(msg.uuid, msg.dbFileName, msg.fieldName ?? "", msg.value ?? "", !!msg.protect, !!msg.toNotes);
            break;
        case "setTotp":
            // Aus dem Popup eingefügter Schlüssel/QR-Code; nur gültige otpauth-TOTP-URIs
            work = parseOtpauth(msg.uri ?? "")
                ? kee.KeePassRPC.setTotp(msg.uuid, msg.dbFileName, msg.uri, !!msg.overwrite)
                : Promise.resolve({ status: "invalid" });
            break;
        case "pageFields":
            work = queryPageFields(kee.foregroundTabId);
            break;
        case "fillField":
            work = fillPageField(kee.foregroundTabId, msg.kind, msg.uuid, msg.dbFileName, msg.value);
            break;
        case "resetPairing":
            work = kee.KeePassRPC.kprpcClient.nativeSessionManager.resetPairing().then(() => true);
            break;
        default:
            sendResponse(null);
            return;
    }
    // Änderungen an Einträgen aus dem Popup: Ansicht und Seitentreffer auffrischen
    if (["setTotp", "addEntryText", "removeEntryExtra", "addImageAttachment", "applyOtpSetup"].includes(request)) {
        work = work.then(async result => {
            await kee.refreshAfterEntryChange();
            return result;
        });
    }
    work.then(result => sendResponse(result)).catch(() => sendResponse(null));
    return true;
});

// Klick aufs Icon ohne Popup (nur im Zustand "verbunden, aber gesperrt"): KeePass zum Entsperren nach vorne holen
chrome.action.onClicked.addListener(async () => {
    if (!kee) return;
    diag("hintergrund", "symbol geklickt (gesperrt-modus)", { verbunden: kee.store.state.connected });
    if (kee.store.state.connected) {
        // Bewusster Klick: ohne Bremsen im Hintergrund entsperren (Windows Hello), sonst wie bisher KeePass holen
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const result = await kee.requestBackgroundUnlock(tab?.id ?? -1, tab?.url ?? "", true);
        if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) kee.openKeePass();
        return;
    }
    // Zustand hat sich inzwischen geändert: normales Popup zeigen
    await chrome.action.setPopup({ popup: "dist/popup/index.html" });
    try {
        await chrome.action.openPopup();
    } catch (e) {
        KeeLog.warn("Could not open popup: " + e);
    }
});

// Geschlossener Tab: abgefangene Zugangsdaten und gemerkten Eintrag sofort verwerfen
chrome.tabs.onRemoved.addListener(tabId => {
    kee?.persistentTabStates?.delete(tabId);
    forgetOtpSetup(tabId);
    kee?.deleteTabState?.(tabId);
});

chrome.tabs.onActivated.addListener(event => {
    if (KeeLog && KeeLog.debug) KeeLog.debug("Tab activated with id: " + event.tabId);
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

// This alarm lets us restart our regular polling (for KeePassRPC presence) and avoid
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
    kee.onPortConnected(port);
});

// With MV3 we must always listen to httpauth requests and decide whether to handle them
// based on whether we have already initialised the pinia store, got connected to KPRPC, have open DBs, etc.
if (isFirefox()) {
    chrome.webRequest.onAuthRequired.addListener(
        async (requestDetails): Promise<chrome.webRequest.BlockingResponse> => {
            if (KeeLog?.debug) KeeLog.debug("onAuthRequired request started");
            // We may crash at startup / session restore if we're not initialised yet
            await Promise.race([initialised, new Promise(resolve => self.setTimeout(resolve, 20000))]);
            if (KeeLog?.debug) KeeLog.debug("onAuthRequired request ongoing");
            const result = await networkAuth.provideCredentialsAsync(requestDetails);
            return result;
        },
        { urls: ["<all_urls>"] },
        ["blocking"]
    );
} else {
    chrome.webRequest.onAuthRequired.addListener(
        (requestDetails, callback) => {
            if (KeeLog?.debug) KeeLog.debug("onAuthRequired request started");
            Promise.race([
                initialised,
                new Promise(resolve => self.setTimeout(resolve, 20000))
            ])
            .then(() => {
                if (KeeLog?.debug) KeeLog.debug("onAuthRequired request ongoing");
                networkAuth.provideCredentialsAsyncBlockingCallback(requestDetails, callback);
            });
        },
        { urls: ["<all_urls>"] },
        ["asyncBlocking"]
    );
}

// This can be used instead once Chrome either supports Promises in "blocking" mode
// or, more likely, a new flag, which then Firefox would have to support too but we
// could still just use a conditional in the mean time to keep compatibility with a
// wider range of Firefox versions.
// https://github.com/w3c/webextensions/issues/490
// https://issues.chromium.org/issues/41483002
// chrome.webRequest.onAuthRequired.addListener(
//     async (requestDetails): Promise<chrome.webRequest.BlockingResponse> => {
//         if (KeeLog?.debug) KeeLog.debug("onAuthRequired request started");
//         // We may crash at startup / session restore if we're not initialised yet
//         await Promise.race([initialised, new Promise(resolve => self.setTimeout(resolve, 20000))]);
//         if (KeeLog?.debug) KeeLog.debug("onAuthRequired request ongoing");
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
