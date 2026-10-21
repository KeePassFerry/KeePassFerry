<template>
    <div
        class="paste-zone"
        :class="{ active: dragOver, done: !!savedName, failed: failed }"
        tabindex="0"
        role="button"
        :aria-label="$i18n('attachment_paste_hint')"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
    >
        <template v-if="saving">
            <v-progress-circular indeterminate :size="18" :width="2" color="primary" />
            <span>{{ $i18n("attachment_saving") }}</span>
        </template>
        <template v-else-if="savedName">
            <img v-if="previewUrl" :src="previewUrl" alt="" class="thumb" />
            <span class="msg">{{ $i18n("attachment_saved", [savedName, Math.max(1, Math.round(savedSize / 1024)).toString()]) }}</span>
        </template>
        <template v-else-if="failed">
            <span class="msg">{{ $i18n("attachment_failed") }}</span>
        </template>
        <template v-else>
            <mdi-image-plus-outline class="icon" />
            <span class="msg">{{ $i18n("attachment_paste_hint") }}</span>
        </template>
    </div>
</template>

<script lang="ts">
// Einfügezone im aufgeklappten Eintrag: Strg+V oder Ablegen eines Bildes speichert es als Anhang des Eintrags
// (z. B. Screenshot der Sicherheitsfragen). Speichern über den Hintergrund zum KeePass-Plugin.
const MAX_BYTES = 20 * 1024 * 1024;
// Kleine Anhänge halten die Datenbank schlank (KeePassium-AutoFill auf dem iPhone hat wenig Speicher)
const MAX_DIMENSION = 1600;
const TARGET_BYTES = 120 * 1024;

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

export default {
    props: ["uuid", "dbFileName"],
    data: () => ({
        dragOver: false,
        saving: false,
        savedName: null as string,
        savedSize: 0,
        failed: false,
        previewUrl: null as string
    }),
    mounted: function () {
        window.addEventListener("paste", this.onPaste);
    },
    unmounted: function () {
        window.removeEventListener("paste", this.onPaste);
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    },
    methods: {
        onPaste: function (e: ClipboardEvent) {
            // Nur Bilder abfangen; Text (z. B. in die Suche) wird normal eingefügt
            const file = Array.from(e.clipboardData?.items ?? [])
                .find(i => i.kind === "file" && i.type.startsWith("image/"))
                ?.getAsFile();
            if (!file) return;
            e.preventDefault();
            this.save(file);
        },
        onDrop: function (e: DragEvent) {
            this.dragOver = false;
            const file = Array.from(e.dataTransfer?.files ?? []).find(f => f.type.startsWith("image/"));
            if (file) this.save(file);
        },
        save: async function (file: File) {
            this.failed = false;
            this.savedName = null;
            if (file.size > MAX_BYTES) {
                this.failed = true;
                return;
            }
            this.saving = true;
            try {
                const compressed = await compressImage(file);
                this.savedSize = compressed.size;
                const buffer = new Uint8Array(await compressed.arrayBuffer());
                let binary = "";
                for (let i = 0; i < buffer.length; i += 0x8000) {
                    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
                }
                const name = await chrome.runtime.sendMessage({
                    keepassferry: "addImageAttachment",
                    uuid: this.uuid,
                    dbFileName: this.dbFileName,
                    // Eingefügte Bilder heißen meist "image.png"; dann vergibt das Plugin Datum und Uhrzeit.
                    // Die Endung passt das Plugin an den tatsächlichen Typ (JPEG) an.
                    fileName: file.name && file.name !== "image.png" ? file.name : "",
                    data: btoa(binary)
                });
                if (name) {
                    this.savedName = name;
                    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
                    this.previewUrl = URL.createObjectURL(compressed);
                } else {
                    this.failed = true;
                }
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
