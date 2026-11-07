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
                <!-- Neu in Datenlecks gefundene Passwörter (Prüfung im Plugin), bis "Verstanden" bzw. "Anzeigen" -->
                <div v-if="newLeaks.length && !otpPending && !showSaveRecovery && !showSaveStart" class="ferry-note danger ferry-leaks-note">
                    <tabler-alert-triangle class="ferry-ico" />
                    <div class="ferry-note-text">
                        <p class="ferry-leaks-title">{{ newLeaks.length === 1 ? $i18n("ferry_leaks_new_one") : $i18n("ferry_leaks_new", [String(newLeaks.length)]) }}</p>
                        <p class="ferry-leaks-names">{{ newLeakNames }}</p>
                        <div class="ferry-leaks-actions">
                            <v-btn size="small" variant="text" @click="acknowledgeLeaks">{{ $i18n("ferry_leaks_ok") }}</v-btn>
                            <v-btn size="small" variant="outlined" color="error" rounded="lg" @click="openLeaks">{{ $i18n("ferry_leaks_show") }}</v-btn>
                        </div>
                    </div>
                </div>
                <!-- Nach einem Update einmal: Neuigkeiten dieser Version (Einstellungen > Neuigkeiten und Tipps) -->
                <div
v-if="news && !newLeaks.length && !otpPending && !showSaveRecovery" class="ferry-note ferry-news-note" role="button" tabindex="0"
                    @click="openNews" @keyup.enter="openNews">
                    <tabler-sparkles class="ferry-ico" />
                    <span class="ferry-note-text">{{ $i18n("ferry_news_popup", [news.version, String(news.items.length)]) }}</span>
                    <tabler-chevron-right class="ferry-ico ferry-news-chevron" />
                    <button type="button" class="ferry-ib" :aria-label="$i18n('close')" @click.stop="dismissNews">
                        <tabler-x class="ferry-ico" />
                        <v-tooltip location="start" activator="parent">{{ $i18n("close") }}</v-tooltip>
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
                <SearchResults
                    v-show="showSearchPanel"
:matched-entries-in="cachedMatchedEntries" :site-entries-in="siteEntries" :frame-id="frameId"
                    @pref-entry-toggle="prefEntryToggle" />
                <Save1stParty
v-if="showSaveStart && !showSaveWhere" @save-where-clicked="saveWhere"
                    @cancel-clicked="saveCanceled" @saved-additions-only="saveDiscard" />
                <SaveWhere
v-if="showSaveWhere" :display-reason="displayWhereReason"
                    :preferred-group-uuid="preferredGroupUuid" @back="showSaveWhere = false" />
            </main>

            <footer v-show="!showSaveStart && !showSaveWhere" class="ferry-foot">
                <button type="button" class="ferry-status" :class="statusTone" :disabled="!hasStatusMenu">
                    <span class="ferry-dot" />
                    <span class="ferry-status-text">{{ footerStatus }}</span>
                    <tabler-chevron-up v-if="hasStatusMenu" class="ferry-ico ferry-status-chevron" />
                    <!-- Geöffnete Datenbanken: welche aktiv ist, welche nur gelesen werden kann; KeePass öffnen -->
                    <v-menu v-if="hasStatusMenu" activator="parent" location="top start" :offset="6">
                        <div class="ferry-db-menu">
                            <div v-if="openDatabases.length" class="ferry-db-menu-title">{{ $i18n("ferry_db_menu_title") }}</div>
                            <div v-for="db of openDatabases" :key="db.fileName" class="ferry-db-row">
                                <tabler-database class="ferry-ico" />
                                <span class="ferry-db-name">{{ db.label }}</span>
                                <span v-if="db.active" class="ferry-db-tag ok">{{ $i18n("ferry_db_active") }}</span>
                                <span v-if="db.readOnly" class="ferry-db-tag">
                                    <tabler-lock class="ferry-ico" />{{ $i18n("ferry_db_read_only") }}
                                </span>
                                <v-tooltip location="top" activator="parent">{{ db.fileName }}</v-tooltip>
                            </div>
                            <button
                                v-if="showOpenKeePassButton" id="password-open-keepass" type="button" class="ferry-db-row ferry-db-action"
                                @click="openKeePass">
                                <tabler-app-window class="ferry-ico" />
                                <span class="ferry-db-name">{{ $i18n("Menu_Button_open_keepass_label") }}</span>
                            </button>
                        </div>
                    </v-menu>
                </button>
                <v-spacer />
                <button
