<template>
    <v-app>
        <v-main>
            <div v-if="done" class="otp-done">
                <tabler-circle-check class="ferry-ico done-icon"/>
                <div>
                    <div class="title">{{ $i18n("otpSetup_doneTitle") }}</div>
                    <div class="subtitle">{{ $i18n("otpSetup_done") }}</div>
                </div>
            </div>
            <div v-else class="otp-setup">
                <header class="head">
                    <img src="/assets/images/48.png" alt="" class="logo" />
                    <div>
                        <div class="title">{{ $i18n("otpSetup_heading") }}</div>
                        <div v-if="setup" class="subtitle">{{ subtitle }}</div>
                    </div>
                </header>

                <v-progress-linear v-if="loading" indeterminate color="primary" class="my-4" />

                <v-alert v-else-if="!setup" type="info" variant="tonal" density="comfortable" class="mt-3">
                    {{ $i18n("otpSetup_nothing") }}
                </v-alert>

                <template v-else>
                    <div class="question">{{ $i18n("otpSetup_choose") }}</div>

                    <v-text-field
                        v-model="query"
                        :placeholder="$i18n('otpSetup_search')"
                        variant="outlined"
                        density="comfortable"
                        rounded="lg"
                        hide-details
                        clearable
                        class="mb-3"
                    >
                        <template #prepend-inner><tabler-search class="ferry-ico" /></template>
                    </v-text-field>

                    <div class="list">
                        <button
                            v-for="c of shownEntries"
                            :key="c.dbFileName + c.uuid"
                            type="button"
                            class="item"
                            :class="{ selected: isSelected(c) }"
                            :aria-pressed="isSelected(c)"
                            @click="select(c)"
                        >
                            <span class="tile">
                                <img v-if="c.icon" :src="'data:image/png;base64,' + c.icon" alt="" />
                                <tabler-key v-else class="ferry-ico tile-fallback"/>
                            </span>
                            <span class="text">
                                <span class="item-title">{{ c.title || "—" }}</span>
                                <span class="item-user">{{ c.username }}</span>
                            </span>
                            <span v-if="c.uuid === setup.lastFilledUuid" class="badge">
                                <tabler-history class="ferry-ico" />
                                <v-tooltip activator="parent" location="top">{{ $i18n("otpSetup_lastUsed") }}</v-tooltip>
                            </span>
                            <span v-if="c.hasTotp" class="badge badge-otp">
                                <tabler-shield-lock class="ferry-ico" />
                                <v-tooltip activator="parent" location="top">{{ $i18n("otpSetup_hasOtp") }}</v-tooltip>
                            </span>
                            <span class="check">
                                <tabler-circle-check class="ferry-ico" v-if="isSelected(c)"/>
                            </span>
                        </button>
                        <div v-if="shownEntries.length === 0" class="empty">{{ $i18n("otpSetup_none") }}</div>
                    </div>

                    <v-alert v-if="selected?.hasTotp" type="warning" variant="tonal" density="compact" class="mt-3">
                        {{ $i18n("otpSetup_replaceWarning") }}
                    </v-alert>
                    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">
                        {{ $i18n("otpSetup_error") }}
                    </v-alert>

                    <div class="actions">
                        <v-btn variant="text" @click="close">{{ $i18n("otpSetup_cancel") }}</v-btn>
                        <v-btn
                            color="primary"
                            variant="flat"
                            rounded="lg"
                            :disabled="!selected"
                            :loading="saving"
                            @click="save"
                        >
                            {{ selected?.hasTotp ? $i18n("otpSetup_replace") : $i18n("otpSetup_save") }}
                        </v-btn>
                    </div>
                </template>
            </div>
        </v-main>
    </v-app>
</template>

<script lang="ts">
import { mapState } from "pinia";
import useStore from "../store";
import { SearcherAll } from "../common/SearcherAll";
import { configManager } from "../common/ConfigManager";

// Popup-Ansicht "Zwei-Faktor-Schlüssel speichern": Eintrag wählen (Vorschläge oder Suche) und speichern.
// Das Secret selbst sieht das Popup nie; Speichern läuft über den Hintergrund zum KeePass-Plugin.
interface Candidate {
    uuid: string;
    dbFileName: string;
    title: string;
    username: string;
    icon: string;
    hasTotp: boolean;
}

