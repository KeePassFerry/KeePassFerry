<template>
    <li role="none">
        <div
            class="ferry-tree-row" :class="{ selected: item.selected }" :style="indentStyle"
            role="treeitem" :aria-selected="!!item.selected" :aria-expanded="hasVisibleChildren ? isExpanded : undefined"
            tabindex="0" @click="$emit('select', item)" @keydown.enter.prevent="$emit('select', item)">
            <button
                v-if="hasVisibleChildren" type="button" class="ferry-tree-toggle"
                :aria-label="isExpanded ? $i18n('ferry_group_collapse') : $i18n('ferry_group_expand')" @click.stop="toggleExpand">
                <tabler-chevron-down v-if="isExpanded" class="ferry-ico" />
                <tabler-chevron-right v-else class="ferry-ico" />
            </button>
            <span v-else class="ferry-tree-toggle-space" />
            <tabler-folder-open v-if="hasVisibleChildren && isExpanded" class="ferry-ico ferry-tree-folder" />
            <tabler-folder v-else class="ferry-ico ferry-tree-folder" />
            <span class="ferry-tree-name">{{ item.text }}</span>
            <tabler-check v-if="item.selected" class="ferry-ico ferry-tree-check" />
        </div>
        <ul v-if="hasVisibleChildren" v-show="isExpanded" role="group">
            <TreeItem
                v-for="child in filteredChildren" :key="child.id" :item="child"
                :indent-level="indentLevel + 1" @select="(item) => handleSelect(item)"></TreeItem>
        </ul>
    </li>
</template>
<script lang="ts">
export class GroupListItem {
    constructor(
        public id: string,
        public text: string,
        public children?: GroupListItem[],
        public selected?: boolean,
        public visibleChildIds: string[] = []
    ) { }
}

// Liegt die gewählte Gruppe unterhalb dieses Eintrags? Dann ist er anfangs aufgeklappt
const containsSelected = (item: GroupListItem): boolean =>
    (item.children ?? []).some(child => child.selected || containsSelected(child));

export default {
    name: "TreeItem",
    props: {
        item: {
            type: GroupListItem,
            required: true
        },
        indentLevel: {
            type: Number,
            default: 0
        }
    },
    emits: ["select"],

    data() {
        return {
            // Oberste Ebene und der Weg zur gewählten Gruppe offen, der Rest zu (große Datenbanken bleiben übersichtlich)
            isExpanded: this.indentLevel === 0 || containsSelected(this.item)
        };
    },
    computed: {
        hasVisibleChildren() {
            return this.item.visibleChildIds.length > 0;
        },
        indentStyle() {
            return { paddingLeft: `${6 + this.indentLevel * 18}px` };
        },
        filteredChildren() {
            return this.item.children.filter(child => this.isChildVisible(child));
        }
    },
    methods: {
        toggleExpand() {
            this.isExpanded = !this.isExpanded;
        },
        handleSelect(item: GroupListItem) {
            this.$emit("select", item);
        },
        isChildVisible(item: GroupListItem) {
            return this.item.visibleChildIds.includes(item.id);
        }
    }
};

</script>

<style>
/* Gruppenbaum (Wo speichern?, Gruppe für neue Einträge): eine Zeile je Gruppe, wie die Eintragslisten im Popup */
.ferry-tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding-right: 10px;
    margin: 1px 4px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;
}
.ferry-tree-row:hover {
    background: var(--ferry-hover, rgba(var(--v-theme-on-surface), 0.05));
}
.ferry-tree-row:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: -2px;
}
.ferry-tree-row.selected {
    background: rgba(var(--v-theme-primary), 0.1);
    color: rgb(var(--v-theme-primary));
    font-weight: 600;
}
.ferry-tree-toggle,
.ferry-tree-toggle-space {
    flex: none;
    width: 22px;
    height: 22px;
}
.ferry-tree-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
}
.ferry-tree-toggle:hover {
    opacity: 1;
    background: rgba(var(--v-theme-on-surface), 0.08);
}
.ferry-tree-folder {
    flex: none;
    font-size: 18px;
    color: #e0a526;
}
.ferry-tree-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ferry-tree-check {
    flex: none;
    font-size: 18px;
}
</style>
