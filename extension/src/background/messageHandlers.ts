import { preparePasskey, finishPasskey, cancelPasskey, signalPasskey, finishSignal } from "./passkeys";
import { diag } from "./ferryDiag";
import { handleOtpSetupCandidate, dismissOtpSetup, isOtpSetupPending } from "./otpSetup";
import { KeeURL } from "../common/KeeURL";
import type { AddonMessage } from "../common/AddonMessage";
import { KeeLog } from "../common/Logger";
import { KeeNotification } from "../common/KeeNotification";
import { Action } from "../common/Action";
import { configManager } from "../common/ConfigManager";
import type { VaultMessage } from "../common/VaultMessage";
import { VaultAction } from "../common/VaultAction";
import { Entry } from "../common/model/Entry";
import { copyStringToClipboard } from "../common/copyStringToClipboard";
import { kee } from "./KF";
import { accountManager } from "./AccountManager";


// callbacks for messaging / ports

export async function browserPopupMessageHandler(this: chrome.runtime.Port, msg: AddonMessage) {
    if (msg.mutation) {
        kee.store.onRemoteMessage(this, msg.mutation);
    }

    if (KeeLog && KeeLog.debug) {
        KeeLog.debug("In background script, received message from browser popup script.");
    }

    if (msg.removeNotification) {
        kee.removeUserNotifications((n: KeeNotification) => n.id != msg.removeNotification);
    }
    if (msg.loadUrlUpgradeKee) {
        chrome.tabs.create({
            url: "https://www.kee.pm/upgrade-kprpc"
        });
    }
    if (msg.action == Action.GetPasswordProfiles) {
        const passwordProfiles = await kee.getPasswordProfiles();
        kee.store.updatePasswordProfiles(passwordProfiles);
    }
    if (msg.action === Action.GeneratePassword) {
        const generatedPassword = await kee.generatePassword(
            msg.passwordProfile,
            msg.url ?? "unknown URL"
        );
        if (generatedPassword) {
            kee.store.updateGeneratedPassword(generatedPassword);
        } else {
            KeeLog.warn(
                "Kee received an empty/missing password. Check the configuration of your password manager."
            );
        }
    }
    if (msg.action === Action.CreateEntry || msg.action === Action.UpdateEntry) {
        if (kee.store.state.connected) {
            const sourceEntry = kee.store.state.saveState.newEntry;
            const existingOrTemporaryUuid = sourceEntry.uuid;
            const dbFileName = sourceEntry.database.fileName;
            const parentGroupUuid: string = sourceEntry.parentGroup.uuid;

            // shallow clone so we don't impact the values we have to wipe out below
            // KPRPC has particular expectations about some Entry properties.
            // parent group UUID, DB and UUID should all be undefined or null as set below.
            const entry = new Entry(
                Object.assign(Object.assign({} as Entry, sourceEntry) as Entry, {
                    parentGroup: undefined,
                    uuid: null,
                    database: undefined,

                    // We will rarely have access to the favicon data at the time the initial
                    // Entry is created for editing in the popup so set it at this much later
                    // point instead.
                    icon: configManager.current.saveFavicons
                        ? {
                              version: 1,
                              iconImageData: kee.store.state.saveState.favicon
                          }
                        : null
                })
            );

            // Might be changed by the user before KPRPC says all worked OK
            const tabId = kee.foregroundTabId;
            const clearSubmittedData = () => {
                if (kee.persistentTabStates.get(tabId)?.items?.length > 0) {
                    kee.persistentTabStates.get(
                        tabId
                    ).items = kee.persistentTabStates
                        .get(tabId)
                        .items.filter(item => item.itemType !== "submittedData");
                }
            };

            if (msg.action === Action.UpdateEntry) {
                kee.store.updateEntryUpdateStartedAtTimestamp(Date.now());
                kee.updateLogin(
                    entry,
                    existingOrTemporaryUuid,
                    dbFileName,
                    clearSubmittedData
                );
            } else {
                kee.addLogin(entry, parentGroupUuid, dbFileName, clearSubmittedData);
            }
            if (!configManager.current.mruGroup) configManager.current.mruGroup = {};
            configManager.current.mruGroup[dbFileName] = parentGroupUuid;
            configManager.current.mruGroup["{<{{<<kee-primary>>}}>}"] = parentGroupUuid;
            configManager.save();
        }
    }

    if (msg.action == Action.ManualFill && msg.selectedEntryIndex != null) {
        kee.tabStates
            .get(kee.foregroundTabId)
            .framePorts.get(msg.frameId || 0)
            .postMessage(msg);
        kee.tabStates
            .get(kee.foregroundTabId)
            .framePorts.get(0)
            .postMessage({ action: Action.CloseAllPanels });
    }

    if (msg.action === Action.OpenKeePass) {
        kee.openKeePass();
    }
    if (msg.findMatches) {
        const result = await kee.findLogins(
            null,
            null,
            msg.findMatches.uuid,
            msg.findMatches.DBfilename,
            null,
            null
        );
        kee.browserPopupPort.postMessage({
            findMatchesResult: result
        } as AddonMessage);
    }
    if (msg.loginEditor) {
        kee.launchLoginEditor(msg.loginEditor.uuid, msg.loginEditor.DBfilename);
    }
    if (msg.action === Action.DetectForms) {
        kee.tabStates.get(kee.foregroundTabId).framePorts.forEach(port => {
            port.postMessage({
                action: Action.DetectForms
            });
        }, this);
    }
}

