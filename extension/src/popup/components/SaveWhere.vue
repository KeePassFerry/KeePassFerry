<template>
    <div class="ferry-edit">
        <div class="ferry-pagehead ferry-edit-head">
            <button type="button" class="ferry-ib" :aria-label="$i18n('cancel')" @click="$emit('back')">
                <tabler-arrow-left class="ferry-ico" />
                <v-tooltip location="bottom" activator="parent">{{ $i18n("cancel") }}</v-tooltip>
            </button>
            <span class="ferry-pagehead-title">{{ $i18n("where") }}</span>
        </div>
        <div class="ferry-edit-body">
            <v-text-field
                v-model="debouncedSearchValue" :label="$i18n('Search_label')" hide-details="auto" clearable
                density="compact" class="mt-3 mb-2">
                <template #prepend-inner><tabler-search class="ferry-ico" /></template>
            </v-text-field>
            <div class="ferry-where-tree">
                <Tree :items="items" :filter-text="search ?? ''" @set-group="(item: GroupListItem) => handleSelect(item)"></Tree>
            </div>
            <v-checkbox v-model="skipInFuture" :label="$i18n('skip_where_enable_context')" hide-details class="mt-2" />
            <div v-if="displayReason" class="ferry-add-note">{{ displayReason }}</div>
        </div>
        <div class="ferry-actionbar ferry-edit-actions">
            <v-spacer />
            <v-btn variant="text" @click="$emit('back')">{{ $i18n("cancel") }}</v-btn>
            <v-btn :disabled="!saveEnabled" color="primary" variant="flat" @click="saveEntry">
                {{ $i18n("save") }}
            </v-btn>
        </div>
    </div>
</template>

<style>
.ferry-where-tree {
    max-height: 300px;
    min-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--ferry-line);
    border-radius: 10px;
    padding: 4px 0;
}
.ferry-where-tree ul {
    list-style: none;
    padding: 0;
    margin: 0;
}
</style>

<script lang="ts">
import { Port } from "../../common/port";
import { Action } from "../../common/Action";
import { SaveState } from "../../common/SaveState";
import { Entry } from "../../common/model/Entry";
import { Group } from "../../common/model/Group";
import { AddonMessage } from "../../common/AddonMessage";
import { Database } from "../../common/model/Database";
import { DatabaseSummary } from "../../common/model/DatabaseSummary";
import { GroupSummary, TemporaryIDString } from "../../common/model/GroupSummary";
import { configManager } from "../../common/ConfigManager";
import useStore from "../../store";
import { mapState } from "pinia";
import { KeeLog } from "~/common/Logger";
import GroupSelectorTree from "./GroupSelectorTree.vue";
import { GroupListItem } from "./TreeItem.vue";


const recursiveFilterMap = (group: Group, filter: (grp: Group) => boolean, map: (grp: Group) => Group): Group => {
    const chosenChildGroups: Group[] = [];

    for (const childGroup of group.groups) {
        const chosenChildGroup = recursiveFilterMap(childGroup, filter, map);
        if (chosenChildGroup) chosenChildGroups.push(chosenChildGroup);
    }

    // groups can be included just because a child is included
    if (filter(group) || chosenChildGroups.length > 0) {
        const old = JSON.parse(JSON.stringify(group));
        old.groups = chosenChildGroups;
        const g = new Group(old);
        return map(g);
    }
    return null;
};

function findDatabaseAndGroupByGroupId(databases: Database[], uuid: string) {

    for (const database of databases) {
        const group = Group.matchingId(database.root, uuid);
        if (group) {
            return { database, group };
        }
    }
    return null;
}

let selectedItem: any = {};

export default {
    emits: ["back"],
    components: {
        Tree: GroupSelectorTree
    },
    props: ["preferredGroupUuid", "displayReason"],
    setup() {
        const { updateSaveState } = useStore();
        return { updateSaveState };
    },
    data: function () {
        return {
            search: "",
            debounceTimeout: null,
            updatingConfig: false,
            skipInFuture: configManager.current.rememberMRUGroup,
            lastSelectedGroupUuid: this.$props.preferredGroupUuid, // caller has already checked that this uuid is present in list of DBs and groups
            initialSelectedGroupId: JSON.parse(JSON.stringify(this.$props.preferredGroupUuid)) // really do not want this to be reactive!
        };
    },
    computed: {
        ...mapState(useStore, ["saveState", "KeePassDatabases", "ActiveKeePassDatabaseIndex"]),
        rootGroup: function () {
            return this.KeePassDatabases[this.ActiveKeePassDatabaseIndex].root;
        },
        saveEnabled: function () {
            return !this.updatingConfig && this.lastSelectedGroupUuid?.length > 0;
        },
        debouncedSearchValue: {
            get() {
                return this.search;
            },
            set(value) {
                clearTimeout(this.debounceTimeout);
                this.debounceTimeout = setTimeout(() => {
                    this.search = value;
                }, 50);
            }
        },
        items: function () {
            // array of all databases root group
            const groups = this.KeePassDatabases.map(db => recursiveFilterMap(db.root, g => true, g => {
                const grp = new Group({
                    entrySummaries: [],
                    groups: g.groups,
                    icon: null,
                    path: g.path,
                    title: g.title,
                    uuid: g.uuid
                }
                );
                return grp;
            }));

            const mapItem = (item: Group) => {
                const selected = item.uuid === this.initialSelectedGroupId;
                const gli = new GroupListItem(
                    item.uuid,
                    item.title,
                    item.groups.map(mapItem),
                    selected,
                    []

                );
                // We need to cache the reference to a reactive version of the item if it has been preselected
                // so we can deselect it later. The other items will be Proxified later.
                const result = selected ? reactive(gli) : gli;
                if (selected) {
                    selectedItem = result;
                }
                return result;
            };
            return reactive(groups.map(mapItem));
        }
    },
    watch: {
        skipInFuture: async function (newValue: boolean, oldValue: boolean) {
            if (newValue !== oldValue) {
                this.updatingConfig = true;
                configManager.current.rememberMRUGroup = newValue;
                await configManager.save();
                this.updatingConfig = false;
            }
        }
    },
    mounted() {
        // Not certain that mounted is the right place for this but maybe it's fine
        if (this.initialSelectedGroupId?.length > 0) {
            this.setGroupById(this.initialSelectedGroupId);
        }
    },
    methods: {

        saveEntry: function () {
            Port.postMessage({ action: Action.CreateEntry } as AddonMessage);
            window.close();
        },
        setGroupById: function (uuid: string) {
            if (!uuid) return;

            const { database, group: selectedGroup } = findDatabaseAndGroupByGroupId(this.KeePassDatabases, uuid);

            // Maybe object assign isn't actually removing the proxy objects?
            const updatedSaveState = Object.assign({}, this.saveState) as SaveState;
            //const updatedSaveState = JSON.parse(JSON.stringify(this.saveState)) as SaveState;

            updatedSaveState.newEntry = new Entry({
                ...updatedSaveState.newEntry,
                parentGroup: selectedGroup,
                database: new DatabaseSummary({
                    fileName: JSON.parse(JSON.stringify(database.fileName)),
                    root: new GroupSummary({ uuid: TemporaryIDString })
                })
            });
            this.updateSaveState(updatedSaveState);
            this.lastSelectedGroupUuid = uuid;
        },
        handleSelect(item: GroupListItem) {
            KeeLog.debug("Setting selected group to " + item.id);
            selectedItem.selected = false;
            item.selected = true;
            selectedItem = item;
            this.setGroupById(item.id);
        }
    }
};

</script>
