<template>
    <div ref="group" class="ferry-group">
        <div class="ferry-group-title">{{ $i18n("ferry_extras_heading") }}</div>
        <div
            v-for="r of rows" :key="r.key" class="ferry-extra" :class="{ removed: r.removed, highlight: highlighted === r.key }"
            :data-key="r.key">
            <span class="ferry-extra-icon">
                <tabler-paperclip v-if="r.type === 'attachment'" class="ferry-ico" />
                <tabler-shield-lock v-else-if="r.type === 'totp'" class="ferry-ico" />
                <tabler-note v-else-if="r.type === 'notes'" class="ferry-ico" />
                <tabler-lock v-else-if="r.isProtected" class="ferry-ico" />
                <tabler-text-caption v-else class="ferry-ico" />
            </span>
            <span v-if="renaming === r.key" class="ferry-extra-text">
                <v-text-field
                    ref="rename" v-model="renameValue" density="compact" hide-details autofocus
                    :label="$i18n('ferry_add_image_name')" @keyup.enter.stop="finishRename(r)" @keyup.esc.stop="renaming = null"
                    @blur="finishRename(r)" />
            </span>
            <span
                v-else class="ferry-extra-text" :class="{ clickable: canOpen(r) }" :role="canOpen(r) ? 'button' : undefined"
                :tabindex="canOpen(r) ? 0 : undefined" @click="openRow(r)" @keyup.enter.stop="openRow(r)">
                <span class="ferry-extra-name">
                    {{ r.name }}
                    <span v-if="r.isNew" class="ferry-badge">{{ $i18n("ferry_extras_new") }}</span>
                    <span v-else-if="r.newValue !== undefined && !r.removed" class="ferry-badge">{{ $i18n("ferry_extras_changed") }}</span>
                    <span v-if="r.removed" class="ferry-badge warn">{{ $i18n("ferry_extras_removed") }}</span>
                </span>
                <span v-if="r.sub" class="ferry-extra-sub">
                    {{ r.sub }}
                </span>
                <v-tooltip v-if="canOpen(r)" location="top" activator="parent">{{ openLabel(r) }}</v-tooltip>
            </span>
            <button
                v-if="r.isNew && r.type === 'attachment' && renaming !== r.key" type="button" class="ferry-ib"
                :aria-label="$i18n('ferry_extras_rename')" @click="startRename(r)">
                <tabler-pencil class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("ferry_extras_rename") }}</v-tooltip>
            </button>
            <button
                v-if="(r.type === 'notes' || r.type === 'field') && !r.removed" type="button" class="ferry-ib"
                :class="{ active: editing === r }" :aria-label="$i18n('ferry_extras_edit')" @click="startEdit(r)">
                <tabler-pencil class="ferry-ico" />
                <v-tooltip location="start" activator="parent">{{ $i18n("ferry_extras_edit") }}</v-tooltip>
            </button>
            <button
                type="button" class="ferry-ib" :class="{ danger: !r.removed }"
                :aria-label="r.removed ? $i18n('ferry_extras_undo') : $i18n('ferry_extras_remove')" @click="toggleRow(r)">
                <tabler-arrow-back-up v-if="r.removed" class="ferry-ico" />
                <tabler-trash v-else class="ferry-ico" />
                <v-tooltip location="start" activator="parent">
                    {{ r.removed ? $i18n("ferry_extras_undo") : $i18n("ferry_extras_remove") }}
                </v-tooltip>
            </button>
        </div>
        <div v-if="unsupported" class="ferry-extra-empty">{{ $i18n("ferry_extras_unsupported") }}</div>
        <div v-else-if="!rows.length && !adding" class="ferry-extra-empty">{{ $i18n("ferry_extras_empty") }}</div>

        <div v-if="editing" ref="editForm" class="ferry-add-form">
            <div class="ferry-add-head">
                <span class="ferry-add-title">{{ $i18n("ferry_extras_edit_heading", [editing.name]) }}</span>
                <button type="button" class="ferry-ib" :aria-label="$i18n('cancel')" @click="editing = null">
                    <tabler-x class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ $i18n("cancel") }}</v-tooltip>
                </button>
            </div>
            <v-textarea
                ref="editValue" v-model="editValue" :label="$i18n('ferry_add_value')" rows="3" auto-grow max-rows="14"
                hide-details autofocus class="ferry-compact-text" />
            <div v-if="editing.type === 'notes' && !editValue.trim() && !editing.isNew" class="ferry-hint">
                {{ $i18n("ferry_extras_notes_cleared") }}
            </div>
            <div class="ferry-add-row">
                <v-spacer />
                <v-btn variant="tonal" color="primary" :disabled="!canApplyEdit" @click="applyEdit">
                    {{ $i18n("ferry_extras_apply") }}
                </v-btn>
            </div>
        </div>

        <button v-if="!editing && !adding && !unsupported" type="button" class="ferry-add-open" @click="openAdd">
            <tabler-plus class="ferry-ico" />
            {{ $i18n("ferry_add_open") }}
        </button>

        <div v-else-if="adding && !editing" class="ferry-add-form">
            <div class="ferry-add-head">
                <span class="ferry-add-title">{{ $i18n("ferry_add_heading") }}</span>
                <button type="button" class="ferry-ib" :aria-label="$i18n('cancel')" @click="closeAdd">
                    <tabler-x class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ $i18n("cancel") }}</v-tooltip>
                </button>
            </div>
            <v-select
                v-model="kind" :items="kindItems" :label="$i18n('ferry_add_kind')" hide-details class="mb-2"
                @update:model-value="kindChanged" />
            <v-text-field
                v-if="kind === 'image'" v-model="imageName" :label="$i18n('ferry_add_image_name')"
                :placeholder="$i18n('ferry_add_image_name_hint')" persistent-placeholder hide-details class="mb-1" />
            <AttachmentPaste
                v-if="kind === 'image'"
                :uuid="uuid" :db-file-name="dbFileName" :title="title" :initial-file="pendingImage"
                @staged-image="stageImage" @staged-totp="stageTotp" />
            <template v-else>
                <v-text-field
                    v-if="kind === 'custom' || kind === 'recovery'" v-model="name"
                    :label="$i18n('ferry_add_name')" hide-details class="mb-2" />
                <v-textarea
                    ref="value" v-model="value" :label="$i18n('ferry_add_value')" :placeholder="$i18n('ferry_add_paste_hint')"
                    rows="2" auto-grow hide-details class="ferry-compact-text" @update:model-value="onValueChanged" />
                <v-btn size="small" variant="text" color="primary" class="ferry-paste-btn" @click="pasteText">
                    <tabler-clipboard-text class="ferry-ico mr-1" />
                    {{ $i18n("ferry_paste_clipboard") }}
                </v-btn>
                <div v-if="clipboardNotice" class="ferry-hint">{{ clipboardNotice }}</div>
                <div v-if="kind === 'totp' && value && !totpUri" class="ferry-hint err">{{ $i18n("ferry_add_totp_invalid") }}</div>
                <div v-else-if="looksLikeTotp" class="ferry-hint">
                    <tabler-shield-lock class="ferry-ico ferry-hint-icon" />
                    <span>{{ $i18n("ferry_add_maybe_totp") }}</span>
                    <v-btn size="x-small" variant="text" color="primary" @click="switchToTotp">
                        {{ $i18n("ferry_add_kind_totp") }}
                    </v-btn>
                </div>
                <div class="ferry-add-row">
                    <v-checkbox
                        v-if="kind === 'recovery' || kind === 'custom'" v-model="protect"
                        :label="$i18n('ferry_add_protect')" hide-details />
                    <v-spacer />
                    <v-btn variant="tonal" color="primary" :disabled="!canAdd" @click="addText">
                        {{ $i18n("ferry_add_button") }}
                    </v-btn>
                </div>
            </template>
        </div>
        <div v-if="!unsupported" class="ferry-add-note">{{ $i18n("ferry_add_saved_directly") }}</div>
    </div>
    <div v-if="error" class="ferry-hint err">{{ error }}</div>
    <ExtraPreview
        :open="preview.open" :title="preview.title" :blob="preview.blob" :text="preview.text" :external="preview.external" :editable="!!preview.editKey" @edit="editFromPreview"
        @close="closePreview" @open-external="preview.blob ? openExternal(preview.title) : openNotesExternal()" />