export async function pageMessageHandler(this: chrome.runtime.Port, msg: AddonMessage) {
    if (KeeLog && KeeLog.debug) {
        KeeLog.debug("In background script, received message from page script.");
    }

    if (msg.mutation) {
        kee.store.onRemoteMessage(this, msg.mutation);
    }

    if (msg.findMatches) {
        // Login-Maske gefunden, KeePass aber gesperrt: Entsperren im Hintergrund anstoßen
        if (kee.store.state.connected && kee.store.state.KeePassDatabases.length === 0) {
            kee.requestBackgroundUnlock(this.sender.tab.id, this.sender.url ?? msg.findMatches.uri);
        }
        kee.tabStates.get(this.sender.tab.id).frames.get(this.sender.frameId).entries = [];
        const result = await kee.findLogins(
            msg.findMatches.uri,
            null,
            null,
            null,
            null,
            null
        );
        // Mehrseitige Anmeldung: den eben im Tab gewählten Eintrag auf Folgeseiten derselben Domain bevorzugen
        let preferredUuid: string = undefined;
        const last = kee.persistentTabStates.get(this.sender.tab.id)?.lastFilledEntry;
        const domain = KeeURL.fromString(this.sender.url ?? msg.findMatches.uri ?? "")?.domainOrIPAddress;
        if (last && domain && last.domain === domain && last.at > Date.now() - 10 * 60 * 1000 && result?.some(e => e.uuid === last.uuid)) {
            preferredUuid = last.uuid;
        }
        this.postMessage({
            isForegroundTab: this.sender.tab.id === kee.foregroundTabId,
            findMatchesResult: result,
            preferredUuid
        } as AddonMessage);

        //TODO:f: content scripts are responsible for recording the results from the searches they initiated into the shared data store (and updating the set of results when the active tab is changed).
        // Maybe in future we can find a way to handle that in the background worker so we can immediately ask the browser action icon to update using the results.
        // Potential workaround if required is to force a "number of matched results" parameter in the call to this update function but yuk.
        //configureBrowserActionIcon();
        //TODO:f: would be nice to show number of matching results on browser action icon but either need another async call from the page (yuk) or to store the matched logins in the main store rather than passing them on the message object.
        //TODO:f: putting in main store will probably help with other new features too.
    }
    if (msg.removeNotification) {
        kee.removeUserNotifications((n: KeeNotification) => n.id != msg.removeNotification);
        try {
            kee.browserPopupPort.postMessage({
                isForegroundTab: this.sender.tab.id === kee.foregroundTabId
            } as AddonMessage);
        } catch (e) {
            /* whatever */
        }
    }
    if (msg.entries) {
        //TODO:f: When/how is this msg sent? it might be somewhere we can trigger the browser action button update to display the number of matched items.
        kee.tabStates.get(this.sender.tab.id).frames.get(this.sender.frameId).entries =
            msg.entries;
    }
    if (msg.requestUnlock) {
        // Klick auf ein gesperrtes Feldsymbol: bewusste Aktion, ohne Bremsen entsperren
        const result = await kee.requestBackgroundUnlock(this.sender.tab.id, this.sender.url ?? "", true);
        diag("hintergrund", "feldsymbol geklickt (gesperrt)", { ergebnis: result });
    }
    if (msg.ferryDiag) {
        let host = "";
        try {
            host = new URL(this.sender.url).host;
        } catch (e) {
            // ohne URL
        }
        diag("seite " + host + " f" + this.sender.frameId, msg.ferryDiag.event, msg.ferryDiag.data);
    }
    // Schon in KeePass vorhandene Zugangsdaten (auch nur der Benutzername im ersten Schritt
    // mehrstufiger Anmeldungen) lösen keinen Speichern-Hinweis aus
    const submittedKnown = msg.submittedData ? await kee.submittedDataIsKnown(msg.submittedData) : false;
    if (msg.submittedData) {
        diag("hintergrund", "formular abgeschickt", {
            felder: (msg.submittedData.fields ?? []).map((f: any) => ({ typ: f.type, name: f.name, gefuellt: !!f.value })),
            bekannt: submittedKnown
        });
    }
    if (msg.submittedData && submittedKnown) {
        KeeLog.debug("Submitted data matches an existing entry; no save offer");
    } else if (msg.submittedData) {
        const persistentItem = {
            itemType: "submittedData" as const,
            submittedData: msg.submittedData,
            creationDate: new Date()
        };

        if (!kee.persistentTabStates.get(this.sender.tab.id)) {
            kee.persistentTabStates.set(this.sender.tab.id, {
                items: []
            });
        }

        // Don't allow more than one entry to be tracked for this tab
        if (kee.persistentTabStates.get(this.sender.tab.id)) {
            kee.persistentTabStates.get(
                this.sender.tab.id
            ).items = kee.persistentTabStates
                .get(this.sender.tab.id)
                .items.filter(item => item.itemType !== "submittedData");
        }

        kee.persistentTabStates.get(this.sender.tab.id).items.push(persistentItem);

        // Don't alert the user if it's less than 90 seconds since they initiated an
        // update request - highly likely that this is just the result of that
        // operation being submitted to the website.
        if (kee.store.state.entryUpdateStartedAtTimestamp >= Date.now() - 90000) return;

        if (configManager.current.notificationCountSavePassword < 10) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
                title: $STR("savePasswordText"),
                message:
                    $STR("notification_save_password_tip") +
                    "\n" +
                    $STR("notification_only_shown_some_times")
            });
            configManager.setASAP({
                notificationCountSavePassword:
                    configManager.current.notificationCountSavePassword + 1
            });
        }
        kee.configureBrowserActionIcon();
        kee.startSaveAttention();
        kee.offerSaveNotice(this.sender.tab.id);
    }
    if (msg.action === Action.WebAuthnRequest && msg.webauthn) {
        const w = msg.webauthn;
        let res: any = {};
        if (w.step === "prepare") res = await preparePasskey(this.sender, w.kind, w.payload);
        else if (w.step === "finish") res = await finishPasskey(this.sender, w.prepareId, w.choice);
        else if (w.step === "cancel") cancelPasskey(w.prepareId);
        else if (w.step === "signal") res = await signalPasskey(this.sender, w.kind, w.payload);
        else if (w.step === "signalFinish") res = await finishSignal(this.sender, w.signalId, w.key, !!w.remove);
        try {
            this.postMessage({ webauthn: { reqId: w.reqId, ...res } } as AddonMessage);
        } catch (e) {
            // Seite ist weg
        }
    }
    if (msg.action === Action.QueryUnlocked) {
        const unlocked = kee.store.state.connected && kee.store.state.KeePassDatabases.length > 0;
        this.postMessage({
            action: Action.UnlockState,
            unlocked,
            resetState: unlocked ? kee.store.state : undefined
        } as AddonMessage);
    }
    if (msg.action === Action.EntryFilled && msg.filledEntry?.uuid) {
        const tabId = this.sender.tab.id;
        const domain = KeeURL.fromString(this.sender.url ?? this.sender.tab.url)?.domainOrIPAddress;
        if (domain) {
            if (!kee.persistentTabStates.get(tabId)) kee.persistentTabStates.set(tabId, { items: [] });
            kee.persistentTabStates.get(tabId).lastFilledEntry = {
                uuid: msg.filledEntry.uuid,
                dbFileName: msg.filledEntry.dbFileName,
                domain,
                at: Date.now()
            };
        }
    }
    if (msg.action === Action.RequestOtp && msg.url) {
        // Nur für die eigene URL des Frames, nicht für eine von der Seite behauptete
        const frameUrl = this.sender.url ?? msg.url;
        try {
            if (kee.store.state.connected && kee.store.state.KeePassDatabases.length === 0) {
                diag("hintergrund", "otp angefragt, db gesperrt -> entsperren", { klick: !!msg.userInitiated });
                kee.requestBackgroundUnlock(this.sender.tab.id, frameUrl, !!msg.userInitiated);
                return;
            }
            if (await isOtpSetupPending(this.sender.tab.id, frameUrl)) {
                diag("hintergrund", "otp angefragt, aber einrichtung offen -> nicht ausfüllen");
                return;
            }
            const totp = await kee.findTotpCode(this.sender.tab.id, frameUrl);
            diag("hintergrund", "otp angefragt", { code: totp ? "gefunden" : "keiner", rest: totp?.remainingSeconds });
            if (totp) {
                this.postMessage({
                    action: Action.FillOtp,
                    otpCode: totp.code,
                    otpRemaining: totp.remainingSeconds,
                    otpPeriod: totp.period
                } as AddonMessage);
            }
        } catch (e) {
            KeeLog.warn("Could not get a one-time code: " + e);
        }
    }
    if (msg.action === Action.OtpSetupCandidate && msg.otpSetup) {
        // Nur die vom Browser gemeldete Frame-URL zählt, nicht eine von der Seite behauptete
        // Nicht abwarten: eine gleich folgende Code-Anfrage der Seite wartet selbst auf das Ergebnis
        handleOtpSetupCandidate(this.sender.tab.id, this.sender.url ?? this.sender.tab.url, msg.otpSetup);
    }
    if (msg.action === Action.DismissOtpSetup) {
        dismissOtpSetup(this.sender.tab.id);
    }
    if (msg.action === Action.OpenOtpSetupPopup) {
        kee.foregroundTabId = this.sender.tab.id;
        try {
            await chrome.action.setPopup({ popup: "dist/popup/index.html?otp=1" });
            await chrome.action.openPopup();
        } catch (e) {
            KeeLog.warn("Could not open the popup for the one-time code setup: " + e);
        } finally {
            await chrome.action.setPopup({ popup: "dist/popup/index.html" });
        }
    }
    if (msg.action === Action.OpenSavePopup) {
        // Popup einmalig mit ?save=1 öffnen, damit es direkt im Speichern-Dialog startet.
        // Der anfragende Tab ist der Vordergrund-Tab (nach einem Neustart ist der Wert sonst noch leer).
        kee.foregroundTabId = this.sender.tab.id;
        try {
            await chrome.action.setPopup({ popup: "dist/popup/index.html?save=1" });
            await chrome.action.openPopup();
        } catch (e) {
            KeeLog.warn("Could not open the popup for saving: " + e);
        } finally {
            await chrome.action.setPopup({ popup: "dist/popup/index.html" });
        }
    }
    if (msg.action === Action.DismissSaveNotice) {
        kee.persistentTabStates
            .get(this.sender.tab.id)
            ?.items?.filter(item => item.itemType === "submittedData")
            .forEach(item => (item.noticeDismissed = true));
    }
    if (msg.action === Action.ShowMatchedLoginsPanel) {
        kee.tabStates.get(this.sender.tab.id).framePorts.get(0).postMessage({
            action: Action.ShowMatchedLoginsPanel,
            frameId: this.sender.frameId
        });
    }
    if (msg.action === Action.PageHide) {
        try {
            kee.tabStates.get(this.sender.frameId).framePorts.forEach((port, key, map) => {
                try {
                    port.disconnect();
                } catch (e) {
                    if (KeeLog && KeeLog.debug) {
                        KeeLog.debug(
                            "failed to disconnect a frame port on tab " +
                                key +
                                ". This is probably not a problem but we may now be reliant on browser " +
                                "GC to clear down memory. The exception that caused this is: " +
                                e.message +
                                " : " +
                                e.stack
                        );
                    }
                } finally {
                    map.delete(key);
                }
            });
        } catch (e) {
            // Happens when an iframe is hidden after the top-level frame. The
            // only impact is some messaging ports remaining open for longer
            // than required. Pretty sure the browser has to deal with this
            // situation already - probably just through standard GC.
        }
        if (this.sender.frameId === 0) {
            kee.deleteTabState(this.sender.tab.id);
        }
    }
}

