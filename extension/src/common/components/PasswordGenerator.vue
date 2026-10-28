<template>
    <v-dialog
        :model-value="true" fullscreen persistent :scrim="false" :transition="dialogTransition"
        @keydown.esc="cancel">
        <v-card class="ferry-gen">
            <div class="ferry-gen-head">
                <span class="ferry-gen-title">{{ $i18n("ferry_generator_heading") }}</span>
                <v-btn variant="text" icon size="small" @click="cancel">
                    <v-tooltip location="start" activator="parent">{{ cancelButtonText }}</v-tooltip>
                    <tabler-x class="ferry-ico" />
                </v-btn>
            </div>
            <div class="ferry-gen-body">
                <v-select
                    v-model="selectedProfile" :items="items" :label="$i18n('password_profile')"
                    variant="outlined" density="comfortable" color="primary"
                    :hint="$i18n('password_profile_hint')" persistent-hint
                    @update:model-value="profileChanged" />
                <div class="ferry-gen-pw" :class="{ hidden: !revealed }">
                    <v-progress-linear v-if="loading" indeterminate color="primary" absolute location="top" />
                    <span class="ferry-gen-value">{{ renderedPassword || "—" }}</span>
                    <div class="ferry-gen-tools">
                        <v-btn variant="text" icon size="small" :disabled="!selectedProfile || loading" @click="regenerate">
                            <v-tooltip location="top" activator="parent">{{ $i18n("ferry_generator_again") }}</v-tooltip>
                            <tabler-refresh class="ferry-ico" />
                        </v-btn>
                        <v-btn variant="text" icon size="small" @click="revealed = !revealed">
                            <v-tooltip location="top" activator="parent">
                                {{ revealed ? $i18n("ferry_generator_hide") : $i18n("ferry_generator_show") }}
                            </v-tooltip>
                            <tabler-eye-off class="ferry-ico" v-if="revealed"/>
                            <tabler-eye class="ferry-ico" v-else/>
                        </v-btn>
                        <v-btn variant="text" icon size="small" :disabled="disabled" :color="copied ? 'success' : undefined" @click="copyOnly">
                            <v-tooltip location="top" activator="parent">{{ $i18n("copy_value_to_clipboard") }}</v-tooltip>
                            <tabler-check class="ferry-ico" v-if="copied"/>
                            <tabler-copy class="ferry-ico" v-else/>
                        </v-btn>
                    </div>
                </div>
                <template v-if="!standalone">
                    <p class="ferry-gen-note">{{ $i18n("password_will_be_set_on_field") }}</p>
                    <v-checkbox v-model="forceCopy" :label="$i18n('also_copy_to_clipboard')" density="compact" color="primary" hide-details />
                    <p v-if="forceCopyHint" class="ferry-gen-note">{{ forceCopyHint }}</p>
                </template>
            </div>
            <div class="ferry-gen-actions">
                <v-btn variant="text" rounded="lg" @click="cancel">
                    {{ cancelButtonText }}
                </v-btn>
                <v-btn v-if="canInsert" variant="text" rounded="lg" :disabled="disabled" @click="ok">
                    {{ okButtonText }}
                </v-btn>
                <v-btn v-if="canInsert" variant="flat" color="primary" rounded="lg" :disabled="disabled" @click="insert">
                    {{ $i18n("generator_action_insert") }}
                </v-btn>
                <v-btn v-else variant="flat" color="primary" rounded="lg" :disabled="disabled" @click="ok">
                    {{ okButtonText }}
                </v-btn>
            </div>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { Port } from "../../common/port";
import { Action } from "../../common/Action";
import { SaveState } from "../../common/SaveState";
import useStore from "../../store";
import { mapState } from "pinia";