</template>

<script lang="ts">
import AttachmentPaste from "./AttachmentPaste.vue";
import ExtraPreview from "./ExtraPreview.vue";
import { fillPageField, pageFieldKinds } from "../pageFields";
import { readClipboard } from "../clipboard";
import {
    canOpenExternally, formatSize, takeExtraEdit, isImageName, loadAttachment, loadFieldValue, openAttachmentExternally, openNotesExternally, saveBlob
} from "../extras";

// "Hinzufügen" im Bearbeiten-Fenster: Wiederherstellungscode, Zwei-Faktor-Schlüssel, Notiz, eigenes Feld oder Bild.
// Hinzugefügtes und Entferntes wird nur vorgemerkt (Liste "Im Eintrag" mit Neu/Wird entfernt) und erst mit
// "Speichern" im Bearbeiten-Fenster über commit() ins Plugin geschrieben; "Abbrechen" verwirft alles.
const OTPAUTH_RE = /^otpauth:\/\/totp\/\S+$/i;
const SECRET_RE = /^[A-Z2-7]{16,128}=*$/;

type RowType = "field" | "attachment" | "notes" | "totp";

interface Row {
    key: string;
    type: RowType;
    name: string;
    sub: string;
    isProtected?: boolean;
    isNew?: boolean;
    removed?: boolean;
    // Vorgemerkte Daten (nur bei isNew)
    value?: string;
    uri?: string;
    fileName?: string;
    data?: string;
    blob?: Blob;
    // Geänderter Wert eines vorhandenen Felds bzw. der Notizen (wird mit "Speichern" geschrieben)
    newValue?: string;
}

