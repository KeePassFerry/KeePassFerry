<template>
    <v-app>
        <!-- Eintrag gewählt: dasselbe Bearbeiten-Fenster wie über den Stift, "Hinzufügen" mit der Markierung offen -->
        <div v-if="editing" class="ferry-shell">
            <main class="ferry-body">
                <Save1stParty :create-on-save="createOnSave" @cancel-clicked="cancel" @saved-additions-only="finish" />
            </main>
        </div>
        <v-main v-else>
            <div class="sel-save">
                <header class="head">
                    <img src="/assets/images/48.png" alt="" class="logo" />
                    <div class="head-text">
                        <div class="title">{{ $i18n("selSave_heading") }}</div>
                        <div v-if="setup" class="subtitle">{{ setup.domain }}</div>
                    </div>
                </header>

                <v-progress-linear v-if="loading" indeterminate color="primary" class="my-4" />

                <v-alert v-else-if="!setup" type="info" variant="tonal" density="comfortable" class="mt-3">
                    {{ $i18n("selSave_nothing") }}
                </v-alert>

                <template v-else>
                    <div class="value-preview">{{ setup.text }}</div>

                    <div class="question">{{ $i18n("selSave_choose") }}</div>
                    <v-text-field
                        v-model="query"
                        :placeholder="$i18n('otpSetup_search')"
                        variant="outlined"
                        density="compact"
                        rounded="lg"
                        hide-details
                        clearable
                        class="mb-2"
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
                            @dblclick="openEditor(c)"
                        >
                            <span class="tile">
                                <img v-if="c.icon" :src="'data:image/png;base64,' + c.icon" alt="" />
                                <tabler-key v-else class="ferry-ico tile-fallback"/>
                            </span>
                            <span class="text">
                                <span class="item-title">{{ c.title || "—" }}</span>
                                <span class="item-user">{{ c.username }}</span>
                            </span>
                            <span class="check">
                                <tabler-circle-check class="ferry-ico" v-if="isSelected(c)"/>
                            </span>
                        </button>
                        <div v-if="shownEntries.length === 0" class="empty">{{ $i18n("otpSetup_none") }}</div>
                        <button
                            type="button"
                            class="item item-new"
                            :class="{ selected: newEntry }"
                            :aria-pressed="newEntry"
                            @click="selectNew"
                        >
                            <span class="tile"><tabler-plus class="ferry-ico" /></span>
                            <span class="text">
                                <span class="item-title">{{ $i18n("selSave_newEntry") }}</span>
                                <span class="item-user">{{ setup.pageTitle || setup.domain }}</span>
                            </span>
                            <span class="check">
                                <tabler-circle-check class="ferry-ico" v-if="newEntry"/>
                            </span>
                        </button>
                    </div>

                    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2">
                        {{ $i18n("selSave_error") }}
                    </v-alert>

                    <div class="actions">
                        <v-btn variant="text" @click="cancel">{{ $i18n("otpSetup_cancel") }}</v-btn>
                        <v-btn
                            color="primary"
                            variant="flat"
                            rounded="lg"
                            :disabled="!selected && !newEntry"
                            :loading="opening"
                            @click="next"
                        >
                            {{ $i18n("selSave_next") }}
                        </v-btn>
                    </div>
                </template>
            </div>
        </v-main>
    </v-app>
</template>

<script lang="ts">
import { mapActions, mapState } from "pinia";
import useStore from "../store";
import Save1stParty from "./components/Save1stParty.vue";
import { SearcherAll } from "../common/SearcherAll";
import { configManager } from "../common/ConfigManager";
import { supplementEntryState } from "./supplementEntryState";
import { requestAddition } from "./extras";
import { SaveState } from "../common/SaveState";
import { Entry } from "../common/model/Entry";

// Popup-Ansicht "„…“ zu Eintrag hinzufügen": Eintrag wählen (der im Tab zuletzt benutzte wird direkt geöffnet),
// dann das bekannte Bearbeiten-Fenster mit aufgeklapptem "Hinzufügen" und der Markierung als Inhalt.
interface Candidate {
    uuid: string;
    dbFileName: string;
    title: string;
    username: string;
    icon: string;
}