export default {
    props: ["field", "standalone", "topmost", "canInsert"],
    emits: ["copy-to-clipboard", "dialog-closed", "insert"],
    setup() {
        const { updateGeneratedPassword } = useStore();
        return { updateGeneratedPassword };
    },
    data: () => ({
        selectedProfile: "",
        forceCopy: false,
        revealed: true,
        loading: false,
        copied: false,
        cachedGeneratedPassword: ""
    }),
    computed: {
        ...mapState(useStore, ["PasswordProfiles", "saveState", "generatedPassword"]),
        items: function () {
            return this.PasswordProfiles.map(p => p.name);
        },
        disabled: function () {
            return !this.cachedGeneratedPassword;
        },
        forceCopyHint: function () {
            return this.forceCopy ? this.$i18n("generatePassword_done_2") : "";
        },
        renderedPassword: function () {
            return this.revealed
                ? this.cachedGeneratedPassword
                : "*".repeat(this.cachedGeneratedPassword.length);
        },
        okButtonText: function () {
            if (this.standalone) {
                return this.$i18n("generator_action_copy");
            } else if (this.forceCopy) {
                return this.$i18n("generator_action_apply_and_copy");
            } else {
                return this.$i18n("generator_action_apply");
            }
        },
        cancelButtonText: function () {
            return this.standalone ? this.$i18n("close") : this.$i18n("cancel");
        },
        dialogTransition: function () {
            return this.topmost ? "false" : "dialog-transition";
        }
    },
    watch: {
        // Profile kommen evtl. erst nach dem Öffnen an
        PasswordProfiles: function () {
            this.selectDefaultProfile();
        }
    },
    mounted: function () {
        this.selectDefaultProfile();
    },
    methods: {
        // Zuletzt benutztes Profil (sonst das erste) wählen und gleich ein Passwort erzeugen
        selectDefaultProfile: function () {
            if (this.selectedProfile || !this.items.length) return;
            let last = "";
            try {
                last = localStorage.getItem("ferryPasswordProfile") ?? "";
            } catch (e) {
                last = "";
            }
            this.selectedProfile = this.items.includes(last) ? last : this.items[0];
            this.profileChanged(this.selectedProfile);
        },
        regenerate: function () {
            if (this.selectedProfile) this.profileChanged(this.selectedProfile);
        },
        copyOnly: function () {
            if (!this.cachedGeneratedPassword) return;
            this.$emit("copy-to-clipboard", { value: this.cachedGeneratedPassword });
            this.copied = true;
            setTimeout(() => (this.copied = false), 1500);
        },
        ok: async function () {
            if (this.standalone || this.forceCopy) {
                this.$emit("copy-to-clipboard", { value: this.cachedGeneratedPassword });
            }
            this.$emit("dialog-closed", { value: this.cachedGeneratedPassword });
        },
        // In das Feld eintragen, in das rechts geklickt wurde (mit "Auch kopieren" zusätzlich in die Zwischenablage)
        insert: function () {
            if (!this.cachedGeneratedPassword) return;
            if (this.forceCopy) this.$emit("copy-to-clipboard", { value: this.cachedGeneratedPassword });
            this.$emit("insert", { value: this.cachedGeneratedPassword });
        },
        cancel: function () {
            this.$emit("dialog-closed");
        },
        profileChanged: function (item: string) {
            try {
                localStorage.setItem("ferryPasswordProfile", item);
            } catch (e) {
                // ohne Merken
            }
            this.loading = true;
            const unwatch = this.$watch(
                "generatedPassword",
                newValue => {
                    unwatch();
                    this.cachedGeneratedPassword = newValue ?? "";
                    this.loading = false;
                }
            );
            Port.postMessage({
                action: Action.GeneratePassword,
                passwordProfile: item,
                url: (this.saveState as SaveState)?.newEntry?.URLs?.[0]
            });
        }
    }
};
</script>
<style>
.ferry-gen {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: rgb(var(--v-theme-background)) !important;
}
.ferry-gen-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 0 16px;
}
.ferry-gen-title {
    font-size: 15px;
    font-weight: 600;
}
.ferry-gen-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
}
.ferry-gen-pw {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 6px 10px 14px;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 8px;
    background: rgb(var(--v-theme-surface));
    overflow: hidden;
}
.ferry-gen-value {
    flex: 1;
    min-width: 0;
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 15px;
    letter-spacing: 0.04em;
    overflow-wrap: anywhere;
}
.ferry-gen-tools {
    display: flex;
    flex: none;
}
.ferry-gen-note {
    font-size: 12.5px;
    opacity: 0.75;
    margin: 12px 0 4px;
}
.ferry-gen-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.ferry-gen-actions .v-btn {
    min-width: 112px;
}
</style>
