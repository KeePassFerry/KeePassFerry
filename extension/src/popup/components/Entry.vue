<template>
    <div
        ref="card" class="ferry-entry" :class="{ open: expanded }" :data-index="dataIndex" tabindex="0"
        @focusin="focusin" @focusout="focusout"
        @keyup.context-menu.stop.prevent="showFullDetails" @keyup.arrow-down.stop.prevent="nextInList"
        @keyup.arrow-up.stop.prevent="prevInList" @keyup.arrow-right.stop.prevent="showFullDetails"
        @keyup.arrow-left.stop.prevent="hideFullDetails" @keyup.escape.stop.prevent="exitList"
        @keyup.enter.self.stop.prevent="primaryClickAction" @keyup.enter.ctrl.self.stop.prevent="loadInNewTab">
        <div
            class="ferry-entry-head" @click.left.exact="primaryClickAction" @click.middle.exact="loadInNewTab"
            @click.left.ctrl="loadInNewTab" @click.middle.ctrl="primaryClickAction" @click.right.stop.prevent="showFullDetails">
            <span class="ferry-tile">
                <img v-if="iconSrc" :src="iconSrc" alt="" />
                <tabler-key v-else class="ferry-ico" />
            </span>
            <span class="ferry-entry-text">
                <span class="ferry-entry-title">{{ entrySummary.title }}</span>
                <span class="ferry-entry-sub">
                    {{ expanded && entrySummary.fullDetails ? metaLine : usernameDisplayValue }}
                    <v-tooltip v-if="expanded && entrySummary.fullDetails" location="bottom" activator="parent">
                        {{ fullEntryPath }} · {{ entrySummary.url }}
                    </v-tooltip>
                </span>
            </span>
            <button
                v-if="expanded && entrySummary.fullDetails" type="button" class="ferry-ib"
                :aria-label="$i18n('ferry_edit_entry')" @click.stop="editEntry">
                <tabler-pencil class="ferry-ico" />
                <v-tooltip location="top" activator="parent">{{ $i18n("ferry_edit_entry") }}</v-tooltip>
            </button>
            <button
                type="button" class="ferry-ib" :aria-label="expanded ? $i18n('ferry_hide_details') : $i18n('ferry_show_details')"
                @click.stop="toggleFullDetails">
                <tabler-chevron-up v-if="expanded" class="ferry-ico" />
                <tabler-chevron-down v-else class="ferry-ico" />
            </button>
        </div>
        <div v-if="expanded && entrySummary.fullDetails" class="ferry-entry-details">
            <Field
                v-for="f of allFields" :key="f.uuid" :field="f" :kind="fillKind(f)"
                :uuid="entrySummary.uuid" :db-file-name="entrySummary.dbFileName" />
            <OtpRow :uuid="entrySummary.uuid" :db-file-name="entrySummary.dbFileName" />
            <v-checkbox
                v-if="isMatchedEntry" :label="$i18n('preferred_matching_entry')"
                :model-value="entrySummary.isPreferredMatch" hide-details class="ferry-pref"
                @update:model-value="onPreferredEntryClick" />
        </div>
    </div>
</template>

<script lang="ts">
import Field from "./Field.vue";
import OtpRow from "./OtpRow.vue";
import { AddonMessage } from "../../common/AddonMessage";
import { Port } from "../../common/port";
import useStore from "../../store";
import { KeeURL } from "../../common/KeeURL";
import { Action } from "../../common/Action";
import { supplementEntryState } from "../supplementEntryState";
import { reconcileURLs } from "../reconcileURLs";
import { SaveState } from "../../common/SaveState";
import { Entry } from "../../common/model/Entry";
import { EntrySummary } from "../../common/model/EntrySummary";
import { tooltipDelay } from "../../common/Timings";
import { mapState } from "pinia";
import { $STR } from "~/common/DollarPolyfills";