let nextKey = 1;

export default {
    components: { AttachmentPaste, ExtraPreview },
    props: ["uuid", "dbFileName", "title"],
    emits: ["changed"],
    data: () => ({
        kind: "recovery",
        name: "",
        value: "",
        protect: true,
        pendingImage: null as File,
        adding: false,
        // Älteres Plugin ohne GetEntryExtras/AddEntryText: Bereich nur mit Hinweis
        unsupported: false,
        existing: [] as Row[],
        staged: [] as Row[],
        error: null as string,
        clipboardNotice: null as string,
        imageName: "",
        renaming: null as string,
        renameValue: "",
        editing: null as Row,
        // Kurz hervorgehobene Zeile (Sprung aus der Bildvorschau: dort z. B. löschen)
        highlighted: null as string,
        editValue: "",
        preview: { open: false, title: "", blob: null as Blob, text: null as string, external: false, editKey: null as string }
    }),
    computed: {
        kindItems: function () {
            return [
                { title: this.$i18n("ferry_add_kind_recovery"), value: "recovery" },
                { title: this.$i18n("ferry_add_kind_totp"), value: "totp" },
                { title: this.$i18n("ferry_add_kind_note"), value: "note" },
                { title: this.$i18n("ferry_add_kind_custom"), value: "custom" },
                { title: this.$i18n("ferry_add_kind_image"), value: "image" }
            ];
        },
        rows: function (): Row[] {
            return [...this.existing, ...this.staged];
        },
        totpUri: function (): string {
            return this.uriFor(this.value);
        },
        looksLikeTotp: function (): boolean {
            const t = (this.value ?? "").trim();
            return (this.kind === "recovery" || this.kind === "note") && !!this.uriFor(t) && /[2-7]/.test(t);
        },
        canAdd: function (): boolean {
            if (!(this.value ?? "").trim()) return false;
            if (this.kind === "totp") return !!this.totpUri;
            if (this.kind === "custom" || this.kind === "recovery") return !!(this.name ?? "").trim();
            return true;
        },
        hasChanges: function (): boolean {
            return this.staged.length > 0 || this.existing.some(r => r.removed || r.newValue !== undefined);
        },
        // Leere Notizen sind erlaubt (= Notizen leeren), ein Feld braucht einen Wert
        canApplyEdit: function (): boolean {
            if (!this.editing) return false;
            const empty = !(this.editValue ?? "").trim();
            if (this.editing.type === "notes") return !(empty && this.editing.isNew);
            return !empty;
        }
    },
    watch: {
        hasChanges: function (v: boolean) {
            this.$emit("changed", v);
        }
    },
    mounted: function () {
        this.name = this.$i18n("ferry_add_kind_recovery");
        this.loadExisting();
    },
    methods: {
        uriFor: function (v: string): string {
            const t = (v ?? "").trim();
            if (OTPAUTH_RE.test(t)) return t;
            // Base32 ist einheitlich groß oder klein geschrieben; gemischte Schreibung ist z. B. ein Wiederherstellungscode
            if (/[a-z]/.test(t) && /[A-Z]/.test(t)) return null;
            const secret = t.replace(/[\s-]/g, "").toUpperCase();
            if (!SECRET_RE.test(secret)) return null;
            const label = encodeURIComponent(this.title || "KeePass");
            return `otpauth://totp/${label}?secret=${secret.replace(/=+$/, "")}&issuer=${label}`;
        },
        kindChanged: function () {
            this.value = "";
            this.error = null;
            this.clipboardNotice = null;
            if (this.kind === "recovery") this.name = this.$i18n("ferry_add_kind_recovery");
            if (this.kind === "custom") this.name = "";
            this.focusValue();
        },
        openAdd: function () {
            this.adding = true;
            this.focusValue();
        },
        closeAdd: function () {
            this.adding = false;
            this.value = "";
            this.pendingImage = null;
            this.imageName = "";
            if (this.kind === "image") this.kind = "recovery";
        },
        switchToTotp: function () {
            this.kind = "totp";
            this.focusValue();
        },
        focusValue: function () {
            this.$nextTick(() => (this.$refs.value as any)?.focus?.());
        },
        // Ein otpauth-Link ist eindeutig ein Zwei-Faktor-Schlüssel; ein reiner Base32-Text kann auch ein
        // Wiederherstellungscode sein, dafür nur ein Vorschlag (looksLikeTotp)
        onValueChanged: function () {
            this.error = null;
            if (this.kind !== "totp" && OTPAUTH_RE.test((this.value ?? "").trim())) this.kind = "totp";
        },
        // "Aus Zwischenablage einfügen" bei einer Textart; ein Bild in der Zwischenablage wechselt zu "Bild"
        pasteText: async function () {
            this.clipboardNotice = null;
            const content = await readClipboard();
            if (content === "denied") {
                this.clipboardNotice = this.$i18n("ferry_clipboard_denied");
            } else if (content === "empty") {
                this.clipboardNotice = this.$i18n("ferry_clipboard_empty");
            } else if (content.image) {
                this.pendingImage = content.image;
                this.kind = "image";
            } else {
                this.value = content.text;
                this.onValueChanged();
                this.focusValue();
            }
        },
        loadExisting: async function () {
            try {
                const r = await chrome.runtime.sendMessage({ keepassferry: "getEntryExtras", uuid: this.uuid, dbFileName: this.dbFileName });
                this.unsupported = !r;
                const list: Row[] = [];
                const notes = (r?.notes ?? "").trim();
                if (notes) {
                    list.push({ key: "notes", type: "notes", name: this.$i18n("ferry_extras_notes"), sub: notes.slice(0, 60), value: notes });
                }
                for (const f of r?.fields ?? []) {
                    list.push({
                        key: "f:" + f.name,
                        type: "field",
                        name: f.name,
                        isProtected: f.isProtected,
                        sub: f.isProtected ? "••••••••" : (f.value ?? "").slice(0, 60),
                        value: f.isProtected ? undefined : f.value
                    });
                }
                for (const a of r?.attachments ?? []) {
                    list.push({ key: "a:" + a.name, type: "attachment", name: a.name, sub: formatSize(a.size) });
                }
                this.existing = list;
                // Aus der Vorschau des aufgeklappten Eintrags mit dem Stift gekommen: gleich bearbeiten
                const pendingKey = takeExtraEdit(this.uuid);
                const pendingRow = pendingKey ? list.find(x => x.key === pendingKey) : null;
                if (pendingRow?.type === "attachment") this.highlightRow(pendingRow);
                else if (pendingRow) await this.startEdit(pendingRow);
            } catch (e) {
                this.existing = [];
            }
        },
        addText: function () {
            const value = this.value.trim();
            if (this.kind === "totp") {
                this.stageTotp(this.totpUri);
            } else if (this.kind === "note") {
                this.staged.push({ key: "n" + nextKey++, type: "notes", name: this.$i18n("ferry_add_kind_note"), sub: value.slice(0, 60), isNew: true, value });
            } else {
                this.staged.push({
                    key: "s" + nextKey++,
                    type: "field",
                    name: this.name.trim(),
                    sub: this.protect ? "••••••••" : value.slice(0, 60),
                    isProtected: this.protect,
                    isNew: true,
                    value
                });
            }
            this.value = "";
            this.adding = false;
        },
        stageTotp: async function (uri: string) {
            if (!uri) return;
            this.staged = this.staged.filter(r => r.type !== "totp");
            const row: Row = { key: "t" + nextKey++, type: "totp", name: this.$i18n("ferry_add_kind_totp"), sub: "", isNew: true, uri };
            this.staged.push(row);
            this.closeAdd();
            // Hinweis, wenn der Eintrag schon einen Schlüssel hat (der alte bleibt in der Eintragshistorie)
            try {
                const current = await chrome.runtime.sendMessage({ keepassferry: "getTotp", uuid: this.uuid, dbFileName: this.dbFileName });
                const shown = this.staged.find(r => r.key === row.key);
                if (current?.code && shown) shown.sub = this.$i18n("ferry_add_totp_replaces");
            } catch (e) {
                // ohne Hinweis
            }
        },
        stageImage: function (img: { fileName: string; data: string; size: number; blob: Blob }) {
            this.pendingImage = null;
            const fileName = this.imageName.trim() || img.fileName;
            this.staged.push({
                key: "i" + nextKey++,
                type: "attachment",
                name: this.imageDisplayName(fileName),
                sub: formatSize(img.size),
                isNew: true,
                fileName,
                data: img.data,
                blob: img.blob
            });
            this.closeAdd();
        },
        // Das Plugin hängt die Endung des tatsächlichen Typs an (verkleinerte Bilder sind JPEG);
        // ohne Namen vergibt es Datum und Uhrzeit
        imageDisplayName: function (fileName: string): string {
            if (!fileName) return this.$i18n("ferry_add_kind_image");
            return /\.(jpe?g)$/i.test(fileName) ? fileName : fileName.replace(/\.[a-z0-9]{1,5}$/i, "") + ".jpg";
        },
        startRename: function (r: Row) {
            this.renaming = r.key;
            this.renameValue = r.fileName ? r.name : "";
        },
        finishRename: function (r: Row) {
            if (this.renaming !== r.key) return;
            this.renaming = null;
            const fileName = this.renameValue.trim();
            r.fileName = fileName;
            r.name = this.imageDisplayName(fileName);
        },
        isImage: function (r: Row): boolean {
            return !!r.blob || isImageName(r.name);
        },
        openLabel: function (r: Row): string {
            if (r.type === "attachment" && !this.isImage(r) && !canOpenExternally(r.name)) return this.$i18n("ferry_attachment_save");
            return this.$i18n("ferry_attachment_show");
        },
        canOpen: function (r: Row): boolean {
            if (r.removed) return false;
            return r.type === "attachment" || r.type === "notes" || r.type === "field";
        },
        // Zeile anklicken: Bild/Notiz in der Vorschau, andere Anhänge speichern
        openRow: async function (r: Row) {
            if (!this.canOpen(r)) return;
            this.error = null;
            if (r.type === "field" && r.isProtected) {
                await this.showProtected(r);
                return;
            }
            if (r.type === "notes" || r.type === "field") {
                // Im Standard-Editor nur gespeicherte, unveränderte Notizen (das Plugin öffnet den Stand in KeePass)
                const external = r.type === "notes" && !r.isNew && r.newValue === undefined;
                this.preview = { open: true, title: r.name, blob: null, text: this.currentValue(r), external, editKey: r.key };
                return;
            }
            // Gespeicherte PDF/Text-Anhänge wie im aufgeklappten Eintrag direkt im Standardprogramm
            if (!r.isNew && !this.isImage(r) && canOpenExternally(r.name)) {
                await this.openExternal(r.name);
                return;
            }
            const blob = r.blob ?? (await loadAttachment(this.uuid, this.dbFileName, r.name));
            if (!blob) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            if (this.isImage(r)) this.preview = { open: true, title: r.name, blob, text: null, external: !r.isNew, editKey: null };
            else saveBlob(blob, r.name);
        },
        openNotesExternal: async function () {
            this.error = null;
            if (!(await openNotesExternally(this.uuid, this.dbFileName, this.title))) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            this.preview.open = false;
        },
        openExternal: async function (name: string) {
            this.error = null;
            if (!(await openAttachmentExternally(this.uuid, this.dbFileName, name))) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            this.preview.open = false;
        },
        // Geschützter Wert (z. B. Wiederherstellungscodes) in der Vorschau
        showProtected: async function (r: Row) {
            this.error = null;
            const value = this.currentValue(r) ?? (await loadFieldValue(this.uuid, this.dbFileName, r.name));
            if (value === null || value === undefined) {
                this.error = this.$i18n("ferry_extras_load_failed");
                return;
            }
            this.preview = { open: true, title: r.name, blob: null, text: value, external: false, editKey: r.key };
        },
        highlightRow: function (r: Row) {
            this.highlighted = r.key;
            this.$nextTick(() => {
                const el = (this.$refs.group as HTMLElement)?.querySelector(`[data-key="${CSS.escape(r.key)}"]`);
                el?.scrollIntoView({ block: "nearest" });
            });
            setTimeout(() => {
                if (this.highlighted === r.key) this.highlighted = null;
            }, 2500);
        },
        editFromPreview: function () {
            const row = this.rows.find((x: Row) => x.key === this.preview.editKey);
            this.closePreview();
            if (row && !row.removed) this.startEdit(row);
        },
        closePreview: function () {
            this.preview = { open: false, title: "", blob: null, text: null, external: false, editKey: null };
        },
        currentValue: function (r: Row): string {
            return r.newValue !== undefined ? r.newValue : r.value;
        },
        // Notiz oder Feld bearbeiten; geschützte vorhandene Werte werden erst jetzt aus KeePass geholt
        startEdit: async function (r: Row) {
            this.error = null;
            this.adding = false;
            this.renaming = null;
            let value = this.currentValue(r);
            if (value === undefined) {
                value = await loadFieldValue(this.uuid, this.dbFileName, r.name);
                if (value === null || value === undefined) {
                    this.error = this.$i18n("ferry_extras_load_failed");
                    return;
                }
                // Vergleichswert für "unverändert"
                r.value = value;
            }
            this.editValue = value;
            this.editing = r;
            this.$nextTick(() => (this.$refs.editForm as HTMLElement)?.scrollIntoView({ block: "nearest" }));
        },
        applyEdit: function () {
            const r: Row = this.editing;
            if (!r || !this.canApplyEdit) return;
            const value = this.editValue.trim();
            if (r.isNew) r.value = value;
            else if (value === (r.value ?? "").trim()) r.newValue = undefined;
            else r.newValue = value;
            r.sub = r.isProtected ? "••••••••" : value.slice(0, 60);
            // Leere Notizen = Notizen entfernen
            if (!r.isNew && r.type === "notes" && !value) {
                r.newValue = undefined;
                r.removed = true;
            }
            this.editing = null;
        },
        toggleRow: function (r: Row) {
            if (this.editing === r) this.editing = null;
            if (r.isNew) this.staged = this.staged.filter(x => x !== r);
            else r.removed = !r.removed;
        },
        // Vorgemerktes ins Plugin schreiben; liefert true, wenn alles geklappt hat
        commit: async function (): Promise<boolean> {
            const send = (msg: Record<string, unknown>) =>
                chrome.runtime.sendMessage({ uuid: this.uuid, dbFileName: this.dbFileName, ...msg });
            let ok = true;
            let totpSaved = false;
            for (const r of this.existing.filter(x => x.removed)) {
                const kind = r.type === "attachment" ? "attachment" : r.type === "notes" ? "notes" : "field";
                const name = r.type === "notes" ? "Notes" : r.name;
                if (!(await send({ keepassferry: "removeEntryExtra", kind, name }).catch(() => false))) ok = false;
            }
            for (const r of this.existing.filter(x => !x.removed && x.newValue !== undefined)) {
                const toNotes = r.type === "notes";
                const result = await send({ keepassferry: "updateEntryText", name: toNotes ? "" : r.name, value: r.newValue, toNotes })
                    .catch(() => false);
                if (!result) ok = false;
            }
            for (const r of this.staged) {
                let result: any = null;
                try {
                    if (r.type === "totp") {
                        result = await send({ keepassferry: "setTotp", uri: r.uri, overwrite: true });
                        totpSaved = result?.status === "ok";
                        result = totpSaved;
                    } else if (r.type === "attachment") {
                        result = await send({ keepassferry: "addImageAttachment", fileName: r.fileName ?? "", data: r.data });
                    } else {
                        const toNotes = r.type === "notes";
                        result = await send({
                            keepassferry: "addEntryText",
                            fieldName: toNotes ? "" : r.name,
                            value: r.value,
                            protect: !toNotes && !!r.isProtected,
                            toNotes
                        });
                    }
                } catch (e) {
                    result = null;
                }
                if (!result) ok = false;
            }
            if (totpSaved && (await pageFieldKinds()).otp) await fillPageField("otp", this.uuid, this.dbFileName);
            if (!ok) {
                this.error = this.$i18n("ferry_add_failed");
                this.staged = [];
                await this.loadExisting();
            }
            return ok;
        }
    }
};
</script>

