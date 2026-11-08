import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { Entry } from "../common/model/Entry";
import punycode from "punycode/";
import { ferry } from "./KF";

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

export class NetworkAuth {
    constructor() { }

    public provideCredentialsAsyncBlockingCallback(
        requestDetails: any,
        callback: (response: chrome.webRequest.BlockingResponse) => void
    ) {
        this.provideCredentialsAsync(requestDetails)
            .then(result => callback(result))
            .catch(reason => {
                FerryLog.error("AsyncBlockingCallback promise failed", reason);
                callback({ cancel: false });
            });
    }

    public async provideCredentialsAsync(
        requestDetails: any
    ): Promise<chrome.webRequest.BlockingResponse> {
        FerryLog.debug("Considering handling request ID: " + requestDetails.requestId);

        // Anmeldefenster können auch eingebettete Fremdinhalte auslösen: nur auf ausdrücklichen Wunsch bedienen
        if (!configManager.current.ferryNetworkAuth) return { cancel: false };
        if (!ferry.store.state.connected) return { cancel: false };
        if (ferry.store.state.ActiveKeePassDatabaseIndex < 0) {
            // Gesperrt: entsperren lassen, aber nur für die aufgerufene Seite selbst (wie Bitwarden:
            // Seitenaufruf oder Anfrage vom selben Server), nicht für eingebettete Inhalte fremder Server
            if (!isPageRequest(requestDetails)) return { cancel: false };
            if (!(await ferry.unlockAndWait(requestDetails.tabId, requestDetails.url))) return { cancel: false };
            if (ferry.store.state.ActiveKeePassDatabaseIndex < 0) return { cancel: false };
        }

        FerryLog.info("Finding credentials for request ID: " + requestDetails.requestId);
        const url = new URL(requestDetails.url);
        url.hostname = punycode.toUnicode(url.hostname);

        const result = await ferry.findLogins(
            url.href,
            requestDetails.realm,
            null,
            null,
            null,
            null
        );
        let matchedEntries: Entry[] = [];
        let isError = false;

        try {
            if (result) {
                matchedEntries = result.filter(
                    (entry: Entry) => Entry.getUsernameField(entry) && Entry.getPasswordField(entry)
                );
            } else {
                isError = true;
            }
        } catch (e) {
            isError = true;
        }

        if (isError || matchedEntries.length <= 0) {
            return { cancel: false };
        }

        if (
            matchedEntries.length === 1 &&
            configManager.current.autoSubmitNetworkAuthWithSingleMatch
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

        // eslint-disable-next-line no-async-promise-executor
        return new Promise<chrome.webRequest.BlockingResponse>(async (resolve, reject) => {
            function handleMessage(request, sender: chrome.runtime.MessageSender) {
                switch (request.action) {
                    case "NetworkAuth_ok": {
                        const entry = matchedEntries[request.selectedEntryIndex];
                        FerryLog.debug("Filling request ID: " + requestDetails.requestId);
                        resolve({
                            authCredentials: {
                                username: Entry.getUsernameField(entry).value,
                                password: Entry.getPasswordField(entry).value
                            }
                        });
                        chrome.runtime.onMessage.removeListener(handleMessage);
                        chrome.windows.onRemoved.removeListener(declineHandling);
                        break;
                    }
                    case "NetworkAuth_load": {
                        // Can't use sendResponse() because Mozilla chose to not implement it, contrary to the MDN docs
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: "NetworkAuth_matchedEntries",
                            entries: matchedEntries,
                            realm: requestDetails.realm,
                            url: url.href,
                            isProxy: requestDetails.isProxy
                        });
                        break;
                    }
                }
            }

            chrome.runtime.onMessage.addListener(handleMessage);

            let wind;

            function declineHandling(closingWindowId: number) {
                if (closingWindowId !== wind?.id) return;
                FerryLog.debug("Cancelling request ID: " + requestDetails.requestId);
                resolve({ cancel: false });
                chrome.runtime.onMessage.removeListener(handleMessage);
                chrome.windows.onRemoved.removeListener(declineHandling);
            }
            // Höhe für Kopf, bis zu drei Einträge und Knöpfe (weitere scrollen); mittig über dem Browserfenster wie der Passkey-Dialog
            const width = 480;
            const height = 250 + 66 * Math.min(matchedEntries.length, 3);
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
                // kein Tab (z. B. Proxy-Anmeldung): Browser wählt die Position
            }
            try {
                wind = await chrome.windows.create(createData);
                chrome.windows.onRemoved.addListener(declineHandling);
            } catch (e) {
                reject(e);
            }
        });
    }

}
