import { preparePasskey, finishPasskey, cancelPasskey, signalPasskey, finishSignal } from "./passkeys";
import { diag } from "./ferryDiag";
import { handleOtpSetupCandidate, dismissOtpSetup, isOtpSetupPending } from "./otpSetup";
import { isRepeatedAutoFill, rememberAutoFill } from "./otpRepeat";
import { sameSite } from "../common/relatedDomains";
import { submittedCredentials, supersedesSubmission, usernameMatches } from "../common/submittedLogin";
import type { PersistentDataItem } from "./PersistentDataItem";
import type { PersistentTabState } from "./PersistentTabState";
import type { SubmittedData } from "../common/SubmittedData";
import { BROWSER_UPDATE_PLUGIN_VERSION, pluginVersionAtLeast } from "../common/FeatureFlags";
import { onFieldsAvailable } from "./pageFields";
import { checkExpiryAfterFill, openChangePasswordFromNotice, snoozeExpiryNotice } from "./expiryNotice";
import { FerryURL } from "../common/FerryURL";
import type { AddonMessage } from "../common/AddonMessage";
import { FerryLog } from "../common/Logger";
import { createOsNotification } from "../common/osNotification";
import { FerryNotification } from "../common/FerryNotification";
import { Action } from "../common/Action";
import { configManager } from "../common/ConfigManager";
import { Entry } from "../common/model/Entry";
import { entryWithNewPassword } from "../common/passwordUpdate";
import { tabFaviconPng } from "./tabFavicon";
import { copyStringToClipboard } from "../common/copyStringToClipboard";
import { ferry } from "./KF";
import { pageStateOf } from "./pageState";
import { commandManager } from "./commands";
import { openEntryInPopup } from "./popupEdit";
import { findEntryForEdit, onContextField } from "./selectionSave";


// callbacks for messaging / ports

// "Jetzt aktualisieren" (Popup-Hinweis, Willkommensseite, Einstellungen): Update in KeePass anstoßen, sonst
// Release-Seite öffnen. Ergebnis wie StartPluginUpdate ("started", "cancelled" …), "releasepage" für alte Plugins
export async function startPluginUpdate(): Promise<string> {
    // Plugins vor 1.0.8 führen das ganze Update auf dem Kanal zum Browser aus und können ihn dabei blockieren:
    // für sie gleich die Release-Seite mit dem Setup öffnen
    if (!pluginVersionAtLeast(ferry.rpc.pluginClient.nativeSessionManager.features(), BROWSER_UPDATE_PLUGIN_VERSION)) {
        diag("hintergrund", "plugin-update", { ergebnis: "release-seite (altes plugin)" });
        chrome.tabs.create({ url: "https://github.com/KeePassFerry/KeePassFerry/releases/latest" });
        return "releasepage";
    }
    // Plugins vor 1.0.4 kennen StartPluginUpdate nicht (Ergebnis null): dann die Download-Seite öffnen
    const result = await ferry.rpc.startPluginUpdate();
    diag("hintergrund", "plugin-update", { ergebnis: result });
    if (result === "signature_invalid" || result === "checksum_mismatch") {
        // Release nicht korrekt signiert: nicht zum Download schicken, sondern warnen
        createOsNotification("keepassferry-update-unsafe", {
            type: "basic",
            iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
            title: $STR("security_warning_title"),
            message: $STR("ferry_plugin_update_unsafe"),
            requireInteraction: true,
            priority: 2
        });
    } else if (result === "uptodate") {
        // Installiertes Plugin ist das neueste Release (Erweiterung neuer als jedes veröffentlichte Plugin)
        // Eigene ID je Meldung: bei gleicher ID ersetzt der Browser die alte still, ohne erneut anzuzeigen
        createOsNotification("keepassferry-update-none-" + Date.now(), {
            type: "basic",
            iconUrl: chrome.runtime.getURL("/assets/images/128.png"),
            title: "KeePassFerry",
            message: $STR("ferry_plugin_update_none")
        });
    } else if (result !== "started" && result !== "cancelled") {
        chrome.tabs.create({ url: "https://github.com/KeePassFerry/KeePassFerry/releases/latest" });
    }
    return result;
}