v-show="showSearchPanel && !showSaveRecovery" type="button" class="ferry-ib" :class="hasSubmittedData ? 'pulse-button' : ''"
                    :aria-label="$i18n('create_new_entry')" @click="saveStart">
                    <tabler-plus class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("create_new_entry") }}</v-tooltip>
                </button>
                <button
v-show="showSearchPanel" type="button" class="ferry-ib"
                    :aria-label="$i18n('Menu_Button_copyNewPasswordToClipboard_label')" @click="showPasswordGenerator = true">
                    <tabler-wand class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("Menu_Button_copyNewPasswordToClipboard_label") }}</v-tooltip>
                </button>
                <!-- Geleakte Passwörter jederzeit erreichbar (die Karte "neu gefunden" erscheint nur einmal) -->
                <button
v-if="allLeakCount > 0" type="button" class="ferry-ib ferry-leaks-btn"
                    :aria-label="$i18n('ferry_leaks_footer', [String(allLeakCount)])" @click="openAllLeaks">
                    <tabler-alert-triangle class="ferry-ico" />
                    <span class="ferry-leaks-badge">{{ allLeakCount > 99 ? "99+" : allLeakCount }}</span>
                    <v-tooltip location="top" activator="parent">{{ $i18n("ferry_leaks_footer", [String(allLeakCount)]) }}</v-tooltip>
                </button>
                <!-- Pulsiert nur, solange es Tipps gibt, die der Nutzer noch nicht ausgeblendet hat -->
                <button type="button" class="ferry-ib ferry-news-btn" :class="{ 'has-news': openTips > 0 }" :aria-label="$i18n('ferry_news_heading')" @click="openNews">
                    <tabler-sparkles class="ferry-ico" />
                    <span v-if="openTips > 0" class="ferry-news-dot" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("ferry_news_heading") }}</v-tooltip>
                </button>
                <!-- Nur mit Diagnoseprotokoll: Aufbau der Seite ins Protokoll (für Fehlerberichte zu einzelnen Seiten) -->
                <button
                    v-if="diagnosticsOn && databaseIsOpen" type="button" class="ferry-ib"
                    :aria-label="$i18n('ferry_capture_page')" @click="capturePage">
                    <tabler-check v-if="pageCaptured" class="ferry-ico" />
                    <tabler-bug v-else class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">
                        {{ pageCaptured ? $i18n("ferry_capture_page_done") : $i18n("ferry_capture_page") }}
                    </v-tooltip>
                </button>
                <button type="button" class="ferry-ib" :aria-label="$i18n('Menu_Button_options_label')" @click="showOptions">
                    <tabler-settings class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("Menu_Button_options_label") }}</v-tooltip>
                </button>
            </footer>
        </div>
        <NewsView v-if="showNews" @close="showNews = false; refreshOpenTips()" @tips-changed="refreshOpenTips" />
        <LeaksView
v-if="leaksShown" :leaks="leaksShown" :start-with-all="leaksShowAll" :restore-scroll="leaksScroll"
            @close="leaksShown = null; leaksScroll = $event ?? 0" />
        <PasswordGenerator
v-if="showPasswordGenerator" :standalone="true" @dialog-closed="passwordGeneratorClosed"
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
import NewsView from "./components/NewsView.vue";
import LeaksView, { Leak } from "./components/LeaksView.vue";

// Zeitpunkt, bis zu dem neu gefundene Lecks gesehen sind (Karte "… in Datenlecks gefunden")
const LEAKS_SEEN_KEY = "ferryHibpLeaksSeenAt";
import { Port } from "../common/port";
import { Action } from "../common/Action";
import { FerryLog } from "../common/Logger";
import { SaveState } from "../common/SaveState";
import { Entry } from "../common/model/Entry";
import { supplementEntryState, supplementExistingEntry } from "./supplementEntryState";
import { reconcileURLs } from "./reconcileURLs";
import { databaseLabel } from "../common/databaseLabel";
import type { Database } from "../common/model/Database";
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
import { markNewsSeen, unseenNews } from "../common/whatsNew";
import { openTipCount } from "./tips";

