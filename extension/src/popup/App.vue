<template>
    <v-app>
        <div class="ferry-shell">
            <header v-show="showSearchPanel" class="ferry-top">
                <svg class="ferry-logo" viewBox="0 0 128 128" width="30" height="30" aria-hidden="true">
                <rect x="4" y="4" width="120" height="120" rx="28" fill="#15497f" />
                <circle cx="42" cy="47" r="15" fill="none" stroke="#fff" stroke-width="9" />
                <path d="M57 47 H100 M88 47 V60 M99 47 V57" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M18 72 H110 L97 94 Q95 97 91 97 H37 Q33 97 31 94 Z" fill="#22c55e" />
                <path d="M20 108 q 8.8 -7 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0" fill="none" stroke="#7dd3fc" stroke-width="6" stroke-linecap="round" />
            </svg>
                <SearchInput />
            </header>

            <main class="ferry-body">
                <div v-show="showSaveRecovery" class="ferry-note warn">
                    <tabler-alert-triangle class="ferry-ico" />
                    <span class="ferry-note-text">{{ $i18n("unsaved_changes") }}</span>
                    <v-btn size="small" variant="text" color="primary" @click="saveRecover">{{ $i18n("continue_saving") }}</v-btn>
                    <button type="button" class="ferry-ib" :aria-label="$i18n('discard_changes')" @click="saveDiscard">
                        <tabler-x class="ferry-ico" />
                        <v-tooltip location="start" activator="parent">{{ $i18n("discard_changes") }}</v-tooltip>
                    </button>
                </div>
                <div v-if="otpPending && databaseIsOpen && !showSaveStart" class="ferry-note">
                    <tabler-shield-lock class="ferry-ico" />
                    <span class="ferry-note-text">{{ $i18n("ferry_otp_pending", [otpPending.issuer]) }}</span>
                    <v-btn size="small" variant="text" color="primary" @click="openOtpSetup">{{ $i18n("ferry_otp_pending_open") }}</v-btn>
                    <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_otp_pending_discard')" @click="discardOtpSetup">
                        <tabler-x class="ferry-ico" />
                        <v-tooltip location="start" activator="parent">{{ $i18n("ferry_otp_pending_discard") }}</v-tooltip>
                    </button>
                </div>
                <div v-show="showSaveResult" class="ferry-note success">
                    <tabler-circle-check class="ferry-ico" />
                    <span class="ferry-note-text">{{ $i18n("you_recently_saved") }}</span>
                    <button type="button" class="ferry-ib" :aria-label="$i18n('open_full_editor')" @click="openFullEntryEditor">
                        <tabler-external-link class="ferry-ico" />
                        <v-tooltip location="start" activator="parent">{{ $i18n("open_full_editor") }}</v-tooltip>
                    </button>
                    <button type="button" class="ferry-ib" :aria-label="$i18n('close')" @click="lastSaveEntryResult = null">
                        <tabler-x class="ferry-ico" />
                        <v-tooltip location="bottom" activator="parent">{{ $i18n("close") }}</v-tooltip>
                    </button>
                </div>

                <div v-if="showEmptyState" class="ferry-empty">
                    <svg :class="connected ? '' : 'ferry-empty-off'" viewBox="0 0 128 128" width="64" height="64" aria-hidden="true">
                <rect x="4" y="4" width="120" height="120" rx="28" fill="#15497f" />
                <circle cx="42" cy="47" r="15" fill="none" stroke="#fff" stroke-width="9" />
                <path d="M57 47 H100 M88 47 V60 M99 47 V57" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M18 72 H110 L97 94 Q95 97 91 97 H37 Q33 97 31 94 Z" fill="#22c55e" />
                <path d="M20 108 q 8.8 -7 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0" fill="none" stroke="#7dd3fc" stroke-width="6" stroke-linecap="round" />
            </svg>
                    <div class="ferry-empty-title">
                        {{ connected ? $i18n("ferry_status_locked") : $i18n("ferry_status_not_running") }}
                    </div>
                    <div class="ferry-empty-text">
                        {{ connected ? $i18n("ferry_popup_locked_hint") : $i18n("ferry_status_not_running_hint") }}
                    </div>
                    <v-btn v-if="connected" color="primary" variant="flat" class="mt-5" @click="requestUnlock">
                        <tabler-lock-open class="ferry-ico mr-2" />
                        {{ $i18n("ferry_popup_unlock") }}
                    </v-btn>
                </div>
                <div v-if="showNotifications" id="notifications">
                    <Notification v-for="n of notifications" :key="n.id" :notification="n" />
                </div>
                <SearchResults v-show="showSearchPanel" :matched-entries-in="cachedMatchedEntries" :site-entries-in="siteEntries" :frame-id="frameId"
                    @pref-entry-toggle="prefEntryToggle" />
                <Save1stParty v-if="showSaveStart && !showSaveWhere" @save-where-clicked="saveWhere"
                    @cancel-clicked="saveDiscard" />
                <SaveWhere v-if="showSaveWhere" :display-reason="displayWhereReason"
                    :preferred-group-uuid="preferredGroupUuid" @back="showSaveWhere = false" />
            </main>

            <footer v-show="!showSaveStart && !showSaveWhere" class="ferry-foot">
                <div class="ferry-status" :class="statusTone">
                    <span class="ferry-dot" />
                    <span class="ferry-status-text">{{ footerStatus }}</span>
                    <v-tooltip location="top" activator="parent">
                        <span>{{ connectionStatusDetail }}</span>
                    </v-tooltip>
                </div>
                <v-spacer />
                <button v-show="showSearchPanel && !showSaveRecovery" type="button" class="ferry-ib" :class="hasSubmittedData ? 'pulse-button' : ''"
                    :aria-label="$i18n('create_new_entry')" @click="saveStart">
                    <tabler-plus class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("create_new_entry") }}</v-tooltip>
                </button>
                <button v-show="showSearchPanel" type="button" class="ferry-ib"
                    :aria-label="$i18n('Menu_Button_copyNewPasswordToClipboard_label')" @click="showPasswordGenerator = true">
                    <tabler-wand class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("Menu_Button_copyNewPasswordToClipboard_label") }}</v-tooltip>
                </button>
                <button v-show="showOpenKeePassButton" id="password-open-keepass" type="button" class="ferry-ib"
                    :aria-label="$i18n('Menu_Button_open_keepass_label')" @click="openKeePass">
                    <tabler-app-window class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("Menu_Button_open_keepass_label") }}</v-tooltip>
                </button>
                <button type="button" class="ferry-ib" :aria-label="$i18n('Menu_Button_options_label')" @click="showOptions">
                    <tabler-settings class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("Menu_Button_options_label") }}</v-tooltip>
                </button>
            </footer>
        </div>
        <PasswordGenerator v-if="showPasswordGenerator" :standalone="true" @dialog-closed="passwordGeneratorClosed"
            @copy-to-clipboard="copyToClipboard" />
    </v-app>
