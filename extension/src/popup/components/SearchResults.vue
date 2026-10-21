<template>
    <div id="searchPanel" class="ferry-list">
        <div v-show="filteredMatches && filteredMatches.length > 0" class="ferry-caption">{{ $i18n("ferry_popup_this_site") }}</div>
        <Entry
v-for="(match, index) of filteredMatches" :key="match.entry.uuid" :ref="setNodesA"
            :entrySummary="match.entry" :isFirstInAList="index === 0" :frame-id="frameId"
            :entry-index="match.originalIndex" :dataIndex="index" @move-next-in-list="
                nextInList(index, 'listAarray', filteredMatches.length)
            " @move-prev-in-list="
    prevInList(index, 'listAarray')
" @move-out-of-list="exitList"
@pref-entry-toggle="onPreferredEntryClick"  />

        <!-- Seite ohne Anmeldeformular: Einträge dieser Website, der zuletzt benutzte aufgeklappt (Einmalcode sichtbar) -->
        <template v-if="siteSummaries.length > 0 && !(filteredMatches && filteredMatches.length > 0)">
            <div class="ferry-caption">{{ $i18n("ferry_popup_this_site") }}</div>
            <Entry
v-for="(entry, index) of siteSummaries" :key="'site-' + entry.uuid"
                :entrySummary="entry" :isFirstInAList="index === 0" :dataIndex="index"
                :start-expanded="index === 0" :no-navigate="true" />
        </template>

        <div v-show="deduplicatedSearchResults && deduplicatedSearchResults.length > 0" class="ferry-caption">
            {{ currentSearchTerm ? $i18n("ferry_popup_search_results") : $i18n("matches_from_other_sites") }}
        </div>

        <Entry
v-for="(entry, index) of deduplicatedSearchResults" :key="entry.uuid" :ref="setNodesB"
            :entrySummary="entry" :isFirstInAList="index === 0" :dataIndex="index"
            @move-next-in-list="nextInList(index, 'listBarray', deduplicatedSearchResults.length)"
            @move-prev-in-list="prevInList(index, 'listBarray')" @move-out-of-list="exitList" />
    </div>
</template>

<script lang="ts">
import Entry from "./Entry.vue";
import { KeeLog } from "../../common/Logger";
import { EntrySummary } from "../../common/model/EntrySummary";
import { Entry as ModelEntry } from "../../common/model/Entry";
import { SearcherMatchedOnly } from "../../common/SearcherMatchedOnly";
import { mapState } from "pinia";
import useStore from "../../store";

export default {
    components: { Entry },
    props: ["matchedEntriesIn", "siteEntriesIn", "frameId"],
    emits: ["pref-entry-toggle"],
    data() {
        return {
            filteredMatches: null,
            uidMap: new Map<string, number>(),
            aNodes: [],
            bNodes: [],
            searchOnlyMatches: null as SearcherMatchedOnly,
            matchedEntries: this.$props.matchedEntriesIn
        };
    },
    computed: {
        ...mapState(useStore, ["currentSearchTerm", "searchResults"]),
        siteSummaries: function () {
            if (this.currentSearchTerm) return [];
            return ((this.siteEntriesIn as ModelEntry[]) ?? []).map(e => EntrySummary.fromEntry(e));
        },
        deduplicatedSearchResults: function () {
            if (this.searchResults) {
                if (this.matchedEntries) {
                    return this.searchResults.filter(
                        e => !this.matchedEntries.some(m => m.uuid === e.uuid)
                    );
                } else {
                    return this.searchResults;
                }
            }
            return null;
        }
    },
    watch: {
        matchedEntries: function (newVal) {
            KeeLog.debug("about to reinit");
            this.initAndSearchMatchedEntries(newVal);
        },
        currentSearchTerm: function (newVal) {
            KeeLog.debug("about to reexecute");
            this.searchOnlyMatches.execute(
                newVal,
                this.onSearchOnlyMatchesComplete.bind(this)
            );
        }
    },
    beforeUpdate() {
        this.aNodes = [];
        this.bNodes = [];
    },
    created() {
        KeeLog.debug("created. about to init");
        this.initAndSearchMatchedEntries(this.matchedEntries);
    },
    methods: {
        setNodesA(node) {
            if (node) this.aNodes.push(node);
        },
        setNodesB(node) {
            if (node) this.bNodes.push(node);
        },
        onSearchOnlyMatchesComplete(entrySummaries: EntrySummary[]) {
            KeeLog.debug("onSearchOnlyMatchesComplete");
            entrySummaries = entrySummaries.sort(function (a, b) {
                if (a.relevanceScore > b.relevanceScore) return -1;
                if (a.relevanceScore < b.relevanceScore) return 1;
                return 0;
            });
            this.filteredMatches = entrySummaries.map(m => ({
                entry: m,
                originalIndex: this.uidMap.get(m.uuid)
            }));
        },
        nextInList(currentIndex: number, listName: string, listLength: any) {
            const currentVueNode = (listName === "listAarray" ? this.aNodes : this.bNodes).find(
                e => {
            return parseInt(e.dataIndex) === currentIndex;
                }
            );
            const nodes = listName === "listAarray" ? this.aNodes : this.bNodes;
            if (currentIndex < listLength - 1) {
                nodes.find(e => parseInt(e.dataIndex) === currentIndex + 1)?.focusRow();
            } else if (listName === "listAarray" && this.deduplicatedSearchResults?.length > 0) {
                this.bNodes.find(e => parseInt(e.dataIndex) === 0)?.focusRow();
            }
            void currentVueNode;
        },
        prevInList(currentIndex: number, listName: string) {
            const currentVueNode = (listName === "listAarray" ? this.aNodes : this.bNodes).find(
                e => parseInt(e.dataIndex) === currentIndex
            );
            const nodes = listName === "listAarray" ? this.aNodes : this.bNodes;
            void currentVueNode;
            if (currentIndex > 0) {
                nodes.find(e => parseInt(e.dataIndex) === currentIndex - 1)?.focusRow();
            } else if (listName === "listBarray" && this.filteredMatches?.length > 0) {
                this.aNodes.find(e => parseInt(e.dataIndex) === this.filteredMatches.length - 1)?.focusRow();
            } else {
                (document.getElementById("searchBox") as HTMLInputElement).focus();
            }
        },
        exitList() {
            (document.getElementById("searchBox") as HTMLInputElement).focus();
        },
        initAndSearchMatchedEntries(matchedEntries: ModelEntry[]) {
            if (matchedEntries) {
                for (let i = 0; i < matchedEntries.length; i++) {
                    this.uidMap.set(matchedEntries[i].uuid, matchedEntries[i].entryIndex);
                }
            }
            this.searchOnlyMatches = new SearcherMatchedOnly(
                matchedEntries?.map(e => EntrySummary.fromEntry(e))
            );
            KeeLog.debug("about to execute");
            this.searchOnlyMatches.execute(
                this.currentSearchTerm,
                this.onSearchOnlyMatchesComplete.bind(this)
            );
        },
        onPreferredEntryClick(payload: any) {
            this.$emit("pref-entry-toggle", payload);
        }
    }
};
</script>
