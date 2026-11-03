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
                    :hint="isSiteProfile ? '' : $i18n('password_profile_hint')" :persistent-hint="!isSiteProfile"
                    :hide-details="isSiteProfile"
                    @update:model-value="profileChanged">
                    <template v-if="isSiteProfile" #prepend-inner>
                        <tabler-world-check class="ferry-ico ferry-gen-site-ico" />
                    </template>
                </v-select>
                <!-- Regeln der Website (Apples Password Manager Resources), sonst lehnt sie das Passwort ab -->
                <div v-if="isSiteProfile" class="ferry-gen-rules">
                    <div class="ferry-gen-chips">
                        <span v-for="c of ruleChips" :key="c" class="ferry-gen-chip">{{ c }}</span>
                    </div>
                    <p class="ferry-gen-note">{{ $i18n("ferry_generator_site_rules_hint") }}</p>
                </div>
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
import { generatePassword, parsePasswordRules, passwordRulesForHost, summarizeRules } from "../../common/passwordRules";
import { $STRF } from "../../common/DollarPolyfills";

export default {
    props: ["field", "standalone", "topmost", "canInsert"],
    emits: ["copy-to-clipboard", "dialog-closed", "insert"],
    setup() {
        const { updateGeneratedPassword } = useStore();
        return { updateGeneratedPassword };
    },
    data: () => ({
        // Gruppe in KeePass, in der das erzeugte Passwort gesichert wird (null: keine Sicherung bzw. unbekannt)
        selectedProfile: "",
        forceCopy: false,
        revealed: true,
        loading: false,
        copied: false,
        cachedGeneratedPassword: "",
        // Passwortregel der aktuellen Website (Domain und Regeltext) oder null
        siteRule: null as { domain: string; text: string } | null,
        siteRuleChecked: false,
        siteUrl: null as string
    }),
    computed: {
        ...mapState(useStore, ["PasswordProfiles", "saveState", "generatedPassword"]),
        siteProfileName: function () {
            return this.siteRule ? $STRF("ferry_generator_site_profile", [this.siteRule.domain]) : "";
        },
        isSiteProfile: function () {
            return !!this.siteRule && this.selectedProfile === this.siteProfileName;
        },
        items: function () {
            const profiles = this.PasswordProfiles.map(p => p.name);
            return this.siteRule ? [this.siteProfileName, ...profiles] : profiles;
        },
        ruleChips: function () {
            if (!this.siteRule) return [];
            const s = summarizeRules(parsePasswordRules(this.siteRule.text));
            const chips: string[] = [];
            if (s.minLength && s.maxLength) {
                chips.push(s.minLength === s.maxLength
                    ? $STRF("ferry_generator_rule_exact", [String(s.maxLength)])
                    : $STRF("ferry_generator_rule_range", [String(s.minLength), String(s.maxLength)]));
            } else if (s.minLength) chips.push($STRF("ferry_generator_rule_min", [String(s.minLength)]));
            else if (s.maxLength) chips.push($STRF("ferry_generator_rule_max", [String(s.maxLength)]));
            for (const set of s.required) {
                const names = set.includes("upper") && set.includes("lower")
                    ? ["letter", ...set.filter(c => c !== "upper" && c !== "lower")]
                    : set;
                chips.push(names.map(c => this.$i18n("ferry_generator_class_" + c)).join(" " + this.$i18n("ferry_generator_or") + " "));
            }
            if (s.specialChars) chips.push($STRF("ferry_generator_rule_special_only", [s.specialChars]));
            return chips;
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
    mounted: async function () {
        await this.loadSiteRule();
        this.selectDefaultProfile();
    },
    methods: {
        // Zuletzt benutztes Profil (sonst das erste) wählen und gleich ein Passwort erzeugen
        selectDefaultProfile: function () {
            if (this.selectedProfile || !this.siteRuleChecked) return;
            // Website mit bekannten Passwortregeln: passendes Profil vorauswählen
            if (this.siteRule) {
                this.selectedProfile = this.siteProfileName;
                this.profileChanged(this.selectedProfile);
                return;
            }
            if (!this.items.length) return;
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
        // Regel für die Website im aktiven Tab (Popup und Panel auf der Seite gehören zu diesem Tab)
        loadSiteRule: async function () {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const url = tab?.url ? new URL(tab.url) : null;
                if (url && (url.protocol === "https:" || url.protocol === "http:")) {
                    this.siteRule = passwordRulesForHost(url.hostname);
                    this.siteUrl = url.href;
                }
            } catch (e) {
                this.siteRule = null;
            }
            this.siteRuleChecked = true;
        },
        profileChanged: function (item: string) {
            if (this.siteRule && item === this.siteProfileName) {
                // Lokal erzeugt; das Profil der Website wird nicht als "zuletzt benutzt" gemerkt
                try {
                    this.cachedGeneratedPassword = generatePassword(parsePasswordRules(this.siteRule.text));
                } catch (e) {
                    this.cachedGeneratedPassword = "";
                }
                this.loading = false;
                return;
            }
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
.ferry-gen-site-ico {
    color: rgb(var(--v-theme-primary));
}
.ferry-gen-rules {
    margin-top: 8px;
}
.ferry-gen-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.ferry-gen-chip {
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 12px;
    background: var(--ferry-field);
    color: var(--ferry-muted);
}
.ferry-gen-rules .ferry-gen-note {
    margin-top: 6px;
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
