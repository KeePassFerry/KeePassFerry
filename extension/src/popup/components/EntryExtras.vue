<template>
    <div v-if="notes || fields.length || attachments.length" class="ferry-extras">
        <div v-if="notes" class="ferry-row ferry-extra-click" @click="showNotes">
            <span class="ferry-row-icon"><tabler-note class="ferry-ico" /></span>
            <span class="ferry-row-value">
                <span class="ferry-extra-label">{{ $i18n("ferry_extras_notes") }}</span>{{ notesPreview }}
            </span>
            <button type="button" class="ferry-ib" :class="{ ok: copied === 'notes' }" :aria-label="$i18n('copy_value_to_clipboard')" @click.stop="copy('notes', notes)">
                <tabler-check v-if="copied === 'notes'" class="ferry-ico" />
                <tabler-copy v-else class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("copy_value_to_clipboard") }}</v-tooltip>
            </button>
        </div>
        <div v-for="f of fields" :key="'f:' + f.name" class="ferry-row">
            <span class="ferry-row-icon">
                <tabler-lock v-if="f.isProtected" class="ferry-ico" />
                <tabler-text-caption v-else class="ferry-ico" />
            </span>
            <span class="ferry-row-value" :class="{ secret: f.isProtected && revealed[f.name] === undefined }">
                <span class="ferry-extra-label">{{ f.name }}</span>{{ fieldDisplay(f) }}
            </span>
            <button
                v-if="f.isProtected" type="button" class="ferry-ib"
                :aria-label="revealed[f.name] !== undefined ? $i18n('ferry_generator_hide') : $i18n('ferry_generator_show')" @click="toggleReveal(f)">
                <tabler-eye-off v-if="revealed[f.name] !== undefined" class="ferry-ico" />
                <tabler-eye v-else class="ferry-ico" />
                <v-tooltip location="start" activator="parent">
                    {{ revealed[f.name] !== undefined ? $i18n("ferry_generator_hide") : $i18n("ferry_generator_show") }}
                </v-tooltip>
            </button>
            <button type="button" class="ferry-ib" :class="{ ok: copied === f.name }" :aria-label="$i18n('copy_value_to_clipboard')" @click="copyField(f)">
                <tabler-check v-if="copied === f.name" class="ferry-ico" />
                <tabler-copy v-else class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("copy_value_to_clipboard") }}</v-tooltip>
            </button>
        </div>
        <div v-for="a of attachments" :key="'a:' + a.name" class="ferry-row ferry-extra-click" @click="openAttachment(a)">
            <span class="ferry-row-icon"><tabler-paperclip class="ferry-ico" /></span>
            <span class="ferry-row-value">
                {{ a.name }} <span class="ferry-extra-size">{{ size(a.size) }}</span>
            </span>
            <button v-if="!isImage(a.name) && canOpenExternally(a.name)" type="button" class="ferry-ib" :aria-label="$i18n('ferry_attachment_open_external')" @click.stop="openExternal(a.name)">
                <tabler-external-link class="ferry-ico" />
                <v-tooltip location="top" activator="parent">{{ $i18n("ferry_attachment_open_external") }}</v-tooltip>
            </button>
            <button type="button" class="ferry-ib" :aria-label="isImage(a.name) ? $i18n('ferry_attachment_show') : $i18n('ferry_attachment_save')" @click.stop="openAttachment(a)">
                <tabler-eye v-if="isImage(a.name)" class="ferry-ico" />
                <tabler-download v-else class="ferry-ico" />
                <v-tooltip location="top" activator="parent">{{ isImage(a.name) ? $i18n("ferry_attachment_show") : $i18n("ferry_attachment_save") }}</v-tooltip>
            </button>
        </div>
    </div>
    <div v-if="error" class="ferry-hint err ferry-extras-error">{{ error }}</div>
    <ExtraPreview
        :open="preview.open" :title="preview.title" :blob="preview.blob" :text="preview.text" :file-name="preview.title"
        :external="!!preview.blob" @close="preview.open = false" @open-external="openExternal(preview.title)" />
</template>

