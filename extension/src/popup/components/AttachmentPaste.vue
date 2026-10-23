<template>
    <div
        class="paste-zone"
        :class="{ active: dragOver, failed: failed, choice: !!totpUri }"
        ref="zone"
        tabindex="0"
        role="group"
        :aria-label="$i18n('attachment_paste_hint')"
        @paste="onPaste"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
    >
        <template v-if="saving">
            <v-progress-circular indeterminate :size="18" :width="2" color="primary" />
            <span>{{ $i18n("attachment_saving") }}</span>
        </template>
        <template v-else-if="totpUri">
            <tabler-shield-lock class="ferry-ico icon key"/>
            <div class="choice-body">
                <div class="msg strong">{{ $i18n("ferry_totp_detected") }}</div>
                <div class="choice-actions">
                    <v-btn size="small" variant="flat" color="primary" rounded="lg" @click="saveTotp">
                        {{ $i18n("ferry_totp_save") }}
                    </v-btn>
                    <v-btn v-if="pendingImage" size="small" variant="text" @click="saveImageInstead">
                        {{ $i18n("ferry_totp_as_image") }}
                    </v-btn>
                    <v-btn size="small" variant="text" @click="resetChoice">{{ $i18n("otpSetup_cancel") }}</v-btn>
                </div>
            </div>
        </template>
        <template v-else>
            <tabler-photo-plus class="ferry-ico icon"/>
            <div class="choice-body">
                <span class="msg">{{ failed ? $i18n("attachment_failed") : notice || $i18n("attachment_paste_hint") }}</span>
                <div class="choice-actions">
                    <v-btn size="small" variant="flat" color="primary" rounded="lg" @click="pasteClipboard">
                        <tabler-clipboard-text class="ferry-ico mr-1" />
                        {{ $i18n("ferry_paste_clipboard") }}
                    </v-btn>
                    <v-btn size="small" variant="text" @click="($refs.file as HTMLInputElement).click()">
                        {{ $i18n("ferry_choose_file") }}
                    </v-btn>
                </div>
            </div>
            <input ref="file" type="file" accept="image/*" hidden @change="onFileChosen" />
        </template>
    </div>
</template>

<script lang="ts">
import jsQR from "jsqr";
import { readClipboard } from "../clipboard";

// Einfügezone im Bearbeiten-Fenster: "Aus Zwischenablage einfügen", Datei auswählen, Ablegen oder Strg+V in der
// (beim Öffnen fokussierten) Zone selbst – Einfügen anderswo im Fenster wird nicht abgefangen.
// - Bild: verkleinern und als Anhang vormerken (z. B. Screenshot der Sicherheitsfragen)
// - QR-Code (Bild) oder Schlüssel als Text (otpauth-Link, Base32): Angebot, ihn als Zwei-Faktor-Schlüssel vorzumerken
// Gespeichert wird erst mit "Speichern" (EntryAddition).
const MAX_BYTES = 20 * 1024 * 1024;
// Kleine Anhänge halten die Datenbank schlank (KeePassium-AutoFill auf dem iPhone hat wenig Speicher)
const MAX_DIMENSION = 1600;
const TARGET_BYTES = 120 * 1024;
const OTPAUTH_RE = /^otpauth:\/\/totp\/\S+$/i;
// Base32-Schlüssel, auch in Gruppen ("JBSW Y3DP EHPK 3PXP …"), mindestens 16 Zeichen
const SECRET_RE = /^[A-Z2-7]{16,128}=*$/;

// Bild verkleinern und als JPEG speichern (KeePass zeigt JPEG direkt an, WebP nicht).
// Qualität und notfalls Größe werden schrittweise reduziert, bis das Ziel erreicht ist.
async function compressImage(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    try {
        let scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        let best: Blob = null;
        for (let attempt = 0; attempt < 6; attempt++) {
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext("2d");
            // Transparente Bereiche weiß statt schwarz
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(bitmap, 0, 0, w, h);
            for (const quality of [0.82, 0.7, 0.58]) {
                const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
                if (!best || blob.size < best.size) best = blob;
                if (blob.size <= TARGET_BYTES) return blob;
            }
            scale *= 0.8;
        }
        return best;
    } finally {
        bitmap.close();
    }
}

// otpauth-TOTP-URI aus einem Bild mit QR-Code, sonst null
async function decodeOtpQr(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const result = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
        return result?.data && OTPAUTH_RE.test(result.data) ? result.data : null;
    } finally {
        bitmap.close();
    }
}

