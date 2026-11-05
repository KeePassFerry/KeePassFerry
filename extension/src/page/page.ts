/* eslint-disable no-inner-declarations */
import { PasskeyBridge } from "./PasskeyBridge";
import { FormFilling } from "./formFilling";
import { FormUtils } from "./formsUtils";
import { FormSaving } from "./formSaving";
import { PasswordGenerator } from "./PasswordGenerator";
import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import type { AddonMessage } from "../common/AddonMessage";
import { Action } from "../common/Action";
import { Port } from "../common/port";
import { showSaveNotice, hideSaveNotice } from "./SaveNotice";
import { offerPasswordUpdateNotice, cancelPasswordUpdateNotice, withdrawSaveNotice } from "./passwordUpdateNotice";
import { OtpFields } from "./OtpFields";
import { availableFieldKinds, fillContextTarget, fillFieldKind, trackContextTarget } from "./fieldFill";
import { pageDiag } from "./ferryDiagPage";
import { capturePageAnalysis } from "./pageAnalysis";
import NonReactiveStore from "../store/NonReactiveStore";
import { Mutation } from "../store/Mutation";
import { findOpenShadowRoots } from "./shadowDom";

/* This orchestrates the main functions of the add-on
on all website pages except those of the plugin */

// eslint-disable-next-line no-var
var ferryDuplicationCount;

