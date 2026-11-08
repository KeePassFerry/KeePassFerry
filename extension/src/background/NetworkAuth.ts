import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { Entry } from "../common/model/Entry";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";
import type { SubmittedData } from "../common/SubmittedData";
import punycode from "punycode/";
import { ferry } from "./KF";

type BlockingResponse = chrome.webRequest.BlockingResponse;
const PASS_ON: BlockingResponse = { cancel: false };

export function isPageRequest(details: any): boolean {
    if (details.isProxy || details.tabId < 0) return false;
    if (details.type === "main_frame") return true;
    // Chrome: initiator (Origin), Firefox: originUrl (URL)
    const from = details.initiator ?? details.originUrl;
    try {
        return !!from && new URL(from).origin === new URL(details.url).origin;
    } catch (e) {
        return false;
    }
}

// Eigene Eingabe nur bei Basic und Digest; NTLM/Kerberos (Windows-Anmeldung im Firmennetz) bleiben beim Browser
export function isPasswordScheme(details: any): boolean {
    const scheme = String(details.scheme ?? "").toLowerCase();
    return scheme === "basic" || scheme === "digest";
}

export class NetworkAuth {
    // Eine Seite lädt oft mehreres gleichzeitig (Seite, Symbol): ein Fenster, dessen Antwort für alle gilt
    private pending = new Map<string, Promise<BlockingResponse>>();
    // Schon mit Zugangsdaten beantwortete Anfragen: fragt der Server erneut, wurde die Anmeldung abgelehnt
    private answered = new Set<string>();

    public provideCredentialsAsyncBlockingCallback(
        requestDetails: any,
        callback: (response: BlockingResponse) => void
    ) {
        this.provideCredentialsAsync(requestDetails)
            .then(result => callback(result))
            .catch(reason => {
                FerryLog.error("AsyncBlockingCallback promise failed", reason);
                callback(PASS_ON);
            });
    }

    public async provideCredentialsAsync(requestDetails: any): Promise<BlockingResponse> {
        FerryLog.debug("Considering handling request ID: " + requestDetails.requestId);

        // Anmeldefenster können auch eingebettete Fremdinhalte auslösen: nur auf ausdrücklichen Wunsch bedienen
        if (!configManager.current.ferryNetworkAuth) return PASS_ON;
        if (!ferry.store.state.connected) return PASS_ON;

        const page = isPageRequest(requestDetails);
        let key = "";
        if (page) {
            try {
                key = requestDetails.tabId + "|" + new URL(requestDetails.url).origin + "|" + (requestDetails.realm ?? "");
            } catch (e) {
                key = "";
            }
        }
        const running = key && this.pending.get(key);
        if (running) return running;

        const result = this.handle(requestDetails, page);
        if (key) {
            this.pending.set(key, result);
            result.finally(() => this.pending.delete(key));
        }
        const response = await result;
        if (response.authCredentials) {
            this.answered.add(requestDetails.requestId);
            if (this.answered.size > 200) this.answered.delete(this.answered.values().next().value);
        }
        return response;
    }