<script lang="ts">
import ExtraPreview from "./ExtraPreview.vue";
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import { canOpenExternally, formatSize, isImageName, loadAttachment, loadFieldValue, openAttachmentExternally, saveBlob } from "../extras";

// Aufgeklappter Eintrag: Notiz, eigene Felder (z. B. Wiederherstellungscodes) und Anhänge des Eintrags.
// Geschützte Werte und Anhänge werden erst auf Klick aus KeePass geholt.
export default {
    components: { ExtraPreview },
    props: ["uuid", "dbFileName"],
    data: () => ({
        notes: "",
        fields: [] as { name: string; isProtected: boolean; value: string }[],
        attachments: [] as { name: string; size: number }[],
        revealed: {} as Record<string, string>,
        copied: null as string,
        error: null as string,
        preview: { open: false, title: "", blob: null as Blob, text: null as string }
    }),
    computed: {
        notesPreview: function (): string {
            const first = (this.notes ?? "").split(/\r?\n/).find(l => l.trim()) ?? "";
            return first.length > 80 ? first.slice(0, 80) + " …" : first;
        }
    },
    mounted: async function () {
        try {
            const r = await chrome.runtime.sendMessage({ keepassferry: "getEntryExtras", uuid: this.uuid, dbFileName: this.dbFileName });
            this.notes = (r?.notes ?? "").trim();
            this.fields = r?.fields ?? [];
            this.attachments = r?.attachments ?? [];
        } catch (e) {
            // ohne Zusatzbereich
        }
    },
    methods: {
        isImage: isImageName,
        canOpenExternally,
        size: formatSize,
        fieldDisplay: function (f: { name: string; isProtected: boolean; value: string }): string {
            if (!f.isProtected) return f.value ?? "";
            return this.revealed[f.name] ?? "••••••••";
        },
        toggleReveal: async function (f: { name: string }) {
            if (this.revealed[f.name] !== undefined) {
                const { [f.name]: _, ...rest } = this.revealed;
                this.revealed = rest;
                return;
            }
            const value = await loadFieldValue(this.uuid, this.dbFileName, f.name);
            if (value === null || value === undefined) this.error = this.$i18n("ferry_extras_load_failed");
            else this.revealed = { ...this.revealed, [f.name]: value };
        },
        copy: async function (key: string, value: string) {
            await copyStringToClipboard(value);
            this.copied = key;
            setTimeout(() => (this.copied = null), 1500);
        },
        copyField: async function (f: { name: string; isProtected: boolean; value: string }) {
            const value = f.isProtected ? this.revealed[f.name] ?? (await loadFieldValue(this.uuid, this.dbFileName, f.name)) : f.value;
            if (value === null || value === undefined) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            await this.copy(f.name, value);
        },
        // Das Plugin öffnet eine temporäre Kopie und löscht sie selbst wieder
        openExternal: async function (name: string) {
            this.error = null;
            if (!(await openAttachmentExternally(this.uuid, this.dbFileName, name))) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            this.preview.open = false;
        },
        showNotes: function () {
            this.preview = { open: true, title: this.$i18n("ferry_extras_notes"), blob: null, text: this.notes };
        },
        openAttachment: async function (a: { name: string }) {
            this.error = null;
            const blob = await loadAttachment(this.uuid, this.dbFileName, a.name);
            if (!blob) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            if (isImageName(a.name)) this.preview = { open: true, title: a.name, blob, text: null };
            else saveBlob(blob, a.name);
        }
    }
};
</script>

<style>
/* Feine Linie zwischen Anmeldedaten (Benutzer, Passwort, Code) und Notizen/Feldern/Anhängen */
.ferry-extras {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--ferry-line);
}
.ferry-extra-click {
    cursor: pointer;
}
.ferry-extra-click:hover .ferry-row-value {
    color: rgb(var(--v-theme-primary));
}
.ferry-extra-label {
    margin-right: 6px;
    color: var(--ferry-muted);
    font-size: 12px;
}
.ferry-extra-size {
    margin-left: 4px;
    color: var(--ferry-muted);
    font-size: 12px;
}
.ferry-extras-error {
    padding-left: 44px;
}
</style>