export default {
    // initialFile: schon eingefügtes Bild (Bearbeiten-Fenster wechselt beim Einfügen eines Bildes hierher)
    props: ["uuid", "dbFileName", "title", "initialFile"],
    emits: ["staged-image", "staged-totp"],
    data: () => ({
        dragOver: false,
        saving: false,
        savedName: null as string,
        savedSize: 0,
        failed: false,
        totpUri: null as string,
        totpExists: false,
        totpSaved: false,
        pendingImage: null as File,
        notice: null as string
    }),
    mounted: function () {
        if (this.initialFile) this.handleImage(this.initialFile);
        else this.$nextTick(() => (this.$refs.zone as HTMLElement)?.focus());
    },
    methods: {
        // Schlüssel als Text in eine otpauth-URI umwandeln; Bezeichnung = Titel des Eintrags
        uriFromText: function (text: string): string {
            const t = (text ?? "").trim();
            if (OTPAUTH_RE.test(t)) return t;
            // Base32 ist einheitlich groß (oder klein) geschrieben; gemischte Schreibung ("fNYWa-gokWT")
            // sind z. B. Wiederherstellungscodes und kein Zwei-Faktor-Schlüssel
            if (/[a-z]/.test(t) && /[A-Z]/.test(t)) return null;
            const secret = t.replace(/[\s-]/g, "").toUpperCase();
            if (!SECRET_RE.test(secret)) return null;
            const label = encodeURIComponent(this.title || "KeePass");
            return `otpauth://totp/${label}?secret=${secret.replace(/=+$/, "")}&issuer=${label}`;
        },
        pasteClipboard: async function () {
            this.notice = null;
            this.failed = false;
            const content = await readClipboard();
            if (content === "denied") {
                this.notice = this.$i18n("ferry_clipboard_denied");
            } else if (content === "empty") {
                this.notice = this.$i18n("ferry_clipboard_no_image");
            } else if (content.image) {
                this.handleImage(content.image);
            } else {
                const uri = this.uriFromText(content.text);
                if (uri) this.offerTotp(uri, null);
                else this.notice = this.$i18n("ferry_clipboard_no_image");
            }
        },
        onFileChosen: function (e: Event) {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (file && file.type.startsWith("image/")) this.handleImage(file);
        },
        onPaste: function (e: ClipboardEvent) {
            const file = Array.from(e.clipboardData?.items ?? [])
                .find(i => i.kind === "file" && i.type.startsWith("image/"))
                ?.getAsFile();
            if (file) {
                e.preventDefault();
                this.handleImage(file);
                return;
            }
            const uri = this.uriFromText(e.clipboardData?.getData("text/plain"));
            if (!uri) return;
            e.preventDefault();
            this.offerTotp(uri, null);
        },
        onDrop: function (e: DragEvent) {
            this.dragOver = false;
            const file = Array.from(e.dataTransfer?.files ?? []).find(f => f.type.startsWith("image/"));
            if (file) {
                this.handleImage(file);
                return;
            }
            const uri = this.uriFromText(e.dataTransfer?.getData("text/plain"));
            if (uri) this.offerTotp(uri, null);
        },
        handleImage: async function (file: File) {
            let uri: string = null;
            try {
                uri = await decodeOtpQr(file);
            } catch (e) {
                uri = null;
            }
            if (uri) this.offerTotp(uri, file);
            else this.save(file);
        },
        offerTotp: function (uri: string, image: File) {
            this.failed = false;
            this.savedName = null;
            this.totpSaved = false;
            this.totpExists = false;
            this.totpUri = uri;
            this.pendingImage = image;
        },
        resetChoice: function () {
            this.totpUri = null;
            this.pendingImage = null;
            this.totpExists = false;
        },
        saveImageInstead: function () {
            const file = this.pendingImage;
            this.resetChoice();
            if (file) this.save(file);
        },
        // Zwei-Faktor-Schlüssel aus dem QR-Code vormerken; gespeichert wird mit "Speichern" im Bearbeiten-Fenster
        saveTotp: function () {
            this.$emit("staged-totp", this.totpUri);
            this.resetChoice();
        },
        // Bild verkleinern und vormerken; gespeichert wird mit "Speichern" im Bearbeiten-Fenster
        save: async function (file: File) {
            this.failed = false;
            if (file.size > MAX_BYTES) {
                this.failed = true;
                return;
            }
            this.saving = true;
            try {
                const compressed = await compressImage(file);
                const buffer = new Uint8Array(await compressed.arrayBuffer());
                let binary = "";
                for (let i = 0; i < buffer.length; i += 0x8000) {
                    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
                }
                this.$emit("staged-image", {
                    // Eingefügte Bilder heißen meist "image.png"; dann vergibt das Plugin Datum und Uhrzeit.
                    // Die Endung passt das Plugin an den tatsächlichen Typ (JPEG) an.
                    fileName: file.name && file.name !== "image.png" ? file.name : "",
                    data: btoa(binary),
                    size: compressed.size,
                    // für die Vorschau vor dem Speichern
                    blob: compressed
                });
            } catch (e) {
                this.failed = true;
            }
            this.saving = false;
        }
    }
};
</script>

<style scoped>
.paste-zone {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 8px 4px 0;
    padding: 10px 12px;
    border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.28);
    border-radius: 10px;
    font-size: 12.5px;
    color: rgba(var(--v-theme-on-surface), 0.75);
    white-space: normal;
}
.paste-zone:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 2px;
}
.paste-zone.active {
    border-color: rgb(var(--v-theme-primary));
    background: rgba(var(--v-theme-primary), 0.06);
}
.paste-zone.choice {
    align-items: flex-start;
    border-style: solid;
    border-color: rgba(var(--v-theme-primary), 0.6);
    background: rgba(var(--v-theme-primary), 0.05);
    color: inherit;
}
.paste-zone.done {
    border-style: solid;
    border-color: rgba(22, 163, 74, 0.6);
    background: rgba(22, 163, 74, 0.08);
    color: inherit;
}
.paste-zone.failed {
    border-style: solid;
    border-color: rgba(var(--v-theme-error), 0.6);
}
.icon {
    font-size: 20px;
    flex: none;
}
.icon.key {
    color: rgb(var(--v-theme-primary));
    margin-top: 1px;
}
.icon.ok {
    color: rgb(var(--v-theme-success));
}
.choice-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}
.choice-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
}
.strong {
    font-weight: 600;
}
.thumb {
    width: 44px;
    height: 32px;
    object-fit: cover;
    border-radius: 4px;
    flex: none;
}
.msg {
    min-width: 0;
}
</style>
