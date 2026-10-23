<template>
    <div v-if="useful" class="ferry-row">
        <span class="ferry-row-icon">
            <tabler-lock v-if="field.type === 'password'" class="ferry-ico" />
            <tabler-user v-else-if="kind === 'username'" class="ferry-ico" />
            <tabler-text-caption v-else class="ferry-ico" />
        </span>
        <span class="ferry-row-value" :class="{ secret: field.type === 'password' && !revealed }">
            {{ displayValue }}
            <v-tooltip location="bottom" activator="parent">{{ tooltip }}</v-tooltip>
        </span>
        <button
            v-if="field.type === 'password'" type="button" class="ferry-ib"
            :aria-label="revealed ? $i18n('ferry_generator_hide') : $i18n('ferry_generator_show')" @click="toggleReveal">
            <tabler-eye-off v-if="revealed" class="ferry-ico" />
            <tabler-eye v-else class="ferry-ico" />
            <v-tooltip location="top" activator="parent">{{ revealed ? $i18n("ferry_generator_hide") : $i18n("ferry_generator_show") }}</v-tooltip>
        </button>
        <button v-if="canFill" type="button" class="ferry-ib" :class="{ ok: filled }" :aria-label="$i18n('ferry_fill_into_page')" @click="fillIntoPage">
            <tabler-check v-if="filled" class="ferry-ico" />
            <tabler-arrow-bar-to-down v-else class="ferry-ico" />
            <v-tooltip location="top" activator="parent">{{ $i18n("ferry_fill_into_page") }}</v-tooltip>
        </button>
        <button type="button" class="ferry-ib" :class="{ ok: copied }" :aria-label="$i18n('copy_value_to_clipboard')" @click="copyValue">
            <tabler-check v-if="copied" class="ferry-ico" />
            <tabler-copy v-else class="ferry-ico" />
            <v-tooltip location="top" activator="parent">{{ $i18n("copy_value_to_clipboard") }}</v-tooltip>
        </button>
    </div>
</template>

<script lang="ts">
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import { Field } from "../../common/model/Field";
import { tooltipDelay } from "../../common/Timings";
import { pageFieldKinds, fillPageField } from "../pageFields";

// kind: "username" bzw. "password", wenn die Zeile in ein Feld der Seite eingetragen werden kann
export default {
    props: ["field", "kind", "uuid", "dbFileName"],
    data: () => ({
        revealed: false,
        copied: false,
        filled: false,
        pageHasField: false,
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
            // Häkchen-Felder ("boolean", z. B. "Angemeldet bleiben") sind nur fürs Ausfüllen da, nicht zum Anzeigen
            return this.field.type !== "boolean" && this.displayValue.length > 0;
        },
        fieldStyle: function () {
            return this.field.type === "password" ? "cursor: pointer" : "cursor: default";
        },
        canFill: function () {
            return !!this.kind && this.pageHasField;
        }
    },
    mounted: async function () {
        if (this.kind) this.pageHasField = !!(await pageFieldKinds())[this.kind];
    },
    methods: {
        toggleReveal: function () {
            this.revealed = !this.revealed;
        },
        copyValue: async function () {
            await copyStringToClipboard(Field.getDisplayValue(this.field, true));
            this.copied = true;
            setTimeout(() => (this.copied = false), 1500);
        },
        fillIntoPage: async function () {
            if (await fillPageField(this.kind, this.uuid, this.dbFileName, Field.getDisplayValue(this.field, true))) {
                this.filled = true;
                setTimeout(() => (this.filled = false), 1500);
            }
        }
    }
};
</script>

<style>
/* Wertezeile im aufgeklappten Eintrag, bündig unter dem Titel (Kachel 34 px + Abstand) */
.ferry-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding-left: 44px;
}
.ferry-row-icon {
    display: inline-flex;
    width: 22px;
    flex: none;
    color: var(--ferry-faint);
}
.ferry-row-value {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ferry-row-value.secret {
    letter-spacing: 0.08em;
}
</style>
