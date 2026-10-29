<template>
    <div class="ferry-edit">
        <div class="ferry-pagehead ferry-edit-head">
            <button type="button" class="ferry-ib" :aria-label="$i18n('cancel')" @click="cancel">
                <tabler-arrow-left class="ferry-ico" />
                <v-tooltip location="bottom" activator="parent">{{ $i18n("cancel") }}</v-tooltip>
            </button>
            <span class="ferry-pagehead-title">{{ editingExisting && !createOnSave ? $i18n("ferry_edit_entry") : $i18n("create_new_entry") }}</span>
            <button v-if="editingExisting && !createOnSave" type="button" class="ferry-ib" :aria-label="$i18n('open_full_editor')" @click="openFullEntryEditor">
                <tabler-external-link class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("open_full_editor") }}</v-tooltip>
            </button>
        </div>
        <div class="ferry-edit-body">
            <div class="ferry-group">
                <div class="ferry-group-title">{{ $i18n("ferry_edit_entry_heading") }}</div>
                <v-text-field
                    :label="$i18n('title')" :model-value="saveState.newEntry.title"
                    hide-details="auto" type="text" autofocus class="mb-2"
                    @update:model-value="setTitle" @focus="onTitleFocus" @blur="onTitleBlur">
                    <template v-if="titleFocussed && resettableTitle" #append-inner>
                        <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_reset_value')" @click="resetTitle">
                            <tabler-arrow-back-up class="ferry-ico" />
                            <v-tooltip location="bottom" activator="parent">{{ $i18n("ferry_reset_value") }}</v-tooltip>
                        </button>
                    </template>
                </v-text-field>
                <!-- Neuer Eintrag aus dem Kontextmenü: Gruppe wählen (Baum wie bei "Wo speichern?") -->
                <div v-if="createOnSave" class="ferry-group-pick">
                    <button type="button" class="ferry-group-btn" :aria-expanded="groupPickerOpen" @click="groupPickerOpen = !groupPickerOpen">
                        <tabler-folder class="ferry-ico" />
                        <span class="ferry-group-btn-text">
                            <span class="ferry-group-btn-label">{{ $i18n("ferry_new_entry_group") }}</span>
                            <span class="ferry-group-btn-value">{{ targetGroupLabel }}</span>
                        </span>
                        <tabler-chevron-up v-if="groupPickerOpen" class="ferry-ico" />
                        <tabler-chevron-down v-else class="ferry-ico" />
                    </button>
                    <div v-if="groupPickerOpen" class="ferry-where-tree ferry-group-tree">
                        <GroupTree :items="groupItems" filter-text="" @set-group="pickGroup" />
                    </div>
                </div>
                <FieldEditor
                    v-for="f of saveState.newEntry.fields" :key="f.uuid" :field="f" :removed="pendingRemoval.includes(f.uuid)"
                    @field-value-changed="fieldValueChanged" @field-deleted="fieldDeleted" />
            </div>
            <div v-if="showURLMismatchWarning" class="ferry-note warn ferry-edit-warn">
                <tabler-alert-triangle class="ferry-ico" />
                <div class="ferry-note-text">
                    <p>{{ $i18n("url_mismatch_1") }}</p>
                    <p>{{ $i18n("url_mismatch_2") }}</p>
                    <p>{{ $i18n("url_mismatch_3") }}</p>
                    <v-checkbox v-model="differentSiteConfirmation" hide-details :label="$i18n('url_mismatch_confirm', entryDomain)" />
                </div>
            </div>
            <EntryAddition
                v-if="editingExisting" ref="addition"
                :uuid="saveState.newEntry.uuid" :db-file-name="saveState.newEntry.database.fileName"
                :title="saveState.newEntry.title" :not-created-yet="!!createOnSave" @changed="additionsChanged = $event" />
        </div>
        <div class="ferry-actionbar ferry-edit-actions">
            <v-spacer />
            <v-btn variant="text" @click="cancel">
                {{ $i18n("cancel") }}
            </v-btn>
            <v-btn v-if="!loading && !editingExisting && !skipWhere" color="primary" variant="flat" @click="nextClicked">
                {{ $i18n("next") }}
            </v-btn>
            <v-btn v-if="!loading && !editingExisting && skipWhere" color="primary" variant="flat" @click="saveEntry">
                {{ $i18n("save") }}
            </v-btn>
            <v-btn v-if="loading" loading color="primary" variant="flat"> ......... </v-btn>
            <v-btn
                v-if="editingExisting"
                :disabled="!hasChanges || (showURLMismatchWarning && !differentSiteConfirmation)"
                :loading="saving" color="primary" variant="flat" @click="saveAll">
                {{ $i18n("save") }}
            </v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { Port } from "../../common/port";