export function vaultMessageHandler(this: chrome.runtime.Port, msg: VaultMessage) {
    if (msg.mutation) {
        kee.store.onRemoteMessage(this, msg.mutation);
    }

    let result;
    if (KeeLog && KeeLog.debug) {
        KeeLog.debug("In background script, received message from vault script.");
    }
    switch (msg.action) {
        case VaultAction.Init:
            result = kee.KeePassRPC.startEventSession(
                msg.sessionId,
                msg.features,
                msgToPage => this.postMessage(msgToPage)
            );
            if (result) {
                this.postMessage(result);
            }
            return;
        case VaultAction.MessageToClient:
            result = kee.KeePassRPC.eventSessionMessageFromPage(msg);
            if (result) {
                this.postMessage(result);
            }
            return;
        case VaultAction.FocusRequired:
            chrome.tabs.update(this.sender.tab.id, { active: true });
            chrome.windows.update(this.sender.tab.windowId, { focused: true });
            return;
        case VaultAction.AccountChanged:
            accountManager.processNewTokens(msg.tokens);
            return;
    }
}

export async function iframeMessageHandler(this: chrome.runtime.Port, msg: AddonMessage) {
    if (msg.mutation) {
        kee.store.onRemoteMessage(this, msg.mutation);
    }

    if (KeeLog && KeeLog.debug) {
        KeeLog.debug("In background script, received message from iframe script.");
    }

    const tabId = this.sender.tab.id;

    if (msg.action == Action.ManualFill && msg.selectedEntryIndex != null) {
        kee.tabStates
            .get(tabId)
            .framePorts.get(msg.frameId || 0)
            .postMessage(msg);
        kee.tabStates
            .get(tabId)
            .framePorts.get(0)
            .postMessage({ action: Action.CloseAllPanels });
    }

    if (msg.action == Action.CloseAllPanels) {
        kee.tabStates.get(tabId).framePorts.get(0).postMessage(msg);
    }

    if (msg.action == Action.GetPasswordProfiles) {
        const passwordProfiles = await kee.getPasswordProfiles();
        kee.store.updatePasswordProfiles(passwordProfiles);
    }

    if (msg.action == Action.GeneratePassword) {
        const generatedPassword = await kee.generatePassword(
            msg.passwordProfile,
            kee.tabStates.get(tabId).url
        );
        if (generatedPassword) {
            kee.store.updateGeneratedPassword(generatedPassword);
            this.postMessage({
                generatedPassword: generatedPassword
            } as AddonMessage);
        } else {
            KeeLog.warn(
                "Kee received an empty/missing password. Check the configuration of your password manager."
            );
        }
    }

    if (msg.loginEditor) {
        kee.launchLoginEditor(msg.loginEditor.uuid, msg.loginEditor.DBfilename);
    }

    if (msg.copyToClipboard) {
        await copyStringToClipboard(msg.copyToClipboard);
    }
}