</template>

<script lang="ts">
import Notification from "./components/Notification.vue";
import SearchInput from "./components/SearchInput.vue";
import SearchResults from "./components/SearchResults.vue";
import Save1stParty from "./components/Save1stParty.vue";
import SaveWhere from "./components/SaveWhere.vue";
import PasswordGenerator from "../common/components/PasswordGenerator.vue";
import { Port } from "../common/port";
import { Action } from "../common/Action";
import { KeeLog } from "../common/Logger";
import { SaveState } from "../common/SaveState";
import { Entry } from "../common/model/Entry";
import { supplementEntryState } from "./supplementEntryState";
import { fetchFavicon, getFaviconUrl } from "./favicon";
import { autoRecoveryTimeMs, manualRecoveryPromptTimeMs, tooltipDelay } from "../common/Timings";
import { SaveEntryResult } from "../common/SaveEntryResult";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";
import { copyStringToClipboard } from "../common/copyStringToClipboard";
import { configManager } from "../common/ConfigManager";
import { AddonMessage } from "../common/AddonMessage";
import useStore from "../store";
import { mapState } from "pinia";
import punycode from "punycode/";

export default {
    components: {
        Notification: Notification,
        SearchResults: SearchResults,
        SearchInput: SearchInput,
        Save1stParty: Save1stParty,
        SaveWhere: SaveWhere,
        PasswordGenerator: PasswordGenerator
    },
    props: ["matchedEntries", "siteEntries", "frameId"],
    setup() {
        const { updateSaveState, updateSaveEntryResult } = useStore();
        return { updateSaveState, updateSaveEntryResult };
    },
    data: function () {
        return {
            // We can't use the Vuex property directly because when it changes it causes
            // the app to re-render from scratch, destroying the user input that triggered
            // the datestamp change. Instead we can watch for changes and only modify this
            // value in a set of circumstances that meet our requirements.
            // Also note that Chromium and Firefox extensions behave differently - Chrome
            // persists strings to represent the Date whereas Firefox persists a valid
            // Date object. Hence every place where this is used, you must wrap the
            // variable in a new Date(...) call before comparing against other Dates
            saveLastActiveAt: null,
            showSaveWhere: false,
            displayWhereReason: null,
            preferredGroupUuid: "",

            cachedMatchedEntries: this.matchedEntries,

            // imported constants are only available in Vue if we assign them to data
            tooltipDelay: tooltipDelay,
            manualRecoveryPromptTimeMs: manualRecoveryPromptTimeMs,
            autoRecoveryTimeMs: autoRecoveryTimeMs,
            showPasswordGenerator: false,
            lastSaveEntryResult: null,
            // Noch nicht gespeicherter Zwei-Faktor-Schlüssel der aktuellen Seite
            otpPending: null as { issuer: string }
        };
    },
    computed: {
        ...mapState(useStore, [
            "showGeneratePasswordLink",
            "saveState",
            "showMatchedLogins",
            "showOpenKeePassButton",
            "connectionStatus",
            "connectionStatusDetail",
            "connected",
            "databaseIsOpen",
            "notifications",
            "showNotifications",
            "connectedWebsocket",
            "saveEntryResult"
        ]),
        statusTone: function () {
            if (this.connected && this.databaseIsOpen) return "ok";
            if (this.connected) return "warn";
            return "off";
        },
        showSaveStart: function () {
            return new Date(this.saveLastActiveAt) > new Date(Date.now() - this.autoRecoveryTimeMs);
        },
        showSaveRecovery: function () {
            KeeLog.debug(`showSaveRecovery ${this.showSaveStart} : ${new Date(this.saveLastActiveAt)} ${new Date(Date.now() - this.manualRecoveryPromptTimeMs
            )} : ${new Date(this.saveLastActiveAt) > new Date(Date.now() - this.manualRecoveryPromptTimeMs)}`);
            return (
                !this.showSaveStart &&
                new Date(this.saveLastActiveAt) >
                new Date(Date.now() - this.manualRecoveryPromptTimeMs)
            );
        },
        footerStatus: function () {
            if (this.connected && this.databaseIsOpen) return this.connectionStatus;
            if (this.connected) return this.$i18n("ferry_footer_locked");
            return this.$i18n("ferry_footer_offline");
        },
        showEmptyState: function () {
            return !this.databaseIsOpen && !this.showSaveStart && !this.showSaveRecovery && !this.showNotifications;
        },
        showSearchPanel: function () {
            return this.databaseIsOpen && !this.showSaveStart;
        },
        hasSubmittedData: function () {
            return (this.saveState as SaveState)?.submittedData?.fields?.length > 0;
        },
        showSaveResult: function () {
            return this.lastSaveEntryResult && !this.showSaveStart;
        }
    },
    watch: {
        saveState: {
            handler: function (newState: SaveState, oldState: SaveState) {
                //TODO:f: For some reason the old and new state are always identical.
                // So we now always update the last active date but this may have
                // some side-effect we're yet to find. Perhaps the watch only
                // gets called as a response to a reflected message from the
                // background so it has already been changed locally.
                if (newState?.newEntry?.uuid !== oldState?.newEntry?.uuid) {
                    KeeLog.debug("savestate watch modified");
                } else {
                    KeeLog.debug("savestate watch not modified");
                }
                this.saveLastActiveAt = newState.lastActiveAt;
            },
            deep: true
        }
    },
    mounted: async function () {
        this.saveLastActiveAt = this.saveState?.lastActiveAt;

        const discardRequired = this.handleLastSaveResult();

        // Clear the newEntry if it is beyond our maximum recovery time
        // This frees up memory but more importantly allows the watch for saveState to
        // set the appropriate last active datetime when the user attempts to re-edit
        // the same entry as most recently.
        if (
            discardRequired ||
            this.saveState?.lastActiveAt <=
            new Date(Date.now() - this.manualRecoveryPromptTimeMs)
        ) {
            KeeLog.debug("discarding upon mount");
            this.saveDiscard();
        }

        // Wurde die Schlüssel-Auswahl ohne Speichern geschlossen, hier erneut anbieten
        chrome.runtime.sendMessage({ keepassferry: "getOtpSetupSummary" })
            .then(s => (this.otpPending = s ?? null))
            .catch(() => undefined);

        // Aus dem Speichern-Hinweis der Seite geöffnet: gleich den Speichern-Dialog zeigen
        if (new URLSearchParams(window.location.search).get("save") === "1") {
            // Die übermittelten Daten können kurz nach dem Start eintreffen
            for (let i = 0; i < 20 && !this.hasSubmittedData; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.hasSubmittedData && !this.showSaveStart) {
                await this.saveStart();
            }
        }

        const favIconUrl = await getFaviconUrl();
        if (!favIconUrl) return;
        const favicon = await fetchFavicon(favIconUrl);
        if (!favicon) return;

        const updatedSaveState = Object.assign({}, JSON.parse(JSON.stringify(this.saveState)));
        updatedSaveState.favicon = favicon;
        this.updateSaveState(updatedSaveState);
    },
    methods: {
        // Dieselbe Ansicht wie aus dem Seitenhinweis (popup/main.ts rendert bei ?otp=1 die Auswahl)
        openOtpSetup: function () {
            window.location.search = "?otp=1";
        },
        discardOtpSetup: function () {
            this.otpPending = null;
            chrome.runtime.sendMessage({ keepassferry: "discardOtpSetup" }).catch(() => undefined);
        },
        showOptions: () => {
            chrome.runtime.openOptionsPage();
            window.close();
        },
        saveStart: async function () {
            const currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
            if (!currentTab) return;
            const entryTemplate = {
                URLs: [currentTab.url],
                title: currentTab.title,
                fields: [
                    new Field({
                        name: "KeePass username",
                        type: "text",
                        locators: [
                            new Locator({
                                type: "text"
                            })
                        ]
                    }),
                    new Field({
                        name: "KeePass password",
                        type: "password",
                        locators: [
                            new Locator({
                                type: "password"
                            })
                        ]
                    })
                ]
            };
            const ss = JSON.parse(JSON.stringify(this.saveState as SaveState));
            const updatedSaveState = Object.assign({}, ss);
            updatedSaveState.newEntry = supplementEntryState(new Entry(entryTemplate), ss);
            updatedSaveState.titleResetValue = updatedSaveState.newEntry.title;
            updatedSaveState.lastActiveAt = new Date();
            updatedSaveState.showURLMismatchWarning = false;
            KeeLog.debug("updating saveState");
            this.updateSaveState(updatedSaveState);
            //this.saveLastActiveAt = updatedSaveState.lastActiveAt;
        },
        saveRecover: function () {
            const ss = JSON.parse(JSON.stringify(this.saveState as SaveState));
            const updatedSaveState = Object.assign({}, ss);
            updatedSaveState.lastActiveAt = new Date();
            this.updateSaveState(updatedSaveState);

            // Normally we ignore active datetime changes but user has explicitly requested this
            this.saveLastActiveAt = updatedSaveState.lastActiveAt;
        },
        saveDiscard: function () {
            const ss = JSON.parse(JSON.stringify(this.saveState as SaveState));
            const updatedSaveState = Object.assign({}, ss);
            updatedSaveState.newEntry = new Entry({});
            updatedSaveState.titleResetValue = null;
            updatedSaveState.lastActiveAt = null;
            updatedSaveState.showURLMismatchWarning = false;
            updatedSaveState.favicon = null;
            this.updateSaveState(updatedSaveState);
            //this.saveLastActiveAt = updatedSaveState.lastActiveAt;
        },
        saveWhere: function (displayWhereReason: string, preferredGroupUuid: string) {
            this.displayWhereReason = displayWhereReason;
            this.preferredGroupUuid = preferredGroupUuid;
            this.showSaveWhere = true;
        },
        requestUnlock: async function () {
            try {
                await chrome.runtime.sendMessage({ keepassferry: "requestUnlock" });
            } catch (e) {
                KeeLog.warn("Unlock request failed: " + e);
            }
            window.close();
        },
        openKeePass: function () {
            KeeLog.debug("open KeePass requested");
            if (this.connectedWebsocket) {
                Port.postMessage({ action: Action.OpenKeePass });
            } else {
                KeeLog.info("KeePass no longer connected so taking no action");
            }
            window.close();
        },
        handleLastSaveResult: function () {
            const lastResult = this.saveEntryResult as SaveEntryResult;

            if (!lastResult?.result) return false;

            if (lastResult.result === "created" || lastResult.result === "updated") {
                if (!configManager.current.hideConfirmationAfterSave) {
                    this.lastSaveEntryResult = lastResult;
                }
                this.updateSaveEntryResult({
                    result: null,
                    receivedAt: new Date()
                } as SaveEntryResult);
                return true;
            } else {
                this.updateSaveEntryResult({
                    result: null,
                    receivedAt: new Date()
                } as SaveEntryResult);
                return false;
            }
        },
        passwordGeneratorClosed: function () {
            this.showPasswordGenerator = false;
        },
        copyToClipboard: async function (payload) {
            if (payload?.value) await copyStringToClipboard(payload.value);
        },
        prefEntryToggle: async function (payload: any) {
            if (payload?.uuid) {
                const currentTab = (
                    await chrome.tabs.query({
                        active: true,
                        currentWindow: true
                    })
                )[0];
                if (!currentTab) return;
                const url = new URL(currentTab.url);
                url.hostname = punycode.toUnicode(url.hostname);
                configManager.togglePreferredEntryUuid(payload.uuid, url.href);
                const conf = configManager.siteConfigFor(url.href);
                this.cachedMatchedEntries = this.cachedMatchedEntries.map(me => {
                    me.isPreferredMatch = conf.preferredEntryUuid === me.uuid ? true : false;
                    return me;
                });
                Port.postMessage({ action: Action.DetectForms } as AddonMessage);
                // hacky, but changing the cachedMatchedEntries value does not appear to trigger
                // any reactive behaviour a couple of components down at the actual checkbox
                // so closing the window avoids user seeing out of date information.
                window.close();
            }
        },
        openFullEntryEditor: function () {
            Port.postMessage({
                loginEditor: {
                    uuid: this.lastSaveEntryResult.uuid,
                    DBfilename: this.lastSaveEntryResult.fileName
                }
            } as AddonMessage);
            this.lastSaveEntryResult = null;
            window.close();
        }
    }
};
</script>

