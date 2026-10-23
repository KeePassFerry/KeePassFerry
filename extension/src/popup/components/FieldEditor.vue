<template>
    <div v-if="field.type === 'password' || field.type === 'text'" class="ferry-field-editor" :class="{ removed }">
        <v-text-field
            :label="label"
            :model-value="field.value"
            color="primary"
            hide-details="auto"
            :type="renderType"
            :readonly="removed"
            :hint="removed ? $i18n('ferry_extras_removed') : undefined"
            :persistent-hint="removed"
            @update:model-value="valueChanged"
            @focus="onFocus"
            @blur="onBlur"
        >
            <template #append-inner>
                <button v-if="focussed && resettable && !removed" type="button" class="ferry-ib" :aria-label="$i18n('ferry_reset_value')" @mousedown.prevent @click="reset">
                    <tabler-arrow-back-up class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("ferry_reset_value") }}</v-tooltip>
                </button>
                <button
                    v-if="field.type === 'password' && !removed" type="button" class="ferry-ib"
                    :aria-label="revealed ? $i18n('ferry_generator_hide') : $i18n('ferry_generator_show')"
                    @click="revealed = !revealed">
                    <tabler-eye-off v-if="revealed" class="ferry-ico" />
                    <tabler-eye v-else class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ revealed ? $i18n("ferry_generator_hide") : $i18n("ferry_generator_show") }}</v-tooltip>
                </button>
                <button
                    v-if="field.type === 'password' && !removed" type="button" class="ferry-ib"
                    :aria-label="$i18n('ferry_generator_heading')" @click="showPasswordGenerator = true">
                    <tabler-wand class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">{{ $i18n("ferry_generator_heading") }}</v-tooltip>
                </button>
                <!-- Entfernen wird nur vorgemerkt (wie unter "Im Eintrag"); erst "Speichern" entfernt das Feld -->
                <button
                    type="button" class="ferry-ib" :class="{ danger: !removed }"
                    :aria-label="removed ? $i18n('ferry_extras_undo') : $i18n('ferry_extras_remove')" @click="deleteClicked">
                    <tabler-arrow-back-up v-if="removed" class="ferry-ico" />
                    <tabler-trash v-else class="ferry-ico" />
                    <v-tooltip location="top" activator="parent">
                        {{ removed ? $i18n("ferry_extras_undo") : $i18n("ferry_extras_remove") }}
                    </v-tooltip>
                </button>
            </template>
        </v-text-field>
        <PasswordGenerator
            v-if="showPasswordGenerator"
            @dialog-closed="passwordGeneratorClosed"
            @copy-to-clipboard="copyToClipboard"
        />
    </div>
</template>

<style>
.ferry-field-editor {
    margin-bottom: 8px;
}
.ferry-field-editor.removed input {
    opacity: 0.5;
    text-decoration: line-through;
}
.ferry-field-editor.removed .v-messages {
    color: rgb(var(--v-theme-error));
    opacity: 1;
}
.ferry-field-editor .v-field__append-inner {
    gap: 0;
    padding-top: 0;
    align-items: center;
}
</style>

<script lang="ts">
import { Field } from "../../common/model/Field";
import PasswordGenerator from "../../common/components/PasswordGenerator.vue";
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import { KeeLog } from "~/common/Logger";

export default {
    components: {
        PasswordGenerator
    },
    // removed: zum Entfernen vorgemerkt; "field-deleted" schaltet die Vormerkung um
    props: ["field", "removed"],
    emits: ["field-value-changed", "field-deleted"],
    data: () => ({
        revealed: false,
        showPasswordGenerator: false,
        focussed: false
    }),
    computed: {
        renderType: function () {
            if (this.field.type === "password") {
                return this.revealed ? "text" : "password";
            }
            return this.field.type;
        },
        resettable: function () {
            return this.field.resetValue !== this.field.value;
        },
        label: function () {
            return Field.getDisplayName(this.field);
        }
    },
    methods: {
        reset: function () {
            this.valueChanged(this.field.resetValue);
        },
        valueChanged: function (value) {
            this.$emit("field-value-changed", { uuid: this.field.uuid, value });
        },
        deleteClicked: function () {
            this.$emit("field-deleted", { uuid: this.field.uuid });
        },
        passwordGeneratorClosed: function (payload) {
            if (payload?.value) this.valueChanged(payload.value);
            this.showPasswordGenerator = false;
        },
        onFocus() {
            this.focussed = true;
        },
        onBlur() {
            this.focussed = false;
        },
        copyToClipboard: async function (payload) {
            if (payload?.value) await copyStringToClipboard(payload.value);
        }
    }
};
</script>