<style scoped>
.ferry-extra {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
}
/* Sanft auslaufende Hervorhebung (wie in den Einstellungen) */
.ferry-extra {
    border-radius: 8px;
    transition: background-color 0.8s ease;
}
.ferry-extra.highlight {
    background: rgba(var(--v-theme-primary), 0.1);
    transition: none;
}
.ferry-extra.removed .ferry-extra-text {
    opacity: 0.5;
    text-decoration: line-through;
}
.ferry-extra-icon {
    display: inline-flex;
    width: 22px;
    flex: none;
    color: var(--ferry-faint);
}
.ferry-extra-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
}
/* Mehrzeilige Inhalte (Notizen, Codes) kleiner, damit im Popup mehr auf einmal sichtbar ist */
.ferry-compact-text :deep(textarea) {
    font-size: 13px;
    line-height: 1.45;
}
/* Klickfläche wie im aufgeklappten Eintrag: dezente Hinterlegung, keine Link-Optik */
.ferry-extra-text.clickable {
    margin-left: -8px;
    padding: 3px 8px;
    border-radius: 8px;
    cursor: pointer;
    outline: none;
}
.ferry-extra-text.clickable:hover,
.ferry-extra-text.clickable:focus-visible {
    background: rgba(var(--v-theme-on-surface), 0.06);
}
.ferry-extra-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ferry-extra-sub {
    font-size: 12px;
    color: var(--ferry-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ferry-extra-empty {
    font-size: 12.5px;
    color: var(--ferry-muted);
    padding: 2px 0 8px;
}
.ferry-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 18px;
    background: rgba(var(--v-theme-primary), 0.12);
    color: rgb(var(--v-theme-primary));
}
.ferry-badge.warn {
    background: rgba(var(--v-theme-error), 0.12);
    color: rgb(var(--v-theme-error));
}
.ferry-add-open {
    width: 100%;
    height: 40px;
    margin-top: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.2);
    border-radius: 10px;
    background: transparent;
    color: var(--ferry-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
}
.ferry-add-open:hover {
    border-color: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-primary));
}
.ferry-add-form {
    margin-top: 8px;
    padding: 10px 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--ferry-line);
}
.ferry-add-head {
    display: flex;
    align-items: center;
    margin: -4px -4px 8px 0;
}
.ferry-add-title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
}
.ferry-add-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
}
.ferry-paste-btn {
    margin-top: 4px;
    margin-left: -8px;
}
.ferry-add-note {
    font-size: 12px;
    color: var(--ferry-muted);
    margin-top: 8px;
}
.ferry-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    margin-top: 6px;
}
.ferry-hint.err {
    color: rgb(var(--v-theme-error));
}
.ferry-hint-icon {
    color: rgb(var(--v-theme-primary));
}
</style>