export async function browserPopupMessageHandler(this: chrome.runtime.Port, msg: AddonMessage) {
    if (msg.mutation) {
        ferry.store.onRemoteMessage(this, msg.mutation);
    }

    if (FerryLog && FerryLog.debug) {
        FerryLog.debug("In background script, received message from browser popup script.");
    }

    if (msg.removeNotification) {
        ferry.removeUserNotifications((n: FerryNotification) => n.id != msg.removeNotification);
    }
    if (msg.startPluginUpdate) {
        const result = await startPluginUpdate();
        this.postMessage({ pluginUpdateResult: result } as AddonMessage);
        return;
    }
    if (msg.action == Action.GetPasswordProfiles) {
        const passwordProfiles = await ferry.getPasswordProfiles();
        ferry.store.updatePasswordProfiles(passwordProfiles);
    }
    if (msg.action === Action.GeneratePassword) {
        // Ohne Bearbeiten-Fenster (Generator im Popup) die Seite des aktiven Tabs: die Sicherung des Passworts in
        // "Generierte Passwörter" soll zeigen, für welche Website es erzeugt wurde (Issue #12)
        const tabUrl = msg.url ? null : await chrome.tabs.get(ferry.foregroundTabId).then(t => t?.url, () => null);
        const generatedPassword = await ferry.generatePassword(
            msg.passwordProfile,
            msg.url || (tabUrl && /^https?:/.test(tabUrl) ? tabUrl : null) || "unknown URL"
        );
        if (generatedPassword) {
            ferry.store.updateGeneratedPassword(generatedPassword);
        } else {
            FerryLog.warn(
                "KeePassFerry received an empty/missing password. Check the configuration of your password manager."
            );
        }
    }
    if (msg.action === Action.CreateEntry || msg.action === Action.UpdateEntry) {
        if (ferry.store.state.connected) {
            const sourceEntry = ferry.store.state.saveState.newEntry;
            const existingOrTemporaryUuid = sourceEntry.uuid;
            const dbFileName = sourceEntry.database.fileName;
            const parentGroupUuid: string = sourceEntry.parentGroup.uuid;
            // Website-Symbol nur, wenn es von derselben Website stammt wie der Eintrag; danach verwerfen, damit es
            // nicht an einem später gespeicherten Eintrag einer anderen Seite landet (#43)
            const saveState = ferry.store.state.saveState;
            const faviconDomain = FerryURL.fromString(saveState.faviconPageUrl ?? "")?.domainOrIPAddress;
            const entryDomain = FerryURL.fromString(sourceEntry.URLs?.[0] ?? "")?.domainOrIPAddress;
            const favicon =
                configManager.current.saveFavicons && saveState.favicon && sameSite(faviconDomain, entryDomain)
                    ? saveState.favicon
                    : null;
            if (saveState.favicon || saveState.faviconPageUrl) {
                ferry.store.updateSaveState({ ...saveState, favicon: null, faviconPageUrl: null });
            }

            // shallow clone so we don't impact the values we have to wipe out below
            // The plugin has particular expectations about some Entry properties.
            // parent group UUID, DB and UUID should all be undefined or null as set below.
            const entry = new Entry(
                Object.assign(Object.assign({} as Entry, sourceEntry) as Entry, {
                    parentGroup: undefined,
                    uuid: null,
                    database: undefined,

                    // We will rarely have access to the favicon data at the time the initial
                    // Entry is created for editing in the popup so set it at this much later
                    // point instead.
                    icon: favicon
                        ? {
                              version: 1,
                              iconImageData: favicon
                          }
                        : null
                })
            );

            // Might be changed by the user before the plugin says all worked OK
            const tabId = ferry.foregroundTabId;
            // Nach erfolgreichem Speichern (vor dem Neuladen der Einträge): Bestätigung auf der Seite
            const clearSubmittedData = () => {
                if (!configManager.current.hideConfirmationAfterSave) {
                    try {
                        ferry.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({
                            action: Action.ShowSavedNotice,
                            savedEntryTitle: entry.title
                        } as AddonMessage);
                    } catch (e) {
                        // Seite lädt gerade neu
                    }
                }
                if (ferry.persistentTabStates.get(tabId)?.items?.length > 0) {
                    ferry.persistentTabStates.get(
                        tabId
                    ).items = ferry.persistentTabStates
                        .get(tabId)
                        .items.filter(item => item.itemType !== "submittedData");
                }
            };

            if (msg.action === Action.UpdateEntry) {
                ferry.store.updateEntryUpdateStartedAtTimestamp(Date.now());
                ferry.updateLogin(
                    entry,
                    existingOrTemporaryUuid,
                    dbFileName,
                    clearSubmittedData
                );
            } else {
                ferry.addLogin(entry, parentGroupUuid, dbFileName, clearSubmittedData);
                // Gruppe nur beim Neuanlegen als Vorauswahl merken, nicht beim Bearbeiten eines vorhandenen Eintrags
                if (!configManager.current.mruGroup) configManager.current.mruGroup = {};
                configManager.current.mruGroup[dbFileName] = parentGroupUuid;
                configManager.current.mruGroup["{<{{<<ferry-primary>>}}>}"] = parentGroupUuid;
                configManager.save();
            }
        }
    }

    if (msg.action == Action.ManualFill && msg.selectedEntryIndex != null) {
        ferry.tabStates
            .get(ferry.foregroundTabId)
            .framePorts.get(msg.frameId || 0)
            .postMessage(msg);
        ferry.tabStates
            .get(ferry.foregroundTabId)
            .framePorts.get(0)
            .postMessage({ action: Action.CloseAllPanels });
    }

    if (msg.action === Action.OpenKeePass) {
        ferry.openKeePass();
    }
    if (msg.findMatches) {
        const result = await ferry.findLogins(
            null,
            null,
            msg.findMatches.uuid,
            msg.findMatches.DBfilename,
            null,
            null
        );
        ferry.browserPopupPort.postMessage({
            findMatchesResult: result
        } as AddonMessage);
    }
    if (msg.loginEditor) {
        ferry.launchLoginEditor(msg.loginEditor.uuid, msg.loginEditor.DBfilename);
    }
    if (msg.action === Action.DetectForms) {
        ferry.tabStates.get(ferry.foregroundTabId).framePorts.forEach(port => {
            port.postMessage({
                action: Action.DetectForms
            });
        }, this);
    }
}

