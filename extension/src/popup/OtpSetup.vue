<template>
    <v-app>
        <v-main>
            <div class="otp-setup">
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

                <template v-else-if="!done">
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
                        <template #prepend-inner><mdi-magnify /></template>
                    </v-text-field>

                    <div class="list">
                        <button
                            v-for="c of shownEntries"
                            :key="c.dbFileName + c.uuid"
                            type="button"
                            class="item"
                            :class="{ selected: isSelected(c) }"
                            @click="select(c)"
                        >
                            <span class="radio" :class="{ on: isSelected(c) }"></span>
                            <span class="text">
                                <span class="item-title">{{ c.title || "—" }}</span>
                                <span class="item-user">{{ c.username }}</span>
                            </span>
                            <span v-if="c.uuid === setup.lastFilledUuid" class="chip chip-used">{{ $i18n("otpSetup_lastUsed") }}</span>
                            <span v-if="c.hasTotp" class="chip chip-otp">{{ $i18n("otpSetup_hasOtp") }}</span>
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

                <v-alert v-else type="success" variant="tonal" density="comfortable" class="mt-3">
                    {{ $i18n("otpSetup_done") }}
                </v-alert>
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
                    window.setTimeout(() => window.close(), 2200);
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
    width: 380px;
    padding: 16px 18px 14px;
    font-family: "Segoe UI", system-ui, sans-serif;
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
    gap: 6px;
    max-height: 260px;
    overflow-y: auto;
}
.item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
    background: rgb(var(--v-theme-surface));
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
}
.item:hover {
    border-color: rgba(var(--v-theme-primary), 0.6);
}
.item.selected {
    border-color: rgb(var(--v-theme-primary));
    background: rgba(var(--v-theme-primary), 0.08);
}
.item:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 2px;
}
.radio {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 50%;
    border: 2px solid rgba(var(--v-theme-on-surface), 0.45);
}
.radio.on {
    border-color: rgb(var(--v-theme-primary));
    background: radial-gradient(circle, rgb(var(--v-theme-primary)) 45%, transparent 50%);
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
.chip {
    flex: none;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
}
.chip-used {
    background: rgba(22, 163, 74, 0.14);
    color: #15803d;
}
.chip-otp {
    background: rgba(245, 158, 11, 0.16);
    color: #b45309;
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
}
</style>
