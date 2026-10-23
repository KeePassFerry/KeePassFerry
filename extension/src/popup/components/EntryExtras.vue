<template>
    <!-- Jede Zeile: Auge "Anzeigen" in derselben Spalte wie beim Passwort, rechts daneben "Kopieren" nur bei Feldern -->
    <div v-if="notes || fields.length || attachments.length" class="ferry-extras">
        <div v-if="notes" class="ferry-row ferry-extra-click" @click="showNotes">
            <span class="ferry-row-icon"><tabler-note class="ferry-ico" /></span>
            <span class="ferry-row-value">
                <span class="ferry-extra-label">{{ $i18n("ferry_extras_notes") }}</span>{{ notesPreview }}
            </span>
            <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_attachment_show')" @click.stop="showNotes">
                <tabler-eye class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("ferry_attachment_show") }}</v-tooltip>
            </button>
            <span class="ferry-ib-space" />
        </div>
        <div v-for="f of fields" :key="'f:' + f.name" class="ferry-row">
            <span class="ferry-row-icon">
                <tabler-lock v-if="f.isProtected" class="ferry-ico" />
                <tabler-text-caption v-else class="ferry-ico" />
            </span>
            <span class="ferry-row-value" :class="{ secret: f.isProtected }">
                <span class="ferry-extra-label">{{ f.name }}</span>{{ f.isProtected ? "••••••••" : f.value }}
            </span>
            <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_attachment_show')" @click="showField(f)">
                <tabler-eye class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("ferry_attachment_show") }}</v-tooltip>
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
            <button type="button" class="ferry-ib" :aria-label="attachmentAction(a.name)" @click.stop="openAttachment(a)">
                <tabler-eye v-if="canOpenExternally(a.name)" class="ferry-ico" />
                <tabler-download v-else class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ attachmentAction(a.name) }}</v-tooltip>
            </button>
            <span class="ferry-ib-space" />
        </div>
    </div>
    <div v-if="error" class="ferry-hint err ferry-extras-error">{{ error }}</div>
    <ExtraPreview
        :open="preview.open" :title="preview.title" :blob="preview.blob" :text="preview.text" :file-name="preview.title"
        :external="preview.external" :codes="preview.codes" @close="closePreview"
        @open-external="preview.blob ? openExternal(preview.title) : openNotesExternal()" />
</template>

<script lang="ts">
import ExtraPreview from "./ExtraPreview.vue";
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import {
    canOpenExternally, formatSize, isImageName, loadAttachment, loadFieldValue, openAttachmentExternally, openNotesExternally, saveBlob
} from "../extras";

// Aufgeklappter Eintrag: Notiz, eigene Felder (z. B. Wiederherstellungscodes) und Anhänge des Eintrags.
// Geschützte Werte und Anhänge werden erst auf Klick aus KeePass geholt.
export default {
    components: { ExtraPreview },
    props: ["uuid", "dbFileName", "title"],
    data: () => ({
        notes: "",
        fields: [] as { name: string; isProtected: boolean; value: string }[],
        attachments: [] as { name: string; size: number }[],
        copied: null as string,
        error: null as string,
        // external: Knopf "Mit Standardprogramm öffnen" in der Vorschau (Notizen, Bilder)
        preview: { open: false, title: "", blob: null as Blob, text: null as string, external: false, codes: false }
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
        copy: async function (key: string, value: string) {
            await copyStringToClipboard(value);
            this.copied = key;
            setTimeout(() => (this.copied = null), 1500);
        },
        copyField: async function (f: { name: string; isProtected: boolean; value: string }) {
            const value = f.isProtected ? await loadFieldValue(this.uuid, this.dbFileName, f.name) : f.value;
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
        openNotesExternal: async function () {
            this.error = null;
            if (!(await openNotesExternally(this.uuid, this.dbFileName, this.title))) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            this.preview.open = false;
        },
        // Beim Schließen auch den (evtl. geschützten) Text vergessen
        closePreview: function () {
            this.preview = { open: false, title: "", blob: null, text: null, external: false, codes: false };
        },
        showNotes: function () {
            this.preview = { open: true, title: this.$i18n("ferry_extras_notes"), blob: null, text: this.notes, external: true, codes: false };
        },
        // Geschützte Werte (z. B. Wiederherstellungscodes) erst jetzt aus KeePass holen; Zeilen einzeln kopierbar
        showField: async function (f: { name: string; isProtected: boolean; value: string }) {
            this.error = null;
            const value = f.isProtected ? await loadFieldValue(this.uuid, this.dbFileName, f.name) : f.value ?? "";
            if (value === null || value === undefined) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            this.preview = { open: true, title: f.name, blob: null, text: value, external: false, codes: f.isProtected };
        },
        // Bild: Vorschau; PDF/Text: Standardprogramm; alles andere: Speichern unter
        attachmentAction: function (name: string): string {
            return canOpenExternally(name) ? this.$i18n("ferry_attachment_show") : this.$i18n("ferry_attachment_save");
        },
        openAttachment: async function (a: { name: string }) {
            this.error = null;
            if (!isImageName(a.name) && canOpenExternally(a.name)) {
                await this.openExternal(a.name);
                return;
            }
            const blob = await loadAttachment(this.uuid, this.dbFileName, a.name);
            if (!blob) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            if (isImageName(a.name)) this.preview = { open: true, title: a.name, blob, text: null, external: true, codes: false };
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
/* Platzhalter in Breite eines Symbol-Knopfs, damit das Auge in allen Zeilen in derselben Spalte steht */
.ferry-ib-space {
    width: 32px;
    flex: none;
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