// Neue Anmeldung desselben Benutzers auf derselben Website: eine frühere abweichende Eingabe im Tab (z. B. vertipptes
// Passwort) nicht mehr zum Speichern bzw. Aktualisieren anbieten und einen schon gezeigten Hinweis schließen
// Benutzername aus dem ersten Schritt einer mehrstufigen Anmeldung derselben Website, 10 Minuten gültig
function pendingUsernameFor(state: PersistentTabState, domain: string) {
    const pending = state?.pendingUsername;
    return pending && sameSite(pending.domain, domain) && pending.at > Date.now() - 10 * 60 * 1000 ? pending : null;
}

// Mehrstufige Anmeldung (wie Bitwarden): den Benutzernamen eines Formulars ohne Passwort merken; fehlt er im folgenden
// Passwortformular derselben Website, gehört er zu dessen Anmeldung
function applyPendingUsername(tabId: number, submitted: SubmittedData) {
    const fields = submitted.fields ?? [];
    const domain = FerryURL.fromString(submitted.url ?? "")?.domainOrIPAddress;
    if (!domain) return;
    if (!fields.some(f => f.type === "password" && f.value)) {
        const field = fields.find(f => f.type !== "password" && f.type !== "boolean" && f.value);
        if (!field) return;
        if (!ferry.persistentTabStates.get(tabId)) ferry.persistentTabStates.set(tabId, { items: [] });
        ferry.persistentTabStates.get(tabId).pendingUsername = { field, domain, at: Date.now() };
        diag("hintergrund", "benutzername ohne passwort abgeschickt, vorgemerkt", { domain });
        return;
    }
    if (submittedCredentials(fields).username) return;
    const pending = pendingUsernameFor(ferry.persistentTabStates.get(tabId), domain);
    diag("hintergrund", "passwort ohne benutzername abgeschickt", { vorgemerkt: !!pending });
    if (pending) submitted.fields = [pending.field, ...fields];
}

function dropSupersededSubmission(tabId: number, url: string, username: string) {
    const item = ferry.persistentTabStates.get(tabId)?.items?.find(i => i.itemType === "submittedData");
    if (!item?.submittedData) return;
    const previous = { url: item.submittedData.url, username: submittedCredentials(item.submittedData.fields ?? []).username };
    if (supersedesSubmission(previous, { url, username })) removeSubmission(tabId, item);
}

// Website-Symbol des Tabs, wenn die Seite zur Website des Eintrags gehört und Symbole gespeichert werden sollen
async function sameSiteFavicon(tabId: number, entryUrl: string): Promise<string> {
    if (!configManager.current.saveFavicons) return null;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const pageDomain = FerryURL.fromString(tab?.url ?? "")?.domainOrIPAddress;
    const entryDomain = FerryURL.fromString(entryUrl ?? "")?.domainOrIPAddress;
    if (!tab?.favIconUrl || !sameSite(pageDomain, entryDomain)) return null;
    return tabFaviconPng(tab.favIconUrl);
}

