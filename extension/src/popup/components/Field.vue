<template>
    <div v-if="useful" class="ferry-row">
        <span class="ferry-row-icon">
            <mdi-key-outline v-if="field.type === 'password'" />
            <mdi-account-outline v-else />
        </span>
        <span class="ferry-row-value text-truncate" :style="fieldStyle" @click="toggleReveal">
            <v-tooltip location="bottom" :open-delay="tooltipDelay" activator="parent">
                <span>{{ tooltip }}</span>
            </v-tooltip>
            {{ displayValue }}
        </span>
        <v-btn size="small" variant="text" icon class="my-0" :color="copied ? 'success' : undefined" @click="copyValue">
            <v-tooltip location="start" :open-delay="tooltipDelay" activator="parent">
                <span>{{ $i18n("copy_value_to_clipboard") }}</span>
            </v-tooltip>
            <mdi-check v-if="copied" />
            <mdi-content-copy v-else />
        </v-btn>
    </div>
</template>

<script lang="ts">
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import { Field } from "../../common/model/Field";
import { tooltipDelay } from "../../common/Timings";

export default {
    props: ["field"],
    data: () => ({
        revealed: false,
        copied: false,
        tooltipDelay: tooltipDelay
    }),
    computed: {
        displayValue: function () {
            return Field.getDisplayValue(this.field, this.revealed);
        },
        tooltip: function () {
            return Field.getDisplayTooltip(this.field, this.revealed);
        },
        useful: function () {
            return this.field.type !== "checkbox" && this.displayValue.length > 0;
        },
        fieldStyle: function () {
            return this.field.type === "password" ? "cursor: pointer" : "cursor: default";
        }
    },
    methods: {
        toggleReveal: function () {
            this.revealed = !this.revealed;
        },
        copyValue: async function () {
            await copyStringToClipboard(Field.getDisplayValue(this.field, true));
            this.copied = true;
            setTimeout(() => (this.copied = false), 1500);
        }
    }
};
</script>

<style>
.ferry-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 2px 0 4px;
    border-radius: 10px;
}
.ferry-row:hover {
    background: rgba(var(--v-theme-on-surface), 0.04);
}
.ferry-row-icon {
    display: inline-flex;
    width: 22px;
    justify-content: center;
    opacity: 0.55;
    flex: none;
}
.ferry-row-value {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
}
</style>