    private async handle(requestDetails: any, page: boolean): Promise<BlockingResponse> {
        if (ferry.store.state.ActiveKeePassDatabaseIndex < 0) {
            // Gesperrt: entsperren lassen, aber nur für die aufgerufene Seite selbst (wie Bitwarden:
            // Seitenaufruf oder Anfrage vom selben Server), nicht für eingebettete Inhalte fremder Server
            if (!page) return PASS_ON;
            if (!(await ferry.unlockAndWait(requestDetails.tabId, requestDetails.url))) return PASS_ON;
            if (ferry.store.state.ActiveKeePassDatabaseIndex < 0) return PASS_ON;
        }

        FerryLog.info("Finding credentials for request ID: " + requestDetails.requestId);
        const url = new URL(requestDetails.url);
        url.hostname = punycode.toUnicode(url.hostname);

        let matchedEntries: Entry[] = [];
        try {
            const result = await ferry.findLogins(url.href, requestDetails.realm, null, null, null, null);
            if (!result) return PASS_ON;
            matchedEntries = result.filter(
                (entry: Entry) => Entry.getUsernameField(entry) && Entry.getPasswordField(entry)
            );
        } catch (e) {
            return PASS_ON;
        }

        // Kein Eintrag: Eingabe im eigenen Fenster anbieten (mit Speichern), sonst bleibt es beim Browser
        if (matchedEntries.length === 0 && (!page || !isPasswordScheme(requestDetails))) return PASS_ON;

        // Erneute Anfrage nach einer automatischen Anmeldung = Passwort abgelehnt: Fenster zeigen statt Schleife
        const retry = this.answered.has(requestDetails.requestId);
        if (
            matchedEntries.length === 1 &&
            configManager.current.autoSubmitNetworkAuthWithSingleMatch &&
            !retry
        ) {
            const entry = matchedEntries[0];
            return {
                authCredentials: {
                    username: Entry.getUsernameField(entry).value,
                    password: Entry.getPasswordField(entry).value
                }
            };
        }

        matchedEntries.sort((_e1, e2) => (e2.httpRealm === requestDetails.realm ? 1 : 0));
        return this.showDialog(requestDetails, url, matchedEntries);
    }

    private showDialog(requestDetails: any, url: URL, matchedEntries: Entry[]): Promise<BlockingResponse> {
        const canSave = ferry.store.state.KeePassDatabases.some(d => !d.readOnly);

        // eslint-disable-next-line no-async-promise-executor
        return new Promise<BlockingResponse>(async (resolve, reject) => {
            let wind: chrome.windows.Window;
            let done = false;

            const finish = (response: BlockingResponse) => {
                done = true;
                resolve(response);
                chrome.runtime.onMessage.removeListener(handleMessage);
                chrome.windows.onRemoved.removeListener(declineHandling);
            };

            function handleMessage(request, sender: chrome.runtime.MessageSender) {
                // Fenster meldet sich, bevor windows.create zurückkommt: kurz warten
                if (done) return;
                if (!wind) {
                    self.setTimeout(() => handleMessage(request, sender), 50);
                    return;
                }
                // Nur Nachrichten aus dem eigenen Fenster (es können mehrere offen sein)
                if (sender.tab?.windowId !== wind.id) return;
                switch (request.action) {
                    case "NetworkAuth_ok": {
                        FerryLog.debug("Filling request ID: " + requestDetails.requestId);
                        if (typeof request.selectedEntryIndex === "number") {
                            const entry = matchedEntries[request.selectedEntryIndex];
                            if (!entry) return;
                            finish({
                                authCredentials: {
                                    username: Entry.getUsernameField(entry).value,
                                    password: Entry.getPasswordField(entry).value
                                }
                            });
                        } else {
                            const username = String(request.username ?? "");
                            const password = String(request.password ?? "");
                            finish({ authCredentials: { username, password } });
                            if (request.save && canSave && password && requestDetails.tabId >= 0) {
                                // Erst nach erfolgreicher Anmeldung (onRequestCompleted) das Speichern-Popup öffnen
                                pendingSaves.set(requestDetails.requestId, {
                                    tabId: requestDetails.tabId,
                                    url,
                                    realm: requestDetails.realm,
                                    username,
                                    password
                                });
                            } else {
                                pendingSaves.delete(requestDetails.requestId);
                            }
                        }
                        break;
                    }
                    case "NetworkAuth_load": {
                        // Can't use sendResponse() because Mozilla chose to not implement it, contrary to the MDN docs
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: "NetworkAuth_matchedEntries",
                            entries: matchedEntries,
                            realm: requestDetails.realm,
                            url: url.href,
                            isProxy: requestDetails.isProxy,
                            canSave
                        });
                        break;
                    }
                }
            }

            function declineHandling(closingWindowId: number) {
                if (closingWindowId !== wind?.id) return;
                FerryLog.debug("Cancelling request ID: " + requestDetails.requestId);
                finish(PASS_ON);
            }

            chrome.runtime.onMessage.addListener(handleMessage);

            // Höhe für Kopf, bis zu drei Einträge bzw. die Eingabefelder und Knöpfe (weitere Einträge scrollen);
            // mittig über dem Browserfenster wie der Passkey-Dialog
            const width = 480;
            const height = matchedEntries.length === 0 ? 460 : 250 + 66 * Math.min(matchedEntries.length, 3);
            const createData = {
                type: "popup",
                url: "/dist/dialogs/NetworkAuth.html",
                width,
                height
            } as chrome.windows.CreateData;
            try {
                const tab = await chrome.tabs.get(requestDetails.tabId);
                const parent = await chrome.windows.get(tab.windowId);
                createData.left = Math.round(parent.left + (parent.width - width) / 2);
                createData.top = Math.round(parent.top + (parent.height - height) / 2);
            } catch (e) {
                // kein Tab: Browser wählt die Position
            }
            try {
                wind = await chrome.windows.create(createData);
                chrome.windows.onRemoved.addListener(declineHandling);
            } catch (e) {
                done = true;
                chrome.runtime.onMessage.removeListener(handleMessage);
                reject(e);
            }
        });
    }
}