export default {
    data: () => ({
        loading: true,
        setup: null as {
            issuer: string;
            account: string;
            domain: string;
            candidates: Candidate[];
            lastFilledUuid: string;
        },
        query: "",
        selected: null as Candidate,
        saving: false,
        error: false,
        done: false
    }),
    computed: {
        ...mapState(useStore, ["KeePassDatabases", "ActiveKeePassDatabaseIndex"]),
        subtitle: function () {
            const parts = [this.setup.issuer || this.setup.domain, this.setup.account].filter(Boolean);
            return parts.join(" · ");
        },
        shownEntries: function (): Candidate[] {
            const q = (this.query ?? "").trim();
            if (!q) return this.setup?.candidates ?? [];
            const search = new SearcherAll(
                { KeePassDatabases: this.KeePassDatabases, ActiveKeePassDatabaseIndex: this.ActiveKeePassDatabaseIndex } as any,
                { version: 1, searchAllDatabases: configManager.current.searchAllOpenDBs, maximumResults: 20 }
            );
            const results = (search.execute(q, undefined, []) ?? []) as any[];
            return results.map(r => {
                const known = this.setup.candidates.find(c => c.uuid === r.uuid);
                return {
                    uuid: r.uuid,
                    dbFileName: r.dbFileName,
                    title: r.title,
                    username: r.usernameValue ?? "",
                    icon: r.icon?.iconImageData ?? known?.icon ?? "",
                    hasTotp: known?.hasTotp ?? false
                };
            });
        }
    },
    mounted: async function () {
        try {
            this.setup = await chrome.runtime.sendMessage({ keepassferry: "getOtpSetup" });
        } catch (e) {
            this.setup = null;
        }
        // Vorauswahl: eben verwendeter Eintrag, sonst Benutzername = Konto aus dem QR-Code, sonst der einzige Vorschlag
        const c = this.setup?.candidates ?? [];
        const account = (this.setup?.account ?? "").trim().toLowerCase();
        const byAccount = account ? c.find(x => (x.username ?? "").trim().toLowerCase() === account) : null;
        if (byAccount && this.setup) {
            this.setup.candidates = [byAccount, ...c.filter(x => x !== byAccount)];
        }
        this.selected = c.find(x => x.uuid === this.setup.lastFilledUuid) ?? byAccount ?? (c.length === 1 ? c[0] : null);
        this.loading = false;
    },
    methods: {
        isSelected: function (c: Candidate) {
            return this.selected?.uuid === c.uuid && this.selected?.dbFileName === c.dbFileName;
        },
        select: function (c: Candidate) {
            this.selected = c;
            this.error = false;
        },
        save: async function () {
            if (!this.selected) return;
            this.saving = true;
            this.error = false;
            try {
                const result = await chrome.runtime.sendMessage({
                    keepassferry: "applyOtpSetup",
                    uuid: this.selected.uuid,
                    dbFileName: this.selected.dbFileName,
                    overwrite: this.selected.hasTotp
                });
                if (result?.status === "ok") {
                    this.done = true;
                    // Kurze Bestätigung in kleinem Fenster statt der vollen Popup-Höhe
                    for (const p of ["height", "min-height", "max-height"]) document.body.style.setProperty(p, "auto");
                    document.body.classList.add("ferry-compact");
                    window.setTimeout(() => window.close(), 2000);
                } else if (result?.status === "exists") {
                    // Über die Suche gewählter Eintrag hat schon einen Code: Warnung zeigen, Knopf wird "Ersetzen"
                    this.selected = { ...this.selected, hasTotp: true };
                } else {
                    this.error = true;
                }
            } catch (e) {
                this.error = true;
            }
            this.saving = false;
        },
        close: function () {
            window.close();
        }
    }
};
</script>

<style scoped>
.otp-setup {
    width: 400px;
    height: 600px;
    display: flex;
    flex-direction: column;
    padding: 16px 16px 14px;
    font-family: "Segoe UI", system-ui, sans-serif;
}
.otp-done {
    width: 400px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    font-family: "Segoe UI", system-ui, sans-serif;
}
.done-icon {
    flex: none;
    font-size: 30px;
    color: rgb(var(--v-theme-success));
}
/* Nur die Liste wächst; Suchfeld, Hinweise und Knöpfe behalten ihre Höhe */
.otp-setup > :not(.list) {
    flex: none;
}
.head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
}
.logo {
    width: 36px;
    height: 36px;
}
.title {
    font-size: 16px;
    font-weight: 600;
}
.subtitle {
    font-size: 13px;
    opacity: 0.75;
}
.question {
    font-size: 14px;
    font-weight: 500;
    margin: 4px 0 10px;
}
.list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px;
}
.item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    flex: none;
    text-align: left;
    padding: 8px 10px 8px 8px;
    border-radius: 4px;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    background: rgb(var(--v-theme-surface));
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}
.item:hover {
    border-color: rgba(var(--v-theme-primary), 0.55);
}
.item.selected {
    border-color: rgb(var(--v-theme-primary));
    box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
    background: rgba(var(--v-theme-primary), 0.05);
}
.item:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 1px;
}
.tile {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 10px;
    background: rgba(var(--v-theme-on-surface), 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
}
.tile img {
    width: 26px;
    height: 26px;
}
.tile-fallback {
    opacity: 0.55;
}
.badge {
    flex: none;
    display: inline-flex;
    font-size: 18px;
    opacity: 0.6;
}
.badge-otp {
    opacity: 0.75;
    color: rgb(var(--v-theme-primary));
}
.check {
    flex: none;
    width: 22px;
    display: inline-flex;
    justify-content: center;
    font-size: 22px;
    color: rgb(var(--v-theme-primary));
}
.text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}
.item-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.item-user {
    font-size: 12px;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.empty {
    font-size: 13px;
    opacity: 0.7;
    padding: 8px 2px;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
    flex: none;
}
</style>

<style>
/* Bestätigung: Vuetify-Mindesthöhe (100vh) aufheben, damit das Popup auf den Inhalt schrumpft */
body.ferry-compact .v-application__wrap,
body.ferry-compact .v-application {
    min-height: 0 !important;
}
</style>