if (ferryDuplicationCount) {
    if (FerryLog && FerryLog.error) {
        FerryLog.error(
            "Duplicate KeePassFerry content script instance detected! Found this many other instances: " +
            ferryDuplicationCount
        );
    } else {
        console.error(
            "Duplicate KeePassFerry content script instance detected! Found this many other instances: " +
            ferryDuplicationCount
        );
    }
} else {
    ferryDuplicationCount = 0;
}
ferryDuplicationCount += 1;

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
trackContextTarget();

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
            FerryLog.debug("we are dead so disconnecting the observer");
            observer.disconnect();
            return;
        }

        // Nur mit Verbindung zu KeePass; auch bei gesperrter DB, damit nachgeladene Formulare das Gesperrt-Symbol bekommen
        if (!store?.state.connected) return;

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

    // Ein noch unsichtbares Anmeldeformular wird oft erst nach einem Klick eingeblendet (z. B. "Anmelden"-Menü):
    // dann erneut suchen und, sobald es sichtbar ist, ausfüllen
    const onInteraction = () => {
        if (!formFilling?.hiddenLoginPending || formFilling.formFinderTimer !== null) return;
        formFilling.formFinderTimer = window.setTimeout(() => formFilling.findMatchesInThisFrame(), 800);
    };
    document.addEventListener("click", onInteraction, true);
    document.addEventListener("focusin", onInteraction, true);

    function matchFinder(uri: string, visible: boolean) {
        Port.postMessage({ findMatches: { uri, visible } });
        // Gesperrt: nicht von selbst entsperren, sondern Gesperrt-Symbol an den Anmeldefeldern zeigen
        // (Klick darauf oder aufs Erweiterungssymbol entsperrt); danach selbst neu suchen und ausfüllen
        pageDiag("anmeldeformular gefunden", {
            verbunden: !!store?.state.connected,
            offeneDbs: store?.state.KeePassDatabases?.length ?? null,
            sichtbar: visible
        });
        if (store?.state.connected && store.state.KeePassDatabases.length === 0) {
            formFilling.lockFieldIcons(startUnlockWaitIfLocked);
            otpFields.onLocked();
        }
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

    function onFirstConnect(myFrameId: number) {
        frameId = myFrameId;

        FerryLog.attachConfig(configManager.current);
        formUtils = new FormUtils(FerryLog);
        formSaving = new FormSaving(Port.raw, FerryLog, formUtils);
        formFilling = new FormFilling(
            store,
            Port.raw,
            frameId,
            formUtils,
            formSaving,
            FerryLog,
            configManager.current,
            matchFinder
        );
        passwordGenerator = new PasswordGenerator(frameId);

        inputsObserver.observe(document.body, { childList: true, subtree: true });
        observeShadowRoots(findOpenShadowRoots(document.body));

    }

    function startup() {
        FerryLog.debug("content page starting");

        try {
            connectToMessagingPort();
            if (Port.raw == null) {
                FerryLog.warn("Failed to connect to messaging port. We'll try again later.");
            }
        } catch (ex) {
            FerryLog.warn(
                "Failed to connect to messaging port. We'll try again later. Exception message: " +
                ex.message
            );
        }

        messagingPortConnectionRetryTimer = window.setInterval(() => {
            if (Port.raw == null) {
                FerryLog.info("Messaging port was not established at page startup. Retrying now...");
                try {
                    connectToMessagingPort();
                    if (Port.raw == null) {
                        FerryLog.warn("Failed to connect to messaging port. We'll try again later.");
                    }
                } catch (ex) {
                    FerryLog.warn(
                        "Failed to connect to messaging port. We'll try again later. Exception message: " +
                        ex.message
                    );
                }
            } else {
                clearInterval(messagingPortConnectionRetryTimer);
            }
        }, 5000);

        FerryLog.debug("content page ready");
    }

    function connectToMessagingPort() {
        if (Port.raw) {
            FerryLog.warn(
                "port already set to '" +
                Port.raw.name +
                "'. Skipping startup because it should already be underway but is taking a long time."
            );
            return;
        }
        Port.startup("page");

        store = new NonReactiveStore((mutationPayload: Mutation, _excludedPort) => {
            FerryLog.debug("New page mutation/action being distributed.");
            Port.postMessage({ mutation: mutationPayload } as AddonMessage);
        });
        Port.raw.onMessage.addListener(function (m: AddonMessage) {
            FerryLog.debug("In browser content page script, received message from background script");

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
                    formFilling.removeFieldIconFromAllFields();
                    otpFields.observe();
                    otpFields.rescan();
                } else {
                    // Gesperrt: Symbole bleiben (Zustand "gesperrt"), Klick entsperrt per Windows Hello
                    formFilling.lockFieldIcons(startUnlockWaitIfLocked);
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
                formFilling.findLoginsResultHandler(m.findMatchesResult, m.preferredUuid, m.previousUsernameUnknown);
            }

            if (m.action == Action.ManualFill && m.selectedEntryIndex != null) {
                formFilling.closeMatchedLoginsPanel();
                formFilling.fillAndSubmit(false, null, m.selectedEntryIndex);
            }

            if (m.action == Action.ResetForms) {
                formFilling.removeFieldIconFromAllFields();
                formSaving.removeAllSubmitHandlers();
            }

            if (m.action == Action.Primary) {
                formFilling.executePrimaryAction();
            }

            if (m.action == Action.GeneratePassword) {
                passwordGenerator.createGeneratePasswordPanel(!!m.canInsert);
            }

            if (m.action == Action.CloseAllPanels) {
                passwordGenerator.closeGeneratePasswordPanel();
                formFilling.closeMatchedLoginsPanel();
            }

            if (m.action == Action.ShowMatchedLoginsPanel) {
                formFilling.createMatchedLoginsPanelInCenter(m.frameId);
            }

            if (m.action == Action.ShowSaveNotice) {
                // Passwort eines vorhandenen Eintrags geändert: "aktualisieren?" statt "speichern?"
                if (m.saveNoticeUpdateFor) offerPasswordUpdateNotice(m.saveNoticeUpdateFor);
                else showSaveNotice();
            }

            if (m.action == Action.ShowSavedNotice) {
                showSaveNotice("saved", null, { title: $STR("ferry_saved_title"), text: m.savedEntryTitle ?? "" });
            }

            if (m.action == Action.ShowExpiryNotice && m.expiryNotice) {
                showSaveNotice(m.expiryNotice.expired ? "expired" : "expiring", null, m.expiryNotice);
            }

            if (m.action == Action.WithdrawSaveNotice) {
                withdrawSaveNotice();
            }

            if (m.action == Action.UnlockState && m.unlocked && unlockWaitTimer !== null) {
                stopUnlockWait();
                if (m.resetState) store.resetTo(m.resetState);
                formFilling.removeFieldIconFromAllFields();
                formFilling.findMatchesInThisFrame();
                otpFields.rescan();
            }

            if (m.action == Action.ShowOtpSetupNotice) {
                showSaveNotice("otp", m.otpIssuer);
            }

            // Schlüssel steht schon in einem Eintrag (erst nach dem Entsperren bzw. Verbinden festgestellt)
            if (m.action == Action.HideOtpSetupNotice) {
                hideSaveNotice("otp");
            }

            if (m.action == Action.FillOtp && m.otpCode) {
                otpFields.fill(m.otpCode, m.otpRemaining, m.otpPeriod);
            } else if (m.action == Action.FillOtp && m.otpIconOnly) {
                otpFields.showIconOnly();
            }

            // Popup: welche Felder hat dieser Frame, und einzelnes Feld füllen
            if (m.action == Action.QueryFields) {
                Port.postMessage({ queryId: m.queryId, fieldsAvailable: availableFieldKinds(otpFields.hasTarget()) } as AddonMessage);
            }
            if (m.action == Action.FillField && m.fillKind) {
                if (m.fillKind === "otp") {
                    if (m.otpCode) otpFields.fillFromPopup(m.otpCode, m.otpRemaining, m.otpPeriod);
                } else {
                    fillFieldKind(m.fillKind, m.fillValue);
                }
            }
            if (m.action == Action.ResizePanel) {
                formFilling.matchedLoginsPanelStub?.resize(m.panelHeight);
            }
            if (m.action == Action.FillPanelTarget && m.fillValue) {
                if (formFilling.matchedLoginsPanelStub?.fillTarget(m.fillValue, m.fillHow ?? "liste") && m.filledEntry?.uuid) {
                    Port.postMessage({ action: Action.EntryFilled, filledEntry: m.filledEntry } as AddonMessage);
                }
            }
            if (m.action == Action.CapturePageAnalysis) {
                capturePageAnalysis(formFilling?.analysisSummary() ?? {}, el => formFilling?.analysisFieldRole(el));
            }
            if (m.action == Action.FillContextTarget) {
                fillContextTarget(m.fillValue);
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
        cancelPasswordUpdateNotice();
        otpFields.reset();
        stopUnlockWait();
        inputsObserver.disconnect();
        if (Port.raw) Port.postMessage({ action: Action.PageHide });
        //TODO:f: work out why this can be null. Was never connected for some reason? E.g. background script bug or injected into a page type we can't support?
        formFilling?.removeFieldIconFromAllFields();
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