<style>
.text-truncate{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}

/* Popup-Rahmen: Kopf, scrollender Inhalt, Fuß; feste Höhe 600 px */
.ferry-shell {
    display: flex;
    flex-direction: column;
    height: 600px;
    background: rgb(var(--v-theme-surface));
}
.ferry-top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--ferry-line);
}
.ferry-logo {
    flex: none;
    border-radius: 8px;
}
.ferry-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    position: relative;
}
.ferry-foot {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 8px 12px;
    border-top: 1px solid var(--ferry-line);
}
.ferry-status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 210px;
    padding: 4px 10px 4px 8px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    background: var(--ferry-hover);
}
.ferry-status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ferry-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: #94a3b8;
}
.ferry-status.ok { background: rgba(var(--v-theme-success), 0.1); }
.ferry-status.ok .ferry-dot { background: rgb(var(--v-theme-success)); }
.ferry-status.warn { background: rgba(var(--v-theme-warning), 0.12); }
.ferry-status.warn .ferry-dot { background: rgb(var(--v-theme-warning)); }

.ferry-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 96px 28px 0;
}
.ferry-empty svg {
    border-radius: 16px;
    margin-bottom: 20px;
}
.ferry-empty svg.ferry-empty-off {
    filter: grayscale(1);
    opacity: 0.5;
}
.ferry-empty-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 6px;
}
.ferry-empty-text {
    font-size: 13px;
    color: var(--ferry-muted);
    max-width: 290px;
}

.pulse-button {
    animation: pulse 0.5s 2 cubic-bezier(0.45, 0.05, 0.55, 0.95) 0.25s reverse;
}
@keyframes pulse {
    0% { transform: scale(1); }
    25% { transform: scale(1.25); }
    50% { transform: scale(1); }
    75% { transform: scale(0.85); }
    100% { transform: scale(1); }
}
</style>