// Neues Passwort eines vorhandenen Eintrags ohne Bearbeiten-Fenster übernehmen. Geändert wird nur das Passwort, das
// alte bleibt in der Chronik des Eintrags. false: nichts gespeichert (kein Ziel, Eintrag nicht gefunden, Datenbank
// gesperrt oder schreibgeschützt, Fehler) – dann öffnet der Aufrufer wie bisher das Popup.
async function updatePasswordDirectly(tabId: number): Promise<boolean> {
    const item = ferry.persistentTabStates.get(tabId)?.items?.find(i => i.itemType === "submittedData");
    const target = item?.submittedData?.updateTarget;
    const password = submittedCredentials(item?.submittedData?.fields ?? []).password;
    if (!target || !password || !ferry.store.state.connected) return false;
    if (ferry.store.state.KeePassDatabases.find(d => d.fileName === target.dbFileName)?.readOnly) return false;
    try {
        const found = await findEntryForEdit(target.uuid, target.dbFileName);
        if (!found) return false;
        const entry = entryWithNewPassword(new Entry(found), password, await sameSiteFavicon(tabId, found.URLs?.[0]));
        let saved = false;
        ferry.store.updateEntryUpdateStartedAtTimestamp(Date.now());
        await ferry.updateLogin(entry, target.uuid, target.dbFileName, () => {
            saved = true;
            // Erst das Angebot zurückziehen (schließt den Hinweis), dann die Bestätigung zeigen
            removeSubmission(tabId, item);
            if (!configManager.current.hideConfirmationAfterSave) {
                try {
                    ferry.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({
                        action: Action.ShowSavedNotice,
                        savedEntryTitle: entry.title
                    } as AddonMessage);
                } catch (e) {
                    // Seite lädt gerade neu
                }
            }
        });
        diag("hintergrund", "passwort direkt aktualisiert", { gespeichert: saved });
        return saved;
    } catch (e) {
        FerryLog.warn("Could not update the password directly: " + e);
        return false;
    }
}

// "Passwort aktualisieren" kam nicht, weil das Anmeldeformular stehen blieb: Anmeldung fehlgeschlagen, das eingegebene
// Passwort nicht mehr anbieten (auch nicht später auf einer anderen Seite)
function dropFailedPasswordUpdate(tabId: number) {
    const item = ferry.persistentTabStates.get(tabId)?.items?.find(i => i.itemType === "submittedData");
    if (item?.submittedData?.updateTarget) removeSubmission(tabId, item);
}


function removeSubmission(tabId: number, item: PersistentDataItem) {
    const state = ferry.persistentTabStates.get(tabId);
    state.items = state.items.filter(i => i !== item);
    ferry.configureBrowserActionIcon();
    try {
        ferry.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({ action: Action.WithdrawSaveNotice } as AddonMessage);
    } catch (e) {
        // Seite lädt gerade neu
    }
}

