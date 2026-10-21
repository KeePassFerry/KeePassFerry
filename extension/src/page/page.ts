/* eslint-disable no-inner-declarations */
import { PasskeyBridge } from "./PasskeyBridge";
import { FormFilling } from "./formFilling";
import { FormUtils } from "./formsUtils";
import { FormSaving } from "./formSaving";
import { PasswordGenerator } from "./PasswordGenerator";
import { KeeLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import type { AddonMessage } from "../common/AddonMessage";
import { Action } from "../common/Action";
import { Port } from "../common/port";
import { showSaveNotice, hideSaveNotice } from "./SaveNotice";
import { OtpFields } from "./OtpFields";
import NonReactiveStore from "../store/NonReactiveStore";
import { Mutation } from "../store/Mutation";
import { findOpenShadowRoots } from "./shadowDom";

/* This orchestrates the main functions of the add-on
on all website pages except those containing a KPRPC server */

// eslint-disable-next-line no-var
var keeDuplicationCount;

if (keeDuplicationCount) {
    if (KeeLog && KeeLog.error) {
        KeeLog.error(
            "Duplicate Kee content script instance detected! Found this many other instances: " +
            keeDuplicationCount
        );
    } else {
        console.error(
            "Duplicate Kee content script instance detected! Found this many other instances: " +
            keeDuplicationCount
        );
    }
} else {
    keeDuplicationCount = 0;
}
keeDuplicationCount += 1;

let formUtils: FormUtils;
let formFilling: FormFilling;
let formSaving: FormSaving;
let passwordGenerator: PasswordGenerator;
let frameId: number;
let connected = false;
let messagingPortConnectionRetryTimer: number;
let pageShowFired = false;
let configReady = false;
let missingPageShowTimer: number;
let store: NonReactiveStore;
let inputsObserver: MutationObserver;
// Wird unten gesetzt, sobald die Seite verbunden ist (Warten auf Entsperren bei gesperrter DB)
let onOtpCodeRequested: () => void = null;
const otpFields = new OtpFields(() => onOtpCodeRequested?.());
// Passkeys: Brücke zur Seitenwelt sofort starten, damit WebAuthn-Aufrufe der Seite früh bedient werden
const passkeyBridge = new PasskeyBridge();
passkeyBridge.start();

// Content scripts are injected into non-HTML documents such as SVGs.
// We have no interest in this document if it has no body Node
if (document.body) {

    inputsObserver = new MutationObserver((mutations, observer) => {
        // Mutations inside a shadow root are not reported to observers of the
        // main document so we start observing any newly added open shadow roots.
        // This must happen even if we decide not to rescan the page right now.
        let shadowFieldsAdded = false;
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                const shadowRoots = findOpenShadowRoots(node);
                observeShadowRoots(shadowRoots);
                if (shadowRoots.some(shadowRoot => shadowRoot.querySelector("form, input, select"))) {
                    shadowFieldsAdded = true;
                }
            });
        });

        // If we have already scheduled a rescan recently, no further action required
        if (formFilling.formFinderTimer !== null) return;

        // If we have become disconnected from the main extension (e.g. after an
        // upgrade to a new version) we can force a disconnect to reduce error
        // log noise and potentially mitigate performance impacts of the ongoing
        // observation.
        if (!chrome.runtime?.id) {
            KeeLog.debug("we are dead so disconnecting the observer");
            observer.disconnect();
            return;
        }

        // Only proceed if we have a DB to search
        if (!store?.state.connected || store?.state.ActiveKeePassDatabaseIndex < 0) return;

        let rescan = shadowFieldsAdded;
        const interestingNodes = ["form", "input", "select"];
        mutations.forEach(mutation => {
            if (rescan) return;
            if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (rescan) break;
                    for (let i = 0; i < interestingNodes.length; i++) {
                        const element = node as Element;
                        if (element.querySelector && element.querySelector(interestingNodes[i])) {
                            rescan = true;
                            break;
                        }
                    }
                }
            }
        });

        // Schedule a rescan soon. Not immediately, in case a batch of mutations are about to be triggered.
        if (rescan) {
            otpFields.scanSoon();
            formFilling.formFinderTimer = window.setTimeout(
                formFilling.findMatchesInThisFrame.bind(formFilling),
                500
            );
        }
    });

    function observeShadowRoots(shadowRoots: ShadowRoot[]) {
        shadowRoots.forEach(shadowRoot =>
            inputsObserver.observe(shadowRoot, { childList: true, subtree: true })
        );
    }

    function matchFinder(uri: string) {
        Port.postMessage({ findMatches: { uri } });
        startUnlockWaitIfLocked();
    }

    // KeePass gesperrt, Seite braucht Zugangsdaten: regelmäßig fragen, ob inzwischen entsperrt wurde
    // (z. B. per Windows Hello), und dann selbst neu suchen. Höchstens 2 Minuten, nur auf Seiten mit Feldern.
    let unlockWaitTimer: number = null;
    let unlockWaitRounds = 0;
    function startUnlockWaitIfLocked() {
        if (!store?.state.connected || store.state.KeePassDatabases.length > 0) return;
        if (unlockWaitTimer !== null) return;
        unlockWaitRounds = 0;
        unlockWaitTimer = window.setInterval(() => {
            if (++unlockWaitRounds > 60 || !Port.raw) {
                stopUnlockWait();
                return;
            }
            Port.postMessage({ action: Action.QueryUnlocked } as AddonMessage);
        }, 2000);
    }
    function stopUnlockWait() {
        if (unlockWaitTimer !== null) clearInterval(unlockWaitTimer);
        unlockWaitTimer = null;
    }
    onOtpCodeRequested = startUnlockWaitIfLocked;

    function tutorialIntegration() {
        if (window.location.hostname.endsWith("tutorial-addon.kee.pm")) {
            const transferElement = document.createElement("KeeFoxAddonStateTransferElement");
            transferElement.setAttribute(
                "state",
                JSON.stringify({
                    connected: store?.state?.connected || false,
                    version: chrome.runtime.getManifest().version,
                    dbLoaded: store?.state?.KeePassDatabases?.length > 0,
                    sessionNames: store?.state?.KeePassDatabases?.map?.(db =>
                        db.sessionType.toString()
                    ).filter((v, i, a) => a.indexOf(v) === i)
                })
            );
            document.documentElement.appendChild(transferElement);

            const event = new Event("KeeFoxAddonStateTransferEvent", {
                bubbles: true,
                cancelable: false
            });
            transferElement.dispatchEvent(event);
        }
    }

    function onFirstConnect(myFrameId: number) {
        frameId = myFrameId;

        KeeLog.attachConfig(configManager.current);
        formUtils = new FormUtils(KeeLog);
        formSaving = new FormSaving(Port.raw, KeeLog, formUtils);
        formFilling = new FormFilling(
            store,
            Port.raw,
            frameId,
            formUtils,
            formSaving,
            KeeLog,
            configManager.current,
            matchFinder
        );
        passwordGenerator = new PasswordGenerator(frameId);

        inputsObserver.observe(document.body, { childList: true, subtree: true });
        observeShadowRoots(findOpenShadowRoots(document.body));

        tutorialIntegration();
    }

    function startup() {
        KeeLog.debug("content page starting");

        try {
            connectToMessagingPort();
            if (Port.raw == null) {
                KeeLog.warn("Failed to connect to messaging port. We'll try again later.");
            }
        } catch (ex) {
            KeeLog.warn(
                "Failed to connect to messaging port. We'll try again later. Exception message: " +
                ex.message
            );
        }

        messagingPortConnectionRetryTimer = window.setInterval(() => {
            if (Port.raw == null) {
                KeeLog.info("Messaging port was not established at page startup. Retrying now...");
                try {
                    connectToMessagingPort();
                    if (Port.raw == null) {
                        KeeLog.warn("Failed to connect to messaging port. We'll try again later.");
                    }
                } catch (ex) {
                    KeeLog.warn(
                        "Failed to connect to messaging port. We'll try again later. Exception message: " +
                        ex.message
                    );
                }
            } else {
                clearInterval(messagingPortConnectionRetryTimer);
            }
        }, 5000);

        KeeLog.debug("content page ready");
    }

    function connectToMessagingPort() {
        if (Port.raw) {
            KeeLog.warn(
                "port already set to '" +
                Port.raw.name +
                "'. Skipping startup because it should already be underway but is taking a long time."
            );
            return;
        }
        Port.startup("page");

        store = new NonReactiveStore((mutationPayload: Mutation, _excludedPort) => {
            KeeLog.debug("New page mutation/action being distributed.");
            Port.postMessage({ mutation: mutationPayload } as AddonMessage);
        });
        Port.raw.onMessage.addListener(function (m: AddonMessage) {
            KeeLog.debug("In browser content page script, received message from background script");

            if (m.initialState) {
                store.resetTo(m.initialState);
            }
            if (m.mutation) {
                store.onRemoteMessage(Port.raw, m.mutation);
                return;
            }
            if (m.webauthn) {
                passkeyBridge.onBackgroundMessage(m);
                return;
            }

            if (!connected) {
                onFirstConnect(m.frameId);
                formFilling.findMatchesInThisFrame();
                connected = true;
                // Auch bei gesperrter DB: eine Code-Anfrage stößt dann das Entsperren an
                if (store.state.connected) {
                    otpFields.observe();
                    otpFields.scanSoon();
                }
            } else if (m.action == Action.DetectForms) {
                if (m.resetState) {
                    // Sometimes the page's store state can be out of sync with the
                    // background - e.g. when the tab has been inactive for some
                    // time. In these cases, we must supply the full state again
                    // before looking for matching entries.
                    store.resetTo(m.resetState);
                }
                formSaving.removeAllSubmitHandlers();
                if (store.state.connected && store.state.KeePassDatabases.length > 0) {
                    formFilling.removeKeeIconFromAllFields();
                    otpFields.observe();
                    otpFields.rescan();
                } else {
                    // Gesperrt: Symbole bleiben (Zustand "gesperrt"), Klick entsperrt per Windows Hello
                    formFilling.lockKeeIcons(startUnlockWaitIfLocked);
                    otpFields.onLocked();
                }

                if (store.state.entryUpdateStartedAtTimestamp >= Date.now() - 20000) {
                    formFilling.findMatchesInThisFrame({
                        autofillOnSuccess: false,
                        autosubmitOnSuccess: false
                    });
                } else {
                    formFilling.findMatchesInThisFrame();
                }
            }

            if (m.findMatchesResult) {
                formFilling.findLoginsResultHandler(m.findMatchesResult, m.preferredUuid);
            }

            if (m.action == Action.ManualFill && m.selectedEntryIndex != null) {
                formFilling.closeMatchedLoginsPanel();
                formFilling.fillAndSubmit(false, null, m.selectedEntryIndex);
            }

            if (m.action == Action.ResetForms) {
                formFilling.removeKeeIconFromAllFields();
                formSaving.removeAllSubmitHandlers();
            }

            if (m.action == Action.Primary) {
                formFilling.executePrimaryAction();
            }

            if (m.action == Action.GeneratePassword) {
                passwordGenerator.createGeneratePasswordPanel();
            }

            if (m.action == Action.CloseAllPanels) {
                passwordGenerator.closeGeneratePasswordPanel();
                formFilling.closeMatchedLoginsPanel();
            }

            if (m.action == Action.ShowMatchedLoginsPanel) {
                formFilling.createMatchedLoginsPanelInCenter(m.frameId);
            }

            if (m.action == Action.ShowSaveNotice) {
                showSaveNotice();
            }

            if (m.action == Action.UnlockState && m.unlocked && unlockWaitTimer !== null) {
                stopUnlockWait();
                if (m.resetState) store.resetTo(m.resetState);
                formFilling.removeKeeIconFromAllFields();
                formFilling.findMatchesInThisFrame();
                otpFields.rescan();
            }

            if (m.action == Action.ShowOtpSetupNotice) {
                showSaveNotice("otp", m.otpIssuer);
            }

            if (m.action == Action.FillOtp && m.otpCode) {
                otpFields.fill(m.otpCode, m.otpRemaining, m.otpPeriod);
            }
        });
    }

    window.addEventListener("pageshow", () => {
        pageShowFired = true;
        clearTimeout(missingPageShowTimer);
        if (configReady) {
            startup();
        }
    });
    window.addEventListener("pagehide", () => {
        hideSaveNotice();
        otpFields.reset();
        stopUnlockWait();
        inputsObserver.disconnect();
        if (Port.raw) Port.postMessage({ action: Action.PageHide });
        //TODO:f: work out why this can be null. Was never connected for some reason? E.g. background script bug or injected into a page type we can't support?
        formFilling?.removeKeeIconFromAllFields();
        Port.shutdown();
        connected = false;
        frameId = undefined;
        formUtils = undefined;
        formSaving = undefined;
        formFilling = undefined;
        passwordGenerator = undefined;
    });


    (async () => {
        await configManager.load();
        configReady = true;
        if (pageShowFired) {
            startup();
        } else {
            // Page show does not always fire (e.g. on first install of the extension)
            // so we won't wait around forever, at the cost of occasional duplicate
            // startup code - broadly limited to discovering that the message port
            // is already established.
            missingPageShowTimer = window.setTimeout(startup, 1500);
        }
    })();

}