export default {
    components: { Field, OtpRow },
    props: ["entrySummary", "isFirstInAList", "entryIndex", "frameId", "dataIndex", "startExpanded", "noNavigate"],
    emits: ["move-next-in-list", "move-prev-in-list", "move-out-of-list", "pref-entry-toggle"],
    setup() {
        const { updateSaveState } = useStore();
        return { updateSaveState };
    },
    data: (vm: any) => ({
        expanded: !!vm.startExpanded,
        focussed: false,
        tooltipDelay: tooltipDelay
    }),
    computed: {
        ...mapState(useStore, ["saveState"]),
        iconSrc: function () {
            const data = (this.entrySummary as EntrySummary)?.icon?.iconImageData;
            return data ? "data:image/png;base64," + data : null;
        },
        // Aufgeklappt: Gruppe und Domain in einer Zeile statt zwei eigener Zeilen
        metaLine: function () {
            const group = (this.entrySummary.fullDetails as Entry)?.parentGroup?.path ?? "";
            return [group, this.entryDomain].filter(Boolean).join(" · ");
        },
        usernameDisplayValue: function () {
            const e = this.entrySummary as EntrySummary;
            return e && e.usernameValue
                ? e.usernameValue
                : "[" + $STR("noUsername_partial_tip") + "]";
        },
        tabindex: function () {
            return "0"; //this.isFirstInAList ? "0" : "-1"; // new treeview component needs this to be 0 for everything
        },
        allFields: function () {
            const e = this.entrySummary.fullDetails as Entry;
            return e.fields;
        },
        entryDomain: function () {
            const urlStr = this.entrySummary.url;
            if (!urlStr || urlStr.length < 4) return "<unknown>";
            const kurl = KeeURL.fromString(urlStr);
            if (!kurl) {
                return "<error>";
            }
            return kurl.domainWithPort || kurl.url.host;
        },
        entryPath: function () {
            if (!this.entryPathIsLong) {
                return this.fullEntryPath;
            }
            const e = this.entrySummary.fullDetails as Entry;
            return "... > " + e.parentGroup.path;
        },
        entryPathIsLong: function () {
            return this.fullEntryPath.length > 35;
        },
        fullEntryPath: function () {
            const e = this.entrySummary.fullDetails as Entry;
            return e.database.name + " > " + e.parentGroup.path;
        },
        isMatchedEntry: function () {
            const e = this.entrySummary as EntrySummary;
            return typeof e.isPreferredMatch === "boolean";
        }
    },
    methods: {
        // Benutzername- und Passwortzeile können in die Seite eingetragen werden, andere Felder nicht
        fillKind(f) {
            const e = this.entrySummary.fullDetails as Entry;
            if (f.type === "password") return "password";
            return f === Entry.getUsernameField(e) ? "username" : null;
        },
        toggleFullDetails() {
            if (!this.expanded) {
                this.showFullDetails();
            } else {
                this.hideFullDetails();
            }
        },
        showFullDetails() {
            if (!this.expanded && !this.entrySummary.fullDetails) {
                Port.postMessage({
                    findMatches: {
                        uuid: this.entrySummary.uuid,
                        DBfilename: this.entrySummary.dbFileName
                    }
                } as AddonMessage);
            }
            this.expanded = true;
        },
        hideFullDetails() {
            this.expanded = false;
        },
        async editEntry() {
            const ss = this.saveState as SaveState;
            const entry = this.entrySummary.fullDetails as Entry;
            const updatedSaveState = Object.assign({}, ss);
            // Gerade abgeschickte Anmeldedaten nur übernehmen, wenn sie von derselben Website stammen (Passwort
            // geändert); sonst ist es reines Bearbeiten: Adressen und Felder bleiben, keine Warnung
            const submittedDomain = KeeURL.fromString(ss.submittedData?.url ?? "")?.domainOrIPAddress;
            const sameSite =
                !!submittedDomain && entry.URLs.some(u => KeeURL.fromString(u)?.domainOrIPAddress === submittedDomain);
            if (sameSite) {
                const { urls, showWarning } = await reconcileURLs(entry.URLs, ss.submittedData.url);
                updatedSaveState.newEntry = supplementEntryState(entry, ss, urls);
                updatedSaveState.showURLMismatchWarning = showWarning;
            } else {
                updatedSaveState.newEntry = supplementEntryState(entry, { ...ss, submittedData: null }, entry.URLs);
                updatedSaveState.showURLMismatchWarning = false;
            }
            updatedSaveState.titleResetValue = entry.title;
            updatedSaveState.lastActiveAt = new Date();
            //TODO: Confirm that we don't have to roundtrip JSON here too
//            this.updateSaveState(JSON.parse(JSON.stringify(updatedSaveState)));
            this.updateSaveState(updatedSaveState);
        },
        focusin: function (e) {
            if (!(this.$refs.card as HTMLElement).contains(e.relatedTarget)) {
                this.focussed = true;
            }
        },
        focusout: function (e) {
            if (!(this.$refs.card as HTMLElement).contains(e.relatedTarget)) {
                this.focussed = false;
            }
        },
        focusRow: function () {
            (this.$refs.card as HTMLElement)?.focus();
        },
        async primaryClickAction() {
            // Einträge der aktuellen Seite ohne Formular: nur auf-/zuklappen (Kopieren, Einmalcode), nicht wegnavigieren
            if (this.noNavigate) {
                this.toggleFullDetails();
                return;
            }
            if (this.entryIndex !== undefined) {
                // We are expected to fill an already discovered entry
                this.manualFill();
            } else {
                this.loadInSameTab();
            }
        },
        loadInSameTab() {
            chrome.tabs.update({ url: this.entrySummary.url });
            window.close();
        },
        loadInNewTab() {
            chrome.tabs.create({ url: this.entrySummary.url });
            window.close();
        },
        manualFill() {
            Port.postMessage({
                action: Action.ManualFill,
                selectedEntryIndex: this.entryIndex,
                frameId: this.frameId
            });
            window.close();
        },
        nextInList() {
            this.$emit("move-next-in-list");
        },
        prevInList() {
            this.$emit("move-prev-in-list");
        },
        exitList() {
            this.$emit("move-out-of-list");
        },
        onPreferredEntryClick() {
            // json may be unncessary
            this.$emit("pref-entry-toggle", { uuid: JSON.parse(JSON.stringify(this.entrySummary.uuid)) });
        }
    }
};
</script>

<style>
.ferry-entry {
    border-bottom: 1px solid var(--ferry-line);
    outline: none;
}
.ferry-entry:focus-visible {
    box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}
.ferry-entry.open {
    background: var(--ferry-tint);
}
.ferry-entry-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 54px;
    padding: 8px 8px 8px 12px;
    cursor: pointer;
}
.ferry-entry:not(.open) .ferry-entry-head:hover {
    background: var(--ferry-hover);
}
.ferry-entry.open .ferry-tile {
    background: rgb(var(--v-theme-surface));
}
.ferry-entry-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}
.ferry-entry-title {
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ferry-entry-sub {
    font-size: 12px;
    color: var(--ferry-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ferry-entry-details {
    padding: 0 8px 8px 12px;
}
.ferry-pref {
    margin: 2px 0 0 38px;
}
.ferry-pref .v-label {
    font-size: 12.5px;
}
</style>