import { Action } from "../../common/Action";
import { SaveState } from "../../common/SaveState";
import { Entry } from "../../common/model/Entry";
import FieldEditor from "./FieldEditor.vue";
import EntryAddition from "./EntryAddition.vue";
import { Field } from "../../common/model/Field";
import { AddonMessage } from "../../common/AddonMessage";
import { KeeURL } from "../../common/KeeURL";
import { TemporaryIDString, GroupSummary } from "../../common/model/GroupSummary";
import { configManager } from "../../common/ConfigManager";
import { DatabaseSummary } from "../../common/model/DatabaseSummary";
import { Database } from "../../common/model/Database";
import { Group } from "../../common/model/Group";
import { SearcherAll } from "../../common/SearcherAll";
import useStore from "../../store";
import { mapState } from "pinia";
import { KeeLog } from "~/common/Logger";
import GroupSelectorTree from "./GroupSelectorTree.vue";
import { GroupListItem } from "./TreeItem.vue";

export default {
    components: {
        FieldEditor,
        EntryAddition,
        GroupTree: GroupSelectorTree
    },
    // createOnSave: neuer Eintrag aus dem Kontextmenü (markierter Text), den erst "Speichern" in KeePass anlegt;
    // bekommt die gewählte Gruppe ({ uuid, dbFileName }) und liefert den angelegten Eintrag ({ uuid, dbFileName })
    // oder null. Abbrechen hinterlässt so nichts.
    props: { createOnSave: { type: Function, default: null } },
    emits: ["cancel-clicked", "save-where-clicked", "saved-additions-only"],
    setup() {
        const { updateSaveState, removeFieldFromActiveEntry } = useStore();
        return { updateSaveState, removeFieldFromActiveEntry };
    },
    data: () => ({
        originalFields: [],
        differentSiteConfirmation: false,
        loading: true,
        preferToSkipWhere: false,
        skipWhere: false,
        domainMatchesExistingEntry: false,
        preferredGroupUuid: null,
        preferredDb: null,
        primaryFound: false,
        titleFocussed: true,
        additionsChanged: false,
        saving: false,
        // Zum Entfernen vorgemerkte Felder (uuid); entfernt wird erst beim Speichern
        pendingRemoval: [] as string[],
        // Nur bei createOnSave: Zielgruppe des neuen Eintrags
        targetGroup: null as { uuid: string; dbFileName: string; label: string },
        groupPickerOpen: false,
        originalFieldCount: 0
    }),
    computed: {
        ...mapState(useStore, ["saveState", "KeePassDatabases", "ActiveKeePassDatabaseIndex"]),
        resettableTitle: function () {
            return (
                this.saveState.titleResetValue !==
                this.saveState.newEntry.title
            );
        },
        // Titel, Benutzername, Passwort o. Ä. geändert oder ein Feld entfernt
        entryChanged: function () {
            const e = (this.saveState as SaveState).newEntry;
            return (
                this.pendingRemoval.length > 0 ||
                this.saveState.titleResetValue !== e.title ||
                e.fields.length !== this.originalFieldCount ||
                e.fields.some(f => f.resetValue !== undefined && f.resetValue !== f.value)
            );
        },
        hasChanges: function () {
            return this.entryChanged || this.additionsChanged;
        },
        editingExisting: function () {
            const e = (this.saveState as SaveState).newEntry;
            return e.database.fileName && e.database.root.uuid !== TemporaryIDString;
        },
        showURLMismatchWarning: function () {
            return this.saveState.showURLMismatchWarning;
        },
        entryDomain: function () {
            const urlStr = (this.saveState as SaveState).newEntry.URLs[0];
            if (!urlStr || urlStr.length < 4) return "<unknown>";
            const kurl = KeeURL.fromString(urlStr);
            if (!kurl) {
                return "<error>";
            }
            return kurl.domainWithPort || kurl.url.host;
        },
        // Gruppenbaum aller offenen Datenbanken; die gewählte Gruppe ist markiert
        groupItems: function (): GroupListItem[] {
            const map = (g: Group): GroupListItem =>
                new GroupListItem(g.uuid, g.title, (g.groups ?? []).map(map), g.uuid === this.targetGroup?.uuid, []);
            return reactive((this.KeePassDatabases as Database[]).filter(db => db.root).map(db => map(db.root)));
        },
        targetGroupLabel: function (): string {
            return this.targetGroup?.label ?? "—";
        },
        displayWhereReason: function () {
            if (this.loading || !this.preferToSkipWhere) return null;
            return this.domainMatchesExistingEntry
                ? this.$i18n("skip_where_reason_domain_entry_exists")
                : this.primaryFound
                    ? this.$i18n("skip_where_reason_group_not_found")
                    : null;
        }
    },
    async mounted() {
        this.originalFieldCount = (this.saveState as SaveState).newEntry.fields.length;
        this.preferToSkipWhere = configManager.current.rememberMRUGroup;
        const dbs = this.KeePassDatabases as Database[];
        const { preferredGroupUuid, preferredDb, primaryFound } = this.getPreferredGroup(
            configManager.current.mruGroup,
            dbs
        );
        this.preferredGroupUuid = preferredGroupUuid;
        // Neuer Eintrag aus dem Kontextmenü: zuletzt benutzte Gruppe wie beim normalen Speichern, sonst Wurzel der aktiven DB
        if (this.createOnSave) {
            const activeDb = dbs[this.ActiveKeePassDatabaseIndex] ?? dbs[0];
            this.setTargetGroup(preferredGroupUuid) || this.setTargetGroup(activeDb?.root?.uuid);
        }
        if (this.preferToSkipWhere) {
            this.preferredDb = preferredDb;
            this.primaryFound = primaryFound;

            this.domainMatchesExistingEntry = this.anyEntryMatchesNewDomain();

            if (this.preferredGroupUuid && this.preferredDb && !this.domainMatchesExistingEntry) {
                this.skipWhere = true;
            }
        }
        this.loading = false;
    },
    methods: {
        cancel: function () {
            this.$emit("cancel-clicked");
        },
        setTargetGroup: function (uuid: string): boolean {
            if (!uuid) return false;
            for (const db of this.KeePassDatabases as Database[]) {
                const group = db.root ? Group.matchingId(db.root, uuid) : null;
                if (!group) continue;
                // Pfad ohne den Namen der Wurzelgruppe ist kürzer; bei der Wurzel selbst ihr Name
                const label = group.uuid === db.root.uuid ? db.root.title || db.name : (group.path || group.title).split("/").join(" › ");
                this.targetGroup = { uuid, dbFileName: db.fileName, label };
                return true;
            }
            return false;
        },
        pickGroup: function (item: GroupListItem) {
            if (this.setTargetGroup(item.id)) this.groupPickerOpen = false;
        },
        nextClicked: function () {
            this.applyPendingRemovals();
            this.$emit("save-where-clicked", this.displayWhereReason, this.preferredGroupUuid);
        },
        saveEntry: function () {
            this.applyPendingRemovals();
            const updatedSaveState = Object.assign({}, JSON.parse(JSON.stringify(this.saveState))) as SaveState;
            updatedSaveState.newEntry = new Entry({
                ...updatedSaveState.newEntry,
                parentGroup: new GroupSummary({ uuid: this.preferredGroupUuid }),
                database: this.preferredDb
            });
            this.updateSaveState(updatedSaveState);
            Port.postMessage({ action: Action.CreateEntry } as AddonMessage);
            window.close();
        },
        // Ein Speichern für alles: erst Hinzugefügtes/Entferntes (direkt im Plugin), dann geänderte Eintragsfelder
        saveAll: async function () {
            this.saving = true;
            const additions = this.$refs.addition as any;
            if (this.createOnSave) {
                // Eintrag mit Titel/Adresse aus diesem Fenster anlegen, dann das Hinzugefügte hineinschreiben
                const target = this.targetGroup ? await this.createOnSave(this.targetGroup).catch(() => null) : null;
                if (!target && additions) additions.error = this.$i18n("ferry_add_failed");
                const ok = target && additions ? await additions.commit(target) : !!target;
                this.saving = false;
                if (!ok) return;
                this.$emit("saved-additions-only");
                await this.$nextTick();
                window.close();
                return;
            }
            const ok = additions ? await additions.commit() : true;
            if (this.entryChanged) {
                this.applyPendingRemovals();
                Port.postMessage({ action: Action.UpdateEntry } as AddonMessage);
            }
            this.saving = false;
            if (!ok) return;
            // Nur Zusätze gespeichert: kein UpdateEntry, das den Bearbeiten-Zustand beendet, also hier verwerfen
            // (sonst öffnet das Popup beim nächsten Mal wieder "Bearbeiten" ohne Änderungen)
            if (!this.entryChanged) {
                this.$emit("saved-additions-only");
                await this.$nextTick();
            }
            window.close();
        },
        openFullEntryEditor() {
            const entry = (JSON.parse(JSON.stringify(this.saveState)) as SaveState).newEntry;
            Port.postMessage({
                loginEditor: {
                    uuid: entry.uuid,
                    DBfilename: entry.database.fileName
                }
            } as AddonMessage);
            window.close();
        },
        setTitle: function (value) {
            const updatedSaveState = Object.assign({}, JSON.parse(JSON.stringify(this.saveState))) as SaveState;
            updatedSaveState.newEntry = new Entry({
                ...updatedSaveState.newEntry,
                title: value
            });
            this.updateSaveState(updatedSaveState);
        },
        resetTitle: function () {
            this.setTitle(JSON.parse(JSON.stringify(this.saveState.titleResetValue)));
        },
        fieldValueChanged: function (change) {
            const updatedSaveState = Object.assign({}, JSON.parse(JSON.stringify(this.saveState))) as SaveState;
            const originalFieldIndex = (JSON.parse(JSON.stringify(this.saveState)) as SaveState).newEntry.fields.findIndex(f => f.uuid === change.uuid);
            const originalField = (JSON.parse(JSON.stringify(this.saveState)) as SaveState).newEntry.fields[
                originalFieldIndex
            ];
            const newField = new Field({
                ...originalField,
                value: change.value
            });
            //TODO:5: faster deep clone
            const newFields = JSON.parse(
                JSON.stringify(updatedSaveState.newEntry.fields)
            ) as Field[];
            newFields[originalFieldIndex] = newField;
            updatedSaveState.newEntry = new Entry({
                ...updatedSaveState.newEntry,
                fields: newFields
            });
            this.updateSaveState(updatedSaveState);
        },
        fieldDeleted: function (field: Partial<Field>) {
            this.pendingRemoval = this.pendingRemoval.includes(field.uuid)
                ? this.pendingRemoval.filter((u: string) => u !== field.uuid)
                : [...this.pendingRemoval, field.uuid];
        },
        // Vorgemerkte Felder jetzt wirklich entfernen (vor Anlegen/Aktualisieren des Eintrags)
        applyPendingRemovals: function () {
            for (const uuid of this.pendingRemoval) this.removeFieldFromActiveEntry(uuid);
            this.pendingRemoval = [];
        },
        getPreferredGroup: function (mruGroup: { [key: string]: string }, dbs: Database[]) {
            if (!mruGroup) {
                return { preferredGroupUuid: null, preferredDb: null, primaryFound: false };
            }

            let primaryFound = false;
            const UUIDs = [];
            const primaryUuid = mruGroup["{<{{<<kee-primary>>}}>}"];
            if (primaryUuid) {
                primaryFound = true;
                UUIDs.push(primaryUuid);
            }

            // We normally expect the value in the primary key to be correct but it may not
            // be if the user has just upgraded from Kee 3.4 or lower, or if they have a
            // particuarlly complex set of databases with different filenames and/or duplicate
            // UUIDs or if they constantly switch back and forth between multiple databases so
            // we may as well try the one specific to the currently open database, although
            // only if there is a single open database.
            if (dbs.length === 1 && mruGroup[dbs[0].fileName]) {
                if (mruGroup[dbs[0].fileName] !== UUIDs[0]) {
                    UUIDs.push(mruGroup[dbs[0].fileName]);
                }
            }

            for (const groupId of UUIDs) {
                if (!groupId) continue;
                const matchedDb = dbs.find(db => Group.containsId(db.root, groupId));
                if (matchedDb) {
                    return {
                        preferredGroupUuid: groupId,
                        preferredDb: new DatabaseSummary({
                            fileName: matchedDb.fileName,
                            root: new GroupSummary({ uuid: TemporaryIDString })
                        }),
                        primaryFound
                    };
                }
            }
            return {
                preferredGroupUuid: null,
                preferredDb: null,
                primaryFound
            };
        },
        anyEntryMatchesNewDomain: function () {
            const urlStr = JSON.parse(JSON.stringify((this.saveState as SaveState).newEntry.URLs[0]));
            if (!urlStr || urlStr.length < 4) return false;
            const kurl = KeeURL.fromString(urlStr);
            if (!kurl) {
                return false;
            }
            const search = new SearcherAll(
                {
                    KeePassDatabases: this.KeePassDatabases,
                    ActiveKeePassDatabaseIndex: this.ActiveKeePassDatabaseIndex
                } as any,
                {
                    version: 1,
                    searchAllDatabases: configManager.current.searchAllOpenDBs,
                    maximumResults: 1
                }
            );
            const results = search.execute("", undefined, [kurl.domainOrIPAddress]);
            return !!results?.length;
        },
        onTitleFocus() {
            this.titleFocussed = true;
        },
        onTitleBlur() {
            this.titleFocussed = false;
        }
    }
};
</script>

