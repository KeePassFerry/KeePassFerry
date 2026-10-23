<template>
    <li>
        <div>
            <v-list-item :style="indentStyle" :active="item.selected" density="comfortable" @click="$emit('select', item)">
                <button v-if="hasVisibleChildren" type="button" class="ferry-ib" style="margin-right: 4px"
                    :aria-label="isExpanded ? $i18n('ferry_group_collapse') : $i18n('ferry_group_expand')" @click.stop="toggleExpand">
                    <tabler-chevron-down v-if="isExpanded" class="ferry-ico" />
                    <tabler-chevron-right v-else class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ isExpanded ? $i18n("ferry_group_collapse") : $i18n("ferry_group_expand") }}</v-tooltip>
                </button>
                <tabler-folder class="ferry-ico" style="color: var(--ferry-faint); margin-right: 8px; vertical-align: -3px" />
                <span>{{ item.text }}</span>
            </v-list-item>
            <v-item-group v-if="hasVisibleChildren" v-model="isExpanded">
                <ul v-show="isExpanded">
                    <TreeItem
                        v-for="child in filteredChildren" :key="child.id" :item="child"
                        :indent-level="indentLevel + 1" @select="(item) => handleSelect(item)"></TreeItem>
                </ul>
            </v-item-group>
        </div>
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
            isExpanded: true
        };
    },
    computed: {
        hasVisibleChildren() {
            return this.item.visibleChildIds.length > 0;
        },
        indentStyle() {
            return {
                // expand/contract icon is 2rem wide
                paddingLeft: this.hasVisibleChildren ? `${(this.indentLevel) + 0.25}rem` : `${(this.indentLevel) + 2.25}rem`
            };
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
