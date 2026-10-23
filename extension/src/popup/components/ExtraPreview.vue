<template>
    <div v-if="open" ref="root" class="ferry-preview" tabindex="-1" @click.self="close" @keyup.esc.stop="close">
        <div class="ferry-preview-card" role="dialog" :aria-label="title">
            <div class="ferry-preview-head">
                <span class="ferry-preview-title">{{ title }}</span>
                <button v-if="editable" type="button" class="ferry-ib" :aria-label="$i18n('ferry_extras_edit')" @click="$emit('edit')">
                    <tabler-pencil class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ $i18n("ferry_extras_edit") }}</v-tooltip>
                </button>
                <button v-if="external" type="button" class="ferry-ib" :aria-label="$i18n('ferry_attachment_open_external')" @click="$emit('open-external')">
                    <tabler-external-link class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ $i18n("ferry_attachment_open_external") }}</v-tooltip>
                </button>
                <button v-if="blob" type="button" class="ferry-ib" :aria-label="$i18n('ferry_attachment_save')" @click="save">
                    <tabler-download class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ $i18n("ferry_attachment_save") }}</v-tooltip>
                </button>
                <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_preview_close')" @click="close">
                    <tabler-x class="ferry-ico" />
                    <v-tooltip location="bottom" activator="parent">{{ $i18n("ferry_preview_close") }}</v-tooltip>
                </button>
            </div>
            <div class="ferry-preview-body">
                <img v-if="imageUrl" :src="imageUrl" alt="" class="ferry-preview-img" />
                <pre v-else-if="hasText" class="ferry-preview-text">{{ text }}</pre>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { saveBlob } from "../extras";

// Vorschau im Popup: Bild (mit "Speichern unter", bei gespeicherten Anhängen auch "Mit Standardprogramm öffnen")
// oder Text so, wie er gespeichert ist (markieren und kopieren wie gewohnt).
export default {
    // editable: Stift "Bearbeiten" (Notizen, Felder)
    props: ["open", "title", "blob", "text", "fileName", "external", "editable"],
    emits: ["close", "open-external", "edit"],
    data: () => ({ imageUrl: null as string }),
    computed: {
        hasText: function (): boolean {
            return this.text !== null && this.text !== undefined;
        }
    },
    watch: {
        blob: {
            immediate: true,
            handler: function (b: Blob) {
                if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
                this.imageUrl = b && b.type.startsWith("image/") ? URL.createObjectURL(b) : null;
            }
        },
        open: function (v: boolean) {
            if (v) this.$nextTick(() => (this.$refs.root as HTMLElement)?.focus());
        }
    },
    unmounted: function () {
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    },
    methods: {
        close: function () {
            this.$emit("close");
        },
        save: function () {
            if (this.blob) saveBlob(this.blob, this.fileName || this.title);
        }
    }
};
</script>

<style>
.ferry-preview {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: rgba(15, 23, 42, 0.45);
    outline: none;
}
.ferry-preview-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 100%;
    border-radius: 12px;
    background: rgb(var(--v-theme-surface));
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.3);
    overflow: hidden;
}
.ferry-preview-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--ferry-line);
}
.ferry-preview-title {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ferry-preview-body {
    overflow: auto;
    padding: 10px;
}
.ferry-preview-img {
    display: block;
    max-width: 100%;
    margin: 0 auto;
    border-radius: 6px;
}
.ferry-preview-text {
    margin: 0;
    font: inherit;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
}
</style>