<style>
/* Bearbeiten als eigene Seite: Kopf und Leiste bleiben stehen, dazwischen scrollt der Inhalt */
.ferry-edit {
    display: flex;
    flex-direction: column;
    min-height: 100%;
}
.ferry-edit-head {
    position: sticky;
    top: 0;
    z-index: 3;
    background: rgb(var(--v-theme-surface));
}
.ferry-edit-body {
    flex: 1;
    padding: 0 14px 12px;
}
.ferry-edit-actions {
    position: sticky;
    bottom: 0;
    z-index: 3;
}
.ferry-edit-warn {
    margin: 8px 0 0;
    align-items: flex-start;
}
.ferry-edit-warn p {
    margin: 0 0 4px;
}
/* Gruppen im Bearbeiten-Fenster (auch von EntryAddition genutzt): Überschrift, Trennlinie, keine Kästen */
.ferry-group {
    padding: 14px 0 6px;
}
.ferry-group + .ferry-group {
    border-top: 1px solid var(--ferry-line);
}
.ferry-group-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ferry-muted);
    margin-bottom: 10px;
}
/* Gruppenwahl für neue Einträge: sieht aus wie ein Eingabefeld, klappt den Gruppenbaum auf */
.ferry-group-pick {
    margin-bottom: 8px;
}
.ferry-group-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    border-radius: 4px 4px 0 0;
    background: rgba(var(--v-theme-on-surface), 0.04);
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.38);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.ferry-group-btn:hover {
    background: rgba(var(--v-theme-on-surface), 0.07);
}
.ferry-group-btn:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 1px;
}
.ferry-group-btn-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.ferry-group-btn-label {
    font-size: 12px;
    opacity: 0.7;
}
.ferry-group-btn-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ferry-group-tree {
    margin-top: 6px;
    min-height: 0;
    max-height: 220px;
}
</style>