interface PendingSave {
    tabId: number;
    url: URL;
    realm: string;
    username: string;
    password: string;
}

// Eingaben mit Haken "In KeePass speichern", bis die Anfrage abgeschlossen ist (Schlüssel: requestId)
const pendingSaves = new Map<string, PendingSave>();

// Anfrage abgeschlossen: Hat der Server die Anmeldung angenommen, Speichern-Popup öffnen. Abgelehnt (erneute
// Anfrage mit neuer Eingabe überschreibt den Eintrag; endgültig 401/403/407) oder Fehler: nichts speichern
export function onNetworkRequestCompleted(details: { requestId: string; statusCode?: number }) {
    const p = pendingSaves.get(details.requestId);
    if (!p) return;
    pendingSaves.delete(details.requestId);
    if ([401, 403, 407].includes(details.statusCode)) return;
    openNetworkLoginSave(p).catch(e => FerryLog.warn("Could not open the popup for saving: " + e));
}

export function onNetworkRequestFailed(details: { requestId: string }) {
    pendingSaves.delete(details.requestId);
}

// Eingabe wie ein abgeschicktes Formular merken und das Popup direkt im Speichern-Dialog öffnen (Titel, Gruppe usw.).
// Adresse = Ursprung der Seite, Bereich für die Trefferliste, Titel = Bereich (sonst Server)
async function openNetworkLoginSave({ tabId, url, realm, username, password }: PendingSave) {
    const submittedData: SubmittedData = {
        url: url.origin + "/",
        title: (realm ?? "").trim() || url.host,
        httpRealm: realm ?? "",
        fields: [
            new Field({ name: "KeePass username", type: "text", value: username, locators: [new Locator({ type: "text" })] }),
            new Field({ name: "KeePass password", type: "password", value: password, locators: [new Locator({ type: "password" })] })
        ]
    };
    const state = ferry.persistentTabStates.get(tabId) ?? { items: [] };
    state.items = (state.items ?? []).filter(item => item.itemType !== "submittedData");
    // Kein zusätzlicher Hinweis in der Seite: das Popup geht gleich auf
    state.items.push({ itemType: "submittedData", submittedData, creationDate: new Date(), noticeDismissed: true });
    ferry.persistentTabStates.set(tabId, state);
    ferry.configureBrowserActionIcon();
    ferry.foregroundTabId = tabId;
    try {
        const tab = await chrome.tabs.get(tabId);
        // Nach dem eigenen Fenster muss das Browserfenster vorne sein, sonst öffnet openPopup nichts
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.action.setPopup({ popup: "dist/popup/index.html?save=1" });
        await chrome.action.openPopup();
    } finally {
        await chrome.action.setPopup({ popup: "dist/popup/index.html" });
    }
}