export async function pageMessageHandler(this: chrome.runtime.Port, msg: AddonMessage) {
    if (FerryLog && FerryLog.debug) {
        FerryLog.debug("In background script, received message from page script.");
    }

    if (msg.mutation) {
        ferry.store.onRemoteMessage(this, msg.mutation);
    }

    if (msg.findMatches) {
        // Gesperrt: die Seite zeigt das Gesperrt-Symbol, erst ein Klick darauf (oder aufs Erweiterungssymbol)
        // entsperrt. Kein Entsperren beim bloßen Öffnen einer Seite (Option dafür in 1.0.15 entfernt, Issue #11)
        ferry.tabStates.get(this.sender.tab.id).frames.get(this.sender.frameId).entries = [];
        const result = await ferry.findLogins(
            msg.findMatches.uri,
            null,
            null,
            null,
            null,
            null
        );
        const frameState = ferry.tabStates.get(this.sender.tab.id)?.frames.get(this.sender.frameId);
        if (frameState) frameState.urlEntries = result ?? [];
        if (this.sender.tab.id === ferry.foregroundTabId) commandManager.scheduleContextMenuUpdate();
        // Mehrseitige Anmeldung: auf Folgeseiten derselben Domain den Eintrag zum zuletzt abgeschickten Benutzernamen
        // nehmen, sonst den eben im Tab gewählten Eintrag. Passt kein Eintrag zum Benutzernamen (neues Konto), füllt
        // die Seite ein Passwortfeld ohne Benutzerfeld nicht von selbst aus
        let preferredUuid: string;
        let previousUsernameUnknown = false;
        const tabState = ferry.persistentTabStates.get(this.sender.tab.id);
        const domain = FerryURL.fromString(this.sender.url ?? msg.findMatches.uri ?? "")?.domainOrIPAddress;
        const last = tabState?.lastFilledEntry;
        const validLast = last && sameSite(last.domain, domain) && last.at > Date.now() - 10 * 60 * 1000 ? last : null;
        const pending = pendingUsernameFor(tabState, domain);
        if (pending && (!validLast || pending.at > validLast.at)) {
            const matches = (result ?? []).filter(e => usernameMatches(pending.field.value, Entry.getUsernameField(e)?.value));
            const chosen = matches.find(e => e.uuid === validLast?.uuid) ?? matches[0];
            if (chosen) preferredUuid = chosen.uuid;
            else previousUsernameUnknown = true;
            diag("hintergrund", "benutzername der vorseite", { passenderEintrag: !!chosen });
        } else if (validLast && result?.some(e => e.uuid === validLast.uuid)) {
            preferredUuid = validLast.uuid;
        }
        this.postMessage({
            isForegroundTab: this.sender.tab.id === ferry.foregroundTabId,
            findMatchesResult: result,
            preferredUuid,
            previousUsernameUnknown
        } as AddonMessage);

        //TODO:f: content scripts are responsible for recording the results from the searches they initiated into the shared data store (and updating the set of results when the active tab is changed).
        // Maybe in future we can find a way to handle that in the background worker so we can immediately ask the browser action icon to update using the results.
        // Potential workaround if required is to force a "number of matched results" parameter in the call to this update function but yuk.
        //configureBrowserActionIcon();
        //TODO:f: would be nice to show number of matching results on browser action icon but either need another async call from the page (yuk) or to store the matched logins in the main store rather than passing them on the message object.
        //TODO:f: putting in main store will probably help with other new features too.
    }
    if (msg.removeNotification) {
        ferry.removeUserNotifications((n: FerryNotification) => n.id != msg.removeNotification);
        try {
            ferry.browserPopupPort.postMessage({
                isForegroundTab: this.sender.tab.id === ferry.foregroundTabId
            } as AddonMessage);
        } catch (e) {
            /* whatever */
        }
    }
    if (msg.entries) {
        //TODO:f: When/how is this msg sent? it might be somewhere we can trigger the browser action button update to display the number of matched items.
        ferry.tabStates.get(this.sender.tab.id).frames.get(this.sender.frameId).entries =
            msg.entries;
        if (this.sender.tab.id === ferry.foregroundTabId) commandManager.scheduleContextMenuUpdate();
    }
    if (msg.requestUnlock) {
        // Klick auf ein gesperrtes Feldsymbol: bewusste Aktion, ohne Bremsen entsperren
        const result = await ferry.requestBackgroundUnlock(this.sender.tab.id, this.sender.url ?? "", true);
        diag("hintergrund", "feldsymbol geklickt (gesperrt)", { ergebnis: result });
        // Nichts zu entsperren (keine Datenbank geladen): KeePass holen, wie beim Klick auf das Symbol in der Leiste
        if (result !== "started" && !result?.startsWith("busy") && !result?.startsWith("focused")) ferry.openKeePass();
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
    if (msg.submittedData) applyPendingUsername(this.sender.tab.id, msg.submittedData);
    // Nur Formulare mit ausgefülltem Passwortfeld sind Anmeldungen (wie Bitwarden); Einstellungs-, Such- oder
    // Bankformulare ohne Passwort lösen keinen Speichern-Hinweis aus
    const submittedHasPassword = !!msg.submittedData?.fields?.some((f: any) => f.type === "password" && f.value);
    const submittedUser = msg.submittedData ? submittedCredentials(msg.submittedData.fields ?? []).username : null;
    // Neue Anmeldung desselben Benutzers verdrängt ein offenes Angebot sofort, noch vor der Prüfung gegen KeePass
    // (sonst zeigt die nächste Seite womöglich das alte Angebot, während die Prüfung läuft)
    if (msg.submittedData && submittedHasPassword) {
        dropSupersededSubmission(this.sender.tab.id, msg.submittedData.url, submittedUser);
    }
    // Schon in KeePass vorhandene Zugangsdaten (auch nur der Benutzername im ersten Schritt
    // mehrstufiger Anmeldungen) lösen keinen Speichern-Hinweis aus; derselbe Benutzer mit anderem Passwort
    // bietet an, den vorhandenen Eintrag zu aktualisieren
    const submittedMatch = msg.submittedData ? await ferry.classifySubmittedData(msg.submittedData, this.sender.tab.id) : null;
    if (msg.submittedData) {
        diag("hintergrund", "formular abgeschickt", {
            felder: (msg.submittedData.fields ?? []).map((f: any) => ({ typ: f.type, name: f.name, gefuellt: !!f.value })),
            ergebnis: submittedMatch.kind
        });
    }
    // Vorhandener Eintrag in einer schreibgeschützten Datenbank (z. B. nur lesend geteilt): Aktualisieren ginge nicht
    const updateImpossible =
        submittedMatch?.kind === "passwordChanged" &&
        !!ferry.store.state.KeePassDatabases.find(db => db.fileName === submittedMatch.entry.dbFileName)?.readOnly;
    if (msg.submittedData && (submittedMatch.kind === "known" || updateImpossible)) {
        FerryLog.debug("Submitted data matches an existing entry; no save offer");
        // Auch ein bekannter Benutzername allein (erster Schritt einer mehrstufigen Anmeldung) erledigt ein Angebot
        dropSupersededSubmission(this.sender.tab.id, msg.submittedData.url, submittedUser);
    } else if (msg.submittedData && !submittedHasPassword) {
        FerryLog.debug("Submitted form has no password; no save offer");
    } else if (msg.submittedData) {
        const target = submittedMatch.kind === "passwordChanged" ? submittedMatch.entry : null;
        // Bezeichnung im Hinweis nie leer (sonst zeigt die Seite "speichern?" statt "aktualisieren?")
        const label = target
            ? target.username || target.title || FerryURL.fromString(msg.submittedData.url ?? "")?.domainOrIPAddress || "?"
            : null;
        const persistentItem = {
            itemType: "submittedData" as const,
            submittedData: target
                ? { ...msg.submittedData, updateTarget: { uuid: target.uuid, dbFileName: target.dbFileName, label } }
                : msg.submittedData,
            creationDate: new Date()
        };

        if (!ferry.persistentTabStates.get(this.sender.tab.id)) {
            ferry.persistentTabStates.set(this.sender.tab.id, {
                items: []
            });
        }

        // Don't allow more than one entry to be tracked for this tab
        if (ferry.persistentTabStates.get(this.sender.tab.id)) {
            ferry.persistentTabStates.get(
                this.sender.tab.id
            ).items = ferry.persistentTabStates
                .get(this.sender.tab.id)
                .items.filter(item => item.itemType !== "submittedData");
        }

        ferry.persistentTabStates.get(this.sender.tab.id).items.push(persistentItem);

        ferry.configureBrowserActionIcon();
        ferry.offerSaveNotice(this.sender.tab.id);
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
        const unlocked = ferry.store.state.connected && ferry.store.state.KeePassDatabases.length > 0;
        this.postMessage({
            action: Action.UnlockState,
            unlocked,
            resetState: unlocked ? pageStateOf(ferry.store.state) : undefined
        } as AddonMessage);
    }
    if (msg.action === Action.EntryFilled && msg.filledEntry?.uuid) {
        const tabId = this.sender.tab.id;
        const domain = FerryURL.fromString(this.sender.url ?? this.sender.tab.url)?.domainOrIPAddress;
        if (domain) {
            if (!ferry.persistentTabStates.get(tabId)) ferry.persistentTabStates.set(tabId, { items: [] });
            ferry.persistentTabStates.get(tabId).lastFilledEntry = {
                uuid: msg.filledEntry.uuid,
                dbFileName: msg.filledEntry.dbFileName,
                domain,
                at: Date.now()
            };
        }
        // Option "Ablaufdaten prüfen": Hinweis, wenn das Passwort bald abläuft oder abgelaufen ist
        checkExpiryAfterFill(tabId, msg.filledEntry.uuid, msg.filledEntry.dbFileName);
    }
    if (msg.action === Action.OpenChangePassword) {
        openChangePasswordFromNotice(this.sender.tab.id);
    }
    if (msg.action === Action.DismissExpiryNotice) {
        snoozeExpiryNotice(this.sender.tab.id);
    }
    if (msg.action === Action.RequestOtp && msg.url) {
        // Nur für die eigene URL des Frames, nicht für eine von der Seite behauptete
        const frameUrl = this.sender.url ?? msg.url;
        try {
            if (ferry.store.state.connected && ferry.store.state.KeePassDatabases.length === 0) {
                // Nur nach einem Klick (Symbol am Codefeld) entsperren, nie beim bloßen Erkennen des Felds
                diag("hintergrund", "otp angefragt, db gesperrt", { klick: !!msg.userInitiated });
                if (msg.userInitiated) {
                    ferry.requestBackgroundUnlock(this.sender.tab.id, frameUrl, !!msg.userInitiated);
                }
                return;
            }
            if (await isOtpSetupPending(this.sender.tab.id, frameUrl)) {
                diag("hintergrund", "otp angefragt, aber einrichtung offen -> nicht ausfüllen");
                return;
            }
            const totp = await ferry.findTotpCode(this.sender.tab.id, frameUrl);
            diag("hintergrund", "otp angefragt", { code: totp ? "gefunden" : "keiner", rest: totp?.remainingSeconds });
            if (totp) {
                const domain = FerryURL.fromString(frameUrl)?.domainOrIPAddress;
                // Derselbe Code schon von selbst eingetragen (Seite hat neu geladen, z. B. nach "ungültig"): nur das Symbol
                if (!msg.userInitiated && (await isRepeatedAutoFill(this.sender.tab.id, domain, totp.code))) {
                    diag("hintergrund", "otp schon eingetragen -> nur symbol");
                    this.postMessage({ action: Action.FillOtp, otpIconOnly: true } as AddonMessage);
                    return;
                }
                if (!msg.userInitiated) await rememberAutoFill(this.sender.tab.id, domain, totp.code);
                this.postMessage({
                    action: Action.FillOtp,
                    otpCode: totp.code,
                    otpRemaining: totp.remainingSeconds,
                    otpPeriod: totp.period
                } as AddonMessage);
            }
        } catch (e) {
            FerryLog.warn("Could not get a one-time code: " + e);
        }
    }
    if (msg.action === Action.OtpSetupCandidate && msg.otpSetup) {
        // Nur die vom Browser gemeldete Frame-URL zählt, nicht eine von der Seite behauptete
        // Nicht abwarten: eine gleich folgende Code-Anfrage der Seite wartet selbst auf das Ergebnis
        handleOtpSetupCandidate(this.sender.tab.id, this.sender.url ?? this.sender.tab.url, msg.otpSetup);
    }
    if (msg.contextField && msg.queryId) {
        onContextField(msg.queryId, msg.contextField);
    }
    if (msg.fieldsAvailable && msg.queryId) {
        onFieldsAvailable(msg.queryId, msg.fieldsAvailable);
    }
    if (msg.action === Action.DismissOtpSetup) {
        dismissOtpSetup(this.sender.tab.id);
    }
    if (msg.action === Action.OpenOtpSetupPopup) {
        ferry.foregroundTabId = this.sender.tab.id;
        try {
            await chrome.action.setPopup({ popup: "dist/popup/index.html?otp=1" });
            await chrome.action.openPopup();
        } catch (e) {
            FerryLog.warn("Could not open the popup for the one-time code setup: " + e);
        } finally {
            await chrome.action.setPopup({ popup: "dist/popup/index.html" });
        }
    }
    if (msg.action === Action.OpenSavePopup) {
        // Popup einmalig mit ?save=1 öffnen, damit es direkt im Speichern-Dialog startet.
        // Der anfragende Tab ist der Vordergrund-Tab (nach einem Neustart ist der Wert sonst noch leer).
        ferry.foregroundTabId = this.sender.tab.id;
        // "Neues Passwort erkannt" → "Aktualisieren": direkt speichern, ohne Bearbeiten-Fenster (Michael, 13.11.)
        if (await updatePasswordDirectly(this.sender.tab.id)) return;
        try {
            await chrome.action.setPopup({ popup: "dist/popup/index.html?save=1" });
            await chrome.action.openPopup();
        } catch (e) {
            FerryLog.warn("Could not open the popup for saving: " + e);
        } finally {
            await chrome.action.setPopup({ popup: "dist/popup/index.html" });
        }
    }
    // Unverändert mit den eingetragenen Daten angemeldet: ein offenes Angebot desselben Benutzers ist erledigt
    if (msg.action === Action.FilledLoginSubmitted) {
        diag("hintergrund", "anmeldung mit ausgefüllten daten abgeschickt", { benutzer: !!msg.submittedUsername });
        dropSupersededSubmission(this.sender.tab.id, this.sender.url ?? this.sender.tab.url, msg.submittedUsername ?? null);
    }
    if (msg.action === Action.PasswordUpdateNotShown) {
        dropFailedPasswordUpdate(this.sender.tab.id);
    }
    if (msg.action === Action.DismissSaveNotice) {
        ferry.persistentTabStates
            .get(this.sender.tab.id)
            ?.items?.filter(item => item.itemType === "submittedData")
            .forEach(item => (item.noticeDismissed = true));
    }
    if (msg.action === Action.ShowMatchedLoginsPanel) {
        ferry.tabStates.get(this.sender.tab.id).framePorts.get(0).postMessage({
            action: Action.ShowMatchedLoginsPanel,
            frameId: this.sender.frameId
        });
    }
    if (msg.action === Action.PageHide) {
        try {
            ferry.tabStates.get(this.sender.frameId).framePorts.forEach((port, key, map) => {
                try {
                    port.disconnect();
                } catch (e) {
                    if (FerryLog && FerryLog.debug) {
                        FerryLog.debug(
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
            ferry.deleteTabState(this.sender.tab.id);
        }
    }
}

export async function iframeMessageHandler(this: chrome.runtime.Port, msg: AddonMessage) {
    if (msg.mutation) {
        ferry.store.onRemoteMessage(this, msg.mutation);
    }

    if (FerryLog && FerryLog.debug) {
        FerryLog.debug("In background script, received message from iframe script.");
    }

    const tabId = this.sender.tab.id;

    if (msg.action == Action.ManualFill && msg.selectedEntryIndex != null) {
        ferry.tabStates
            .get(tabId)
            .framePorts.get(msg.frameId || 0)
            .postMessage(msg);
        ferry.tabStates
            .get(tabId)
            .framePorts.get(0)
            .postMessage({ action: Action.CloseAllPanels });
    }

    if (msg.action == Action.CloseAllPanels) {
        ferry.tabStates.get(tabId).framePorts.get(0).postMessage(msg);
    }

    if (msg.action == Action.ResizePanel) {
        ferry.tabStates.get(tabId)?.framePorts.get(msg.frameId || 0)?.postMessage(msg);
    }

    // Liste am Feld: einzelnen Wert in genau dieses Feld eintragen (Einmalcode erst jetzt aus KeePass)
    if (msg.action == Action.FillPanelTarget) {
        const port = ferry.tabStates.get(tabId)?.framePorts.get(msg.frameId || 0);
        let value = msg.fillValue;
        let how = "liste";
        if (msg.otpFor) {
            const totp = await ferry.rpc.getTotp(msg.otpFor.uuid, msg.otpFor.dbFileName).catch(() => null);
            value = totp?.code;
            how = "code";
        }
        if (port && value) {
            port.postMessage({ action: Action.FillPanelTarget, fillValue: value, fillHow: how, filledEntry: msg.filledEntry } as AddonMessage);
            ferry.tabStates.get(tabId).framePorts.get(0)?.postMessage({ action: Action.CloseAllPanels });
        }
    }

    if (msg.action == Action.GetPasswordProfiles) {
        const passwordProfiles = await ferry.getPasswordProfiles();
        ferry.store.updatePasswordProfiles(passwordProfiles);
    }

    if (msg.action == Action.GeneratePassword) {
        const generatedPassword = await ferry.generatePassword(
            msg.passwordProfile,
            ferry.tabStates.get(tabId).url
        );
        if (generatedPassword) {
            ferry.store.updateGeneratedPassword(generatedPassword);
            this.postMessage({
                generatedPassword: generatedPassword
            } as AddonMessage);
        } else {
            FerryLog.warn(
                "KeePassFerry received an empty/missing password. Check the configuration of your password manager."
            );
        }
    }

    if (msg.loginEditor) {
        ferry.launchLoginEditor(msg.loginEditor.uuid, msg.loginEditor.DBfilename);
    }
    if (msg.editEntryInPopup) {
        openEntryInPopup(msg.editEntryInPopup.uuid, msg.editEntryInPopup.DBfilename, this.sender.tab?.windowId);
    }

    // Passwort-Generator: "Einsetzen" in das Feld, in das rechts geklickt wurde
    if (msg.insertGeneratedPassword) {
        const target = ferry.generatorInsertTarget;
        ferry.generatorInsertTarget = null;
        if (target && target.tabId === this.sender.tab?.id) {
            ferry.tabStates.get(target.tabId)?.framePorts.get(target.frameId)?.postMessage({
                action: Action.FillContextTarget,
                fillValue: msg.insertGeneratedPassword
            } as AddonMessage);
        }
    }
    if (msg.copyToClipboard) {
        await copyStringToClipboard(msg.copyToClipboard);
    }
}