export default {
    components: { Save1stParty },
    data: () => ({
        loading: true,
        setup: null as { text: string; domain: string; pageTitle: string; origin: string; candidates: Candidate[]; lastFilledUuid: string },
        query: "",
        selected: null as Candidate,
        newEntry: false,
        opening: false,
        editing: false,
        // Neuer Eintrag: wird erst mit "Speichern" im Bearbeiten-Fenster angelegt
        createOnSave: null as (group: { uuid: string; dbFileName: string }) => Promise<{ uuid: string; dbFileName: string }>,
        error: false
    }),
    computed: {
        ...mapState(useStore, ["KeePassDatabases", "ActiveKeePassDatabaseIndex", "saveState"]),
        shownEntries: function (): Candidate[] {
            const q = (this.query ?? "").trim();
            if (!q) return this.setup?.candidates ?? [];
            const search = new SearcherAll(
                { KeePassDatabases: this.KeePassDatabases, ActiveKeePassDatabaseIndex: this.ActiveKeePassDatabaseIndex } as any,
                { version: 1, searchAllDatabases: configManager.current.searchAllOpenDBs, maximumResults: 20 }
            );
            const results = (search.execute(q, undefined, []) ?? []) as any[];
            return results.map(r => ({
                uuid: r.uuid,
                dbFileName: r.dbFileName,
                title: r.title,
                username: r.usernameValue ?? "",
                icon: r.icon?.iconImageData ?? this.setup.candidates.find(c => c.uuid === r.uuid)?.icon ?? ""
            }));
        }
    },
    mounted: async function () {
        try {
            this.setup = await chrome.runtime.sendMessage({ keepassferry: "getSelectionSave" });
        } catch (e) {
            this.setup = null;
        }
        const c = this.setup?.candidates ?? [];
        const last = c.find(x => x.uuid === this.setup.lastFilledUuid);
        if (last) {
            // Eben im Tab benutzt: das ist fast immer der richtige Eintrag; das Bearbeiten-Fenster zeigt ihn oben an
            await this.openEditor(last);
        } else if (c.length === 1) {
            this.selected = c[0];
        }
        this.loading = false;
    },
    methods: {
        ...mapActions(useStore, ["updateSaveState"]),
        isSelected: function (c: Candidate) {
            return !this.newEntry && this.selected?.uuid === c.uuid && this.selected?.dbFileName === c.dbFileName;
        },
        select: function (c: Candidate) {
            this.selected = c;
            this.newEntry = false;
            this.error = false;
        },
        selectNew: function () {
            this.selected = null;
            this.newEntry = true;
            this.error = false;
        },
        next: async function () {
            if (this.newEntry) this.openNewEntryEditor();
            else if (this.selected) await this.openEditor(this.selected);
        },
        // Neuer Eintrag nur im Popup (Titel = Seitentitel, Adresse = Ursprung, aktive Datenbank); KeePass bekommt ihn
        // erst mit "Speichern", damit Abbrechen keinen leeren Eintrag hinterlässt
        openNewEntryEditor: function () {
            const dbs = this.KeePassDatabases as any[];
            const db = dbs[this.ActiveKeePassDatabaseIndex] ?? dbs[0];
            if (!db) {
                this.error = true;
                return;
            }
            const entry = new Entry({
                title: this.setup.pageTitle || this.setup.domain,
                URLs: [this.setup.origin],
                fields: [],
                // Nur Kennung der Datenbank, nicht der ganze Baum (der Bearbeiten-Zustand wird an den Hintergrund verteilt)
                database: { name: db.name, fileName: db.fileName, root: { uuid: db.root?.uuid } } as any
            });
            this.createOnSave = async (group: { uuid: string; dbFileName: string }) => {
                const e = (this.saveState as SaveState).newEntry;
                const created = await chrome.runtime.sendMessage({
                    keepassferry: "createSelectionEntry",
                    title: e.title,
                    dbFileName: group.dbFileName,
                    groupUuid: group.uuid
                });
                // Gewählte Gruppe merken wie beim normalen Speichern (Vorauswahl beim nächsten Mal)
                if (created) {
                    if (!configManager.current.mruGroup) configManager.current.mruGroup = {};
                    configManager.current.mruGroup[group.dbFileName] = group.uuid;
                    configManager.current.mruGroup["{<{{<<kee-primary>>}}>}"] = group.uuid;
                    configManager.save();
                }
                return created;
            };
            this.showEditor(entry);
        },
        // Wie der Stift am Eintrag (Entry.vue editEntry), ohne abgeschickte Anmeldedaten
        openEditor: async function (c: { uuid: string; dbFileName: string }) {
            this.opening = true;
            this.error = false;
            try {
                const raw = await chrome.runtime.sendMessage({ keepassferry: "findEntryForEdit", uuid: c.uuid, dbFileName: c.dbFileName });
                if (!raw) throw new Error("entry not found");
                this.createOnSave = null;
                this.showEditor(new Entry(raw));
            } catch (e) {
                this.error = true;
            }
            this.opening = false;
        },
        showEditor: function (entry: Entry) {
            const ss = this.saveState as SaveState;
            const updated = Object.assign({}, ss);
            updated.newEntry = supplementEntryState(entry, { ...ss, submittedData: null }, entry.URLs);
            updated.showURLMismatchWarning = false;
            updated.titleResetValue = entry.title;
            updated.lastActiveAt = new Date();
            requestAddition(entry.uuid, this.setup.text);
            this.updateSaveState(updated);
            this.editing = true;
        },
        // Bearbeiten-Zustand zurücksetzen wie App.vue saveDiscard, damit das normale Popup nicht "Bearbeiten" wieder öffnet
        resetSaveState: function () {
            const updated = Object.assign({}, JSON.parse(JSON.stringify(this.saveState as SaveState)));
            updated.newEntry = new Entry({});
            updated.titleResetValue = null;
            updated.lastActiveAt = null;
            updated.showURLMismatchWarning = false;
            updated.favicon = null;
            this.updateSaveState(updated);
        },
        finish: function () {
            chrome.runtime.sendMessage({ keepassferry: "discardSelectionSave" });
            this.resetSaveState();
        },
        cancel: function () {
            chrome.runtime.sendMessage({ keepassferry: "discardSelectionSave" });
            if (this.editing) this.resetSaveState();
            window.close();
        }
    }
};
</script>