export default {
    components: {
        Notification: Notification,
        SearchResults: SearchResults,
        SearchInput: SearchInput,
        Save1stParty: Save1stParty,
        SaveWhere: SaveWhere,
        PasswordGenerator: PasswordGenerator, NewsView, LeaksView },
    props: ["matchedEntries", "siteEntries", "frameId"],
    setup() {
        const { updateSaveState, updateSaveEntryResult } = useStore();
        return { updateSaveState, updateSaveEntryResult };
    },
    data: function () {
        return {
            // Knopf "Seite für Diagnose erfassen" nur bei eingeschaltetem Diagnoseprotokoll
            diagnosticsOn: !!configManager.current?.ferryDiagnostics,
            pageCaptured: false,
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
            showNews: false,
            // Noch nicht gespeicherter Zwei-Faktor-Schlüssel der aktuellen Seite
            otpPending: null as { issuer: string },
            news: null as { version: string; items: unknown[] },
            // Seit dem letzten "Verstanden" neu gefundene Lecks; geöffnete Liste
            newLeaks: [] as Leak[],
            leaksShown: null as Leak[],
            leaksShowAll: false,
            // Alle in KeePass als geleakt bekannten Einträge (Symbol in der Fußleiste)
            allLeakCount: 0,
            // Noch nicht ausgeblendete Tipps (✨ in der Fußleiste pulsiert)
            openTips: 0,
            // Bearbeiten-Fenster wurde aus der Leak-Liste geöffnet: Abbrechen führt dorthin zurück, an dieselbe Stelle
            leaksScroll: 0
        };
    },
    computed: {
        // Bis zu drei Titel, bei mehr "…"
        newLeakNames: function () {
            const titles = (this.newLeaks as Leak[]).map(l => l.title).filter(Boolean);
            return titles.slice(0, 3).join(", ") + (titles.length > 3 ? " …" : "");
        },
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
            "connectedNative",
            "saveEntryResult",
            "KeePassDatabases",
            "ActiveKeePassDatabaseIndex"
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
            FerryLog.debug(`showSaveRecovery ${this.showSaveStart} : ${new Date(this.saveLastActiveAt)} ${new Date(Date.now() - this.manualRecoveryPromptTimeMs
            )} : ${new Date(this.saveLastActiveAt) > new Date(Date.now() - this.manualRecoveryPromptTimeMs)}`);
            return (
                !this.showSaveStart &&
                new Date(this.saveLastActiveAt) >
                new Date(Date.now() - this.manualRecoveryPromptTimeMs)
            );
        },
        // Geöffnete Datenbanken für die Liste an der Statusanzeige
        hasStatusMenu: function (): boolean {
            return this.openDatabases.length > 0 || this.showOpenKeePassButton;
        },
        openDatabases: function () {
            if (!this.connected || !this.databaseIsOpen) return [];
            return (this.KeePassDatabases as Database[]).map((db, i) => ({
                fileName: db.fileName,
                label: databaseLabel(db),
                active: i === this.ActiveKeePassDatabaseIndex,
                readOnly: !!db.readOnly
            }));
        },
        footerStatus: function () {
            if (this.connected && this.databaseIsOpen) {
                const dbs = this.openDatabases;
                return dbs.length > 1 ? this.$i18n("ferry_footer_databases", [String(dbs.length)]) : dbs[0]?.label ?? this.connectionStatus;
            }
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
                    FerryLog.debug("savestate watch modified");
                } else {
                    FerryLog.debug("savestate watch not modified");
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
            FerryLog.debug("discarding upon mount");
            this.saveDiscard();
            // Sofort, nicht erst über die Überwachung von saveState: sonst gilt der verworfene Dialog unten noch als offen
            this.saveLastActiveAt = null;
        }

        unseenNews().then(n => (this.news = n));
        this.loadNewLeaks();
        this.refreshOpenTips();

        // Wurde die Schlüssel-Auswahl ohne Speichern geschlossen, hier erneut anbieten
        chrome.runtime.sendMessage({ keepassferry: "getOtpSetupSummary" })
            .then(s => (this.otpPending = s ?? null))
            .catch(() => undefined);

        // Aus dem Feld-Panel der Seite (Stift) geöffnet: gleich das Bearbeiten-Fenster dieses Eintrags
        if (new URLSearchParams(window.location.search).get("edit") === "1") {
            const p = await chrome.runtime.sendMessage({ keepassferry: "takePendingEdit" }).catch(() => null);
            if (p?.uuid) await this.openEntryEditor(p.uuid, p.dbFileName);
        }

        // Aus dem Speichern-Hinweis der Seite geöffnet: gleich den Speichern-Dialog zeigen
        if (new URLSearchParams(window.location.search).get("save") === "1") {
            // Die übermittelten Daten können kurz nach dem Start eintreffen
            for (let i = 0; i < 20 && !this.hasSubmittedData; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.hasSubmittedData && !this.showSaveStart) {
                // Passwort eines vorhandenen Eintrags geändert: diesen Eintrag öffnen statt einen neuen anzulegen
                const target = (this.saveState as SaveState).submittedData?.updateTarget;
                if (target) await this.updateStart(target);
                else await this.saveStart();
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
        loadNewLeaks: async function () {
            try {
                // Ohne gespeicherten Stand ab dem Anfang: nur Einträge mit Fundzeitpunkt (leer hieße "alle geleakten")
                const seen = (await chrome.storage.local.get(LEAKS_SEEN_KEY))?.[LEAKS_SEEN_KEY] || "0001-01-01T00:00:00Z";
                this.newLeaks = (await chrome.runtime.sendMessage({ keepassferry: "getHibpLeaks", since: seen })) ?? [];
            } catch (e) {
                this.newLeaks = [];
            }
            try {
                // Leer = alle geleakten Einträge, auch ältere ohne Fundzeitpunkt
                const all = (await chrome.runtime.sendMessage({ keepassferry: "getHibpLeaks", since: "" })) ?? [];
                this.allLeakCount = all.length;
            } catch (e) {
                this.allLeakCount = 0;
            }
        },
        refreshOpenTips: async function () {
            try {
                this.openTips = await openTipCount();
            } catch (e) {
                this.openTips = 0;
            }
        },
        openAllLeaks: function () {
            this.leaksShowAll = true;
            this.leaksShown = [];
        },
        // Aus der Leak-Liste: Bearbeiten-Fenster des Eintrags wie über den Stift (ohne abgeschickte Anmeldedaten)
        // Bearbeiten-Fenster für einen Eintrag (uuid, Datenbank); false, wenn er nicht gefunden wurde
        openEntryEditor: async function (uuid: string, dbFileName: string): Promise<boolean> {
            let raw: Entry = null;
            try {
                raw = await chrome.runtime.sendMessage({ keepassferry: "findEntryForEdit", uuid, dbFileName });
            } catch (e) {
                raw = null;
            }
            if (!raw) return false;
            const entry = new Entry(raw);
            const ss = this.saveState as SaveState;
            const updatedSaveState = Object.assign({}, ss);
            updatedSaveState.newEntry = supplementEntryState(entry, { ...ss, submittedData: null }, entry.URLs);
            updatedSaveState.showURLMismatchWarning = false;
            updatedSaveState.titleResetValue = entry.title;
            updatedSaveState.lastActiveAt = new Date();
            this.updateSaveState(updatedSaveState);
            return true;
        },
        saveCanceled: function () {
            this.saveDiscard();
        },
        // Gesehen bis zum neuesten Fund (nicht "jetzt": ein Fund aus dem laufenden Durchlauf soll nicht verloren gehen)
        acknowledgeLeaks: async function () {
            const latest = (this.newLeaks as Leak[]).map(l => l.leakedAt).filter(Boolean).sort().pop();
            this.newLeaks = [];
            if (latest) await chrome.storage.local.set({ [LEAKS_SEEN_KEY]: latest }).catch(() => undefined);
        },
        openLeaks: async function () {
            // Andere (kürzere) Liste als "alle": oben beginnen
            this.leaksScroll = 0;
            this.leaksShowAll = false;
            this.leaksShown = [...this.newLeaks];
            await this.acknowledgeLeaks();
        },
        capturePage: async function () {
            const ok = await chrome.runtime.sendMessage({ keepassferry: "capturePageAnalysis" }).catch(() => false);
            if (!ok) return;
            this.pageCaptured = true;
            setTimeout(() => (this.pageCaptured = false), 2500);
        },
        openNews: function () {
            this.news = null;
            this.showNews = true;
        },
        dismissNews: async function () {
            this.news = null;
            await markNewsSeen();
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
            FerryLog.debug("updating saveState");
            this.updateSaveState(updatedSaveState);
            //this.saveLastActiveAt = updatedSaveState.lastActiveAt;
        },
        // Hinweis "Passwort aktualisieren": den Eintrag wie mit dem Stift öffnen, neues Passwort vorbelegt (der alte Wert
        // bleibt über "Zurücksetzen" erreichbar; beim Speichern legt KeePass ihn in der Eintragshistorie ab). Der Titel
        // des Eintrags bleibt. Eintrag nicht mehr gefunden: wie bisher als neuen Eintrag speichern
        updateStart: async function (target: { uuid: string; dbFileName: string }) {
            let raw: any = null;
            try {
                raw = await chrome.runtime.sendMessage({
                    keepassferry: "findEntryForEdit",
                    uuid: target.uuid,
                    dbFileName: target.dbFileName
                });
            } catch (e) {
                FerryLog.debug("Entry for password update not found: " + e);
            }
            if (!raw) {
                await this.saveStart();
                return;
            }
            const entry = new Entry(raw);
            const ss = JSON.parse(JSON.stringify(this.saveState as SaveState)) as SaveState;
            const { urls, showWarning } = await reconcileURLs(entry.URLs, ss.submittedData.url);
            const updatedSaveState = Object.assign({}, ss);
            updatedSaveState.newEntry = supplementExistingEntry(entry, ss, urls);
            updatedSaveState.titleResetValue = entry.title;
            updatedSaveState.lastActiveAt = new Date();
            updatedSaveState.showURLMismatchWarning = showWarning;
            this.updateSaveState(updatedSaveState);
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
                FerryLog.warn("Unlock request failed: " + e);
            }
            window.close();
        },
        openKeePass: function () {
            FerryLog.debug("open KeePass requested");
            if (this.connectedNative) {
                Port.postMessage({ action: Action.OpenKeePass });
            } else {
                FerryLog.info("KeePass no longer connected so taking no action");
            }
            window.close();
        },
        handleLastSaveResult: function () {
            const lastResult = this.saveEntryResult as SaveEntryResult;

            if (!lastResult?.result) return false;

            // Die Bestätigung zeigt die Seite direkt nach dem Speichern (Hintergrund), hier nur den Stand zurücksetzen
            if (lastResult.result === "created" || lastResult.result === "updated") {
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
        }
    }
};
</script>

<style>
.ferry-news-note {
    cursor: pointer;
}
.ferry-leaks-note {
    align-items: flex-start;
}
.ferry-leaks-note p {
    margin: 0;
}
.ferry-leaks-title {
    font-weight: 600;
    color: rgb(var(--v-theme-error));
}
.ferry-leaks-names {
    font-size: 12px;
    color: var(--ferry-muted);
    overflow-wrap: anywhere;
}
.ferry-leaks-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 6px;
}
/* Fußleiste: rotes Warnsymbol mit Anzahl, öffnet die Liste aller geleakten Einträge */
.ferry-leaks-btn {
    position: relative;
    color: rgb(var(--v-theme-error));
}
.ferry-leaks-badge {
    position: absolute;
    top: 1px;
    right: 0;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: rgb(var(--v-theme-error));
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
    pointer-events: none;
}
.ferry-news-note:hover {
    background: rgba(var(--v-theme-primary), 0.11);
}
/* Fußleiste: ✨ fällt nur bei noch nicht ausgeblendeten Tipps auf (sanftes Pulsieren + Punkt), sonst ruhig */
.ferry-news-btn {
    position: relative;
}
.ferry-news-btn.has-news {
    color: rgb(var(--v-theme-primary));
}
.ferry-news-btn.has-news .ferry-ico {
    animation: ferry-news-pulse 1.8s ease-in-out infinite;
}
.ferry-news-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgb(var(--v-theme-primary));
    box-shadow: 0 0 0 2px rgb(var(--v-theme-surface));
    pointer-events: none;
}
@keyframes ferry-news-pulse {
    0%, 100% { transform: scale(1) rotate(0deg); }
    50% { transform: scale(1.18) rotate(-8deg); }
}
@media (prefers-reduced-motion: reduce) {
    .ferry-news-btn.has-news .ferry-ico {
        animation: none;
    }
}
.ferry-news-note .ferry-news-chevron {
    color: var(--ferry-muted);
}
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
button.ferry-status {
    border: none;
    color: inherit;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
}
button.ferry-status:disabled { cursor: default; }
.ferry-status-chevron { width: 14px; height: 14px; flex: none; opacity: 0.6; }
.ferry-db-menu {
    min-width: 220px;
    max-width: 320px;
    padding: 6px;
    border-radius: 10px;
    background: rgb(var(--v-theme-surface));
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    font-size: 13px;
}
.ferry-db-menu-title {
    padding: 4px 8px 6px;
    font-size: 11.5px;
    font-weight: 600;
    opacity: 0.65;
}
.ferry-db-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
}
.ferry-db-row:hover { background: var(--ferry-hover); }
.ferry-db-action {
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.ferry-db-action:not(:first-child) {
    margin-top: 4px;
    border-radius: 0 0 6px 6px;
    border-top: 1px solid rgba(128, 128, 128, 0.25);
}
.ferry-db-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ferry-db-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--ferry-hover);
}
.ferry-db-tag .ferry-ico { width: 12px; height: 12px; }
.ferry-db-tag.ok { background: rgba(var(--v-theme-success), 0.14); color: rgb(var(--v-theme-success)); }
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
