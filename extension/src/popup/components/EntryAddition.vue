<template>
    <div class="ferry-group">
        <div class="ferry-group-title">{{ $i18n("ferry_extras_heading") }}</div>
        <div v-for="r of rows" :key="r.key" class="ferry-extra" :class="{ removed: r.removed }">
            <span class="ferry-extra-icon">
                <tabler-paperclip v-if="r.type === 'attachment'" class="ferry-ico" />
                <tabler-shield-lock v-else-if="r.type === 'totp'" class="ferry-ico" />
                <tabler-note v-else-if="r.type === 'notes'" class="ferry-ico" />
                <tabler-lock v-else-if="r.isProtected" class="ferry-ico" />
                <tabler-text-caption v-else class="ferry-ico" />
            </span>
            <span class="ferry-extra-text">
                <span class="ferry-extra-name">
                    {{ r.name }}
                    <span v-if="r.isNew" class="ferry-badge">{{ $i18n("ferry_extras_new") }}</span>
                    <span v-if="r.removed" class="ferry-badge warn">{{ $i18n("ferry_extras_removed") }}</span>
                </span>
                <span v-if="r.sub" class="ferry-extra-sub">{{ r.sub }}</span>
            </span>
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

        <button v-if="!adding && !unsupported" type="button" class="ferry-add-open" @click="openAdd">
            <tabler-plus class="ferry-ico" />
            {{ $i18n("ferry_add_open") }}
        </button>

        <div v-else-if="adding" class="ferry-add-form">
            <div class="ferry-add-head">
                <span class="ferry-add-title">{{ $i18n("ferry_add_heading") }}</span>
                <button type="button" class="ferry-ib" :aria-label="$i18n('cancel')" @click="closeAdd">
                    <tabler-x class="ferry-ico" />
                </button>
            </div>
            <v-select
                v-model="kind" :items="kindItems" :label="$i18n('ferry_add_kind')" hide-details class="mb-2"
                @update:model-value="kindChanged" />
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
                    rows="2" auto-grow hide-details @update:model-value="onValueChanged" />
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
</template>

<script lang="ts">
import AttachmentPaste from "./AttachmentPaste.vue";
import { fillPageField, pageFieldKinds } from "../pageFields";
import { readClipboard } from "../clipboard";

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
}

let nextKey = 1;

export default {
    components: { AttachmentPaste },
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
        clipboardNotice: null as string
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
            return this.staged.length > 0 || this.existing.some(r => r.removed);
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
                for (const f of r?.fields ?? []) {
                    list.push({
                        key: "f:" + f.name,
                        type: "field",
                        name: f.name,
                        isProtected: f.isProtected,
                        sub: f.isProtected ? "••••••••" : (f.value ?? "").slice(0, 60)
                    });
                }
                for (const a of r?.attachments ?? []) {
                    list.push({ key: "a:" + a.name, type: "attachment", name: a.name, sub: Math.max(1, Math.round(a.size / 1024)) + " KB" });
                }
                this.existing = list;
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
        stageImage: function (img: { fileName: string; data: string; size: number; previewUrl: string }) {
            this.pendingImage = null;
            if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
            this.staged.push({
                key: "i" + nextKey++,
                type: "attachment",
                name: img.fileName || this.$i18n("ferry_add_kind_image"),
                sub: Math.max(1, Math.round(img.size / 1024)) + " KB",
                isNew: true,
                fileName: img.fileName,
                data: img.data
            });
            this.closeAdd();
        },
        toggleRow: function (r: Row) {
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
                const kind = r.type === "attachment" ? "attachment" : "field";
                if (!(await send({ keepassferry: "removeEntryExtra", kind, name: r.name }).catch(() => false))) ok = false;
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