<style scoped>
.sel-save {
    width: 400px;
    height: min(600px, 100vh);
    display: flex;
    flex-direction: column;
    padding: 12px 16px 12px;
    font-family: "Segoe UI", system-ui, sans-serif;
}
.sel-save > :not(.list) {
    flex: none;
}
.head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
}
.head-text {
    min-width: 0;
}
.logo {
    width: 32px;
    height: 32px;
}
.title {
    font-size: 16px;
    font-weight: 600;
}
.subtitle {
    font-size: 12px;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.value-preview {
    padding: 8px 12px;
    margin-bottom: 12px;
    border-radius: 8px;
    background: rgba(var(--v-theme-on-surface), 0.05);
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.question {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 6px;
}
.list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 0 1 auto;
    min-height: 96px;
    overflow-y: auto;
    padding: 2px;
}
.item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    flex: none;
    text-align: left;
    padding: 5px 10px 5px 6px;
    border-radius: 6px;
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
.item-new {
    border-style: dashed;
}
.tile {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 8px;
    background: rgba(var(--v-theme-on-surface), 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
}
.tile img {
    width: 22px;
    height: 22px;
}
.tile-fallback {
    opacity: 0.55;
}
.check {
    flex: none;
    width: 22px;
    display: inline-flex;
    justify-content: center;
    font-size: 21px;
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
    font-size: 14px;
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
    padding: 4px 2px;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
    padding-top: 6px;
    flex: none;
}
</style>
