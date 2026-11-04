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
            <!-- Option "Ablaufdaten prüfen": neues Ablaufdatum (KeePass "Gültig bis") gleich beim Speichern -->
            <div v-if="showExpiryChoice" class="ferry-group">
                <div class="ferry-group-title">
                    {{ $i18n("ferry_valid_until") }}
                    <span v-if="previousExpiryLabel" :class="{ 'ferry-expiry-old': previousExpired }">({{ previousExpiryLabel }})</span>
                </div>
                <v-select
                    :model-value="expiryChoice" :items="expiryItems" item-title="title" item-value="value"
                    density="compact" hide-details :hint="newExpiryLabel" :persistent-hint="!!newExpiryLabel"
                    @update:model-value="setExpiryChoice" />
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
        <!-- Eintrag löschen: nur in den Papierkorb von KeePass. Die Rückfrage steht als Kasten an der Stelle der
             Aktionsleiste, also immer unten sichtbar (das Popup ist höchstens 600 px hoch) -->
        <div v-if="confirmDelete || deleteMessage" class="ferry-delete-dock">
            <div class="ferry-note warn ferry-delete-note">
                <tabler-trash class="ferry-ico" />
                <div class="ferry-note-text">
                    <p v-if="deleteMessage">{{ deleteMessage }}</p>
                    <template v-else>
                        <p><strong>{{ $i18n("ferry_entry_delete_question", [saveState.newEntry.title]) }}</strong></p>
                        <p>{{ $i18n("ferry_entry_delete_hint") }}</p>
                    </template>
                    <div class="ferry-delete-actions">
                        <v-btn variant="text" size="small" @click="confirmDelete = false; deleteMessage = null">
                            {{ deleteMessage ? $i18n("close") : $i18n("cancel") }}
                        </v-btn>
                        <v-btn v-if="!deleteMessage" color="error" variant="flat" size="small" :loading="deleting" @click="deleteEntry">
                            {{ $i18n("ferry_entry_delete_confirm") }}
                        </v-btn>
                    </div>
                </div>
            </div>
        </div>
        <div v-else class="ferry-actionbar ferry-edit-actions">
            <v-btn
                v-if="editingExisting && !createOnSave && deleteSupported" variant="text" color="error"
                @click="confirmDelete = true">
                {{ $i18n("ferry_entry_delete") }}
            </v-btn>
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
            <v-btn v-if="loading && !editingExisting" loading color="primary" variant="flat"> ......... </v-btn>
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
import { FerryURL } from "../../common/FerryURL";
import { TemporaryIDString, GroupSummary } from "../../common/model/GroupSummary";
import { configManager } from "../../common/ConfigManager";
import { DatabaseSummary } from "../../common/model/DatabaseSummary";
import { Database } from "../../common/model/Database";
import { Group } from "../../common/model/Group";
import { SearcherAll } from "../../common/SearcherAll";
import useStore from "../../store";
import { mapState } from "pinia";
import { FerryLog } from "~/common/Logger";
import GroupSelectorTree from "./GroupSelectorTree.vue";
import { EXPIRY_PRESETS, ExpiryChoice, addPreset, defaultExpiryChoice, formatExpiryDate, newExpiryTime } from "../../common/expiry";
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
        originalFieldCount: 0,
        // Eintrag löschen (Plugin mit KEEPASSFERRY_ENTRY_RECYCLE): Rückfrage offen, läuft, Meldung bei Misserfolg
        deleteSupported: false,
        confirmDelete: false,
        deleting: false,
        deleteMessage: null as string,
        // "Gültig bis": Plugin liefert/übernimmt Ablaufdaten (KEEPASSFERRY_EXPIRY), gewählter Zeitraum
        expirySupported: false,
        expiryChoice: null as ExpiryChoice
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
                e.fields.some(f => f.resetValue !== undefined && f.resetValue !== f.value) ||
                !!e.newExpiryTime
            );
        },
        showExpiryChoice: function () {
            return this.expirySupported && !this.createOnSave && !!this.expiryChoice;
        },
        previousExpiry: function (): Date {
            const t = (this.saveState as SaveState).newEntry.expiryTime;
            return this.editingExisting && t ? new Date(t) : null;
        },
        previousExpired: function () {
            return !!this.previousExpiry && this.previousExpiry.getTime() <= Date.now();
        },
        previousExpiryLabel: function () {
            if (!this.previousExpiry) return null;
            const d = formatExpiryDate(this.previousExpiry);
            return this.previousExpired ? this.$i18n("ferry_valid_until_previous_expired", [d]) : this.$i18n("ferry_valid_until_previous", [d]);
        },
        // Neu: "Kein Ablauf" + Zeiträume; vorhandener Eintrag zusätzlich "Unverändert" (ohne Ablaufdatum heißt das
        // "Kein Ablauf"); abgelaufener ohne "Unverändert", damit er nicht abgelaufen bleibt
        expiryChoices: function (): ExpiryChoice[] {
            if (!this.editingExisting) return ["never", ...EXPIRY_PRESETS];
            if (!this.previousExpiry) return ["keep", ...EXPIRY_PRESETS];
            if (this.previousExpired) return [...EXPIRY_PRESETS, "never"];
            return ["keep", ...EXPIRY_PRESETS, "never"];
        },
        expiryItems: function () {
            return (this.expiryChoices as ExpiryChoice[]).map(c => ({ value: c, title: this.expiryChoiceLabel(c) }));
        },
        newExpiryLabel: function () {
            const c = this.expiryChoice as ExpiryChoice;
            if (!c || c === "keep" || c === "never") return null;
            return this.$i18n("ferry_valid_until_new", [formatExpiryDate(addPreset(new Date(), c))]);
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
            const kurl = FerryURL.fromString(urlStr);
            if (!kurl) {
                return "<error>";
            }
            return kurl.domainWithPort || kurl.url.host;
        },
        // Gruppenbaum aller offenen Datenbanken; die gewählte Gruppe ist markiert
        groupItems: function (): GroupListItem[] {
            const map = (g: Group): GroupListItem =>
                new GroupListItem(g.uuid, g.title, (g.groups ?? []).map(map), g.uuid === this.targetGroup?.uuid, []);
            return reactive(this.writableDatabases.filter(db => db.root).map(db => map(db.root)));
        },
        // Schreibgeschützte Datenbanken (z. B. nur lesend geteilt) kommen als Ziel nicht in Frage
        writableDatabases: function (): Database[] {
            return (this.KeePassDatabases as Database[]).filter(db => !db.readOnly);
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
        chrome.runtime
            .sendMessage({ keepassferry: "connectionStatus" })
            .then(s => {
                this.deleteSupported = !!s?.entryRecycle;
                this.expirySupported = !!s?.expiry;
                if (this.expirySupported && !this.createOnSave) {
                    const e = (this.saveState as SaveState).newEntry;
                    this.setExpiryChoice(defaultExpiryChoice(!!this.editingExisting, e.expiryTime, e.expiryIntervalDays));
                }
            })
            .catch(() => undefined);
        // Was auch immer beim Vorbereiten schiefgeht: das Fenster bleibt bedienbar (sonst steht der Ladeknopf neben
        // "Speichern" und schiebt die Aktionsleiste aus dem Popup)
        try {
            this.preferToSkipWhere = configManager.current.rememberMRUGroup;
            const dbs = this.writableDatabases;
            const { preferredGroupUuid, preferredDb, primaryFound } = this.getPreferredGroup(
                configManager.current.mruGroup,
                dbs
            );
            this.preferredGroupUuid = preferredGroupUuid;
            // Neuer Eintrag aus dem Kontextmenü: zuletzt benutzte Gruppe wie beim normalen Speichern, sonst Wurzel der aktiven DB
            if (this.createOnSave) {
                const active = (this.KeePassDatabases as Database[])[this.ActiveKeePassDatabaseIndex];
                const activeDb = active && !active.readOnly ? active : dbs[0];
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
        } catch (e) {
            FerryLog.warn("Preparing the edit window failed: " + e);
        } finally {
            this.loading = false;
        }
    },
    methods: {
        cancel: function () {
            this.$emit("cancel-clicked");
        },
        setTargetGroup: function (uuid: string): boolean {
            if (!uuid) return false;
            for (const db of this.writableDatabases) {
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
        // In den Papierkorb von KeePass (nie endgültig); danach wie Abbrechen: Bearbeiten beenden, Popup schließen
        deleteEntry: async function () {
            const e = (this.saveState as SaveState).newEntry;
            this.deleting = true;
            const result: string = await chrome.runtime
                .sendMessage({ keepassferry: "moveEntryToRecycleBin", uuid: e.uuid, dbFileName: e.database.fileName })
                .catch(() => "error");
            this.deleting = false;
            if (result === "recycled") {
                this.$emit("saved-additions-only");
                await this.$nextTick();
                window.close();
                return;
            }
            this.confirmDelete = false;
            this.deleteMessage =
                result === "disabled"
                    ? this.$i18n("ferry_entry_delete_disabled")
                    : result === "inrecyclebin"
                        ? this.$i18n("ferry_entry_delete_in_bin")
                        : this.$i18n("ferry_entry_delete_failed");
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
        setExpiryChoice: function (choice: ExpiryChoice) {
            if (!choice) return;
            this.expiryChoice = choice;
            const updatedSaveState = Object.assign({}, JSON.parse(JSON.stringify(this.saveState))) as SaveState;
            updatedSaveState.newEntry = new Entry({
                ...updatedSaveState.newEntry,
                newExpiryTime: newExpiryTime(choice, !!this.previousExpiry)
            });
            this.updateSaveState(updatedSaveState);
        },
        expiryChoiceLabel: function (c: ExpiryChoice) {
            if (c === "keep" && !this.previousExpiry) return this.$i18n("ferry_expiry_never");
            if (c === "keep") return this.$i18n("ferry_expiry_keep_until", [formatExpiryDate(this.previousExpiry)]);
            return this.$i18n("ferry_expiry_" + c);
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
            const primaryUuid = mruGroup["{<{{<<ferry-primary>>}}>}"];
            if (primaryUuid) {
                primaryFound = true;
                UUIDs.push(primaryUuid);
            }

            // We normally expect the value in the primary key to be correct but it may not
            // be if the user has a
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
            // Einträge ohne Adresse: JSON.parse(JSON.stringify(undefined)) warf und brach das Öffnen ab (Ladeknopf blieb stehen)
            const first = (this.saveState as SaveState).newEntry.URLs?.[0];
            const urlStr: string = typeof first === "string" ? first : null;
            if (!urlStr || urlStr.length < 4) return false;
            const kurl = FerryURL.fromString(urlStr);
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
.ferry-delete-dock {
    flex: none;
    padding: 8px 12px 10px;
    border-top: 1px solid var(--ferry-line);
    background: rgb(var(--v-theme-surface));
}
.ferry-delete-note {
    margin: 0;
}
.ferry-delete-note p {
    margin: 0 0 4px;
    overflow-wrap: anywhere;
}
.ferry-delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
}
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
.ferry-group-title .ferry-expiry-old {
    color: rgb(var(--v-theme-error));
}
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
