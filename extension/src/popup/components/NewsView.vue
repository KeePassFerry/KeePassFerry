<template>
    <!-- Neuigkeiten und Tipps: eigene Ansicht über dem Popup (wie der Generator) -->
    <v-dialog :model-value="true" fullscreen persistent :scrim="false" transition="dialog-transition" @keydown.esc="$emit('close')">
        <v-card class="ferry-news">
            <div class="ferry-news-head">
                <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_back')" @click="$emit('close')">
                    <tabler-arrow-left class="ferry-ico" />
                </button>
                <span class="ferry-news-title">{{ $i18n("ferry_news_heading") }}</span>
            </div>
            <div class="ferry-news-body">
                <!-- Tipps zuerst: führen den Nutzer zu dem, was bei ihm noch fehlt; darunter die Neuerungen je Version -->
                <p class="ferry-news-section">{{ $i18n("ferry_tips_heading") }}</p>
                <div v-for="tip of visibleTips" :key="tip.id" class="ferry-news-item">
                    <span class="ferry-news-icon" :class="tip.tone">
                        <component :is="iconComponent(tip.icon)" class="ferry-ico" />
                    </span>
                    <span class="ferry-news-text">
                        <span class="ferry-news-item-title">{{ $i18n("ferry_tip_" + tip.id + "_title") }}</span>
                        <span class="ferry-news-item-hint">{{ tipText(tip) }}</span>
                        <span class="ferry-news-actions">
                            <v-btn
                                v-if="tip.action" size="small" rounded="lg" :variant="tip.primary ? 'flat' : 'outlined'"
                                :color="tip.primary ? 'primary' : undefined" @click="tip.run">
                                {{ $i18n(tip.action) }}
                            </v-btn>
                            <v-btn size="small" rounded="lg" variant="text" @click="dismissTip(tip.id)">
                                {{ $i18n("ferry_tip_dismiss") }}
                            </v-btn>
                        </span>
                    </span>
                </div>
                <p v-if="tipsLoaded && !visibleTips.length" class="ferry-news-empty">
                    {{ connected ? $i18n("ferry_tips_none") : $i18n("ferry_tips_not_connected") }}
                </p>

                <template v-for="(release, index) of releases" :key="release.version">
                    <!-- Neueste Version (bzw. die installierte) offen, frühere zugeklappt -->
                    <button
                        v-if="index > 0" type="button" class="ferry-news-version" :aria-expanded="open.includes(release.version)"
                        @click="toggle(release.version)">
                        <span>{{ $i18n("ferry_news_version", [release.version]) }}</span>
                        <tabler-chevron-up v-if="open.includes(release.version)" class="ferry-ico" />
                        <tabler-chevron-down v-else class="ferry-ico" />
                    </button>
                    <p v-else class="ferry-news-section">{{ $i18n("ferry_news_version", [release.version]) }}</p>
                    <template v-if="index === 0 || open.includes(release.version)">
                        <div v-for="item of release.items" :key="item.key" class="ferry-news-item">
                            <span class="ferry-news-icon">
                                <component :is="iconComponent(item.icon)" class="ferry-ico" />
                            </span>
                            <span class="ferry-news-text">
                                <span class="ferry-news-item-title">{{ $i18n(item.key + "_title") }}</span>
                                <span class="ferry-news-item-hint">{{ $i18n(item.key + "_text") }}</span>
                            </span>
                        </div>
                    </template>

                    <p v-if="index === 0 && releases.length > 1" class="ferry-news-section">{{ $i18n("ferry_news_earlier") }}</p>
                </template>
                <a class="ferry-news-link" :href="changelogUrl" target="_blank" rel="noopener">
                    {{ $i18n("ferry_news_full_changelog") }}
                    <tabler-external-link class="ferry-ico" />
                </a>
            </div>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { WHATS_NEW, currentVersion, markNewsSeen } from "../../common/whatsNew";
import { Tip, loadTips, loadDismissedTips, saveDismissedTips, tipText } from "../tips";
import IconShieldCheck from "~icons/tabler/shield-check";
import IconWand from "~icons/tabler/wand";
import IconKey from "~icons/tabler/key";
import IconSparkles from "~icons/tabler/sparkles";
import IconTrash from "~icons/tabler/trash";
import IconLock from "~icons/tabler/lock";
import IconTextPlus from "~icons/tabler/text-plus";
import IconRefresh from "~icons/tabler/refresh";
import IconShieldLock from "~icons/tabler/shield-lock";
import IconFingerprint from "~icons/tabler/fingerprint";
import IconShieldSearch from "~icons/tabler/shield-search";
import IconBrowser from "~icons/tabler/browser";
import IconClock from "~icons/tabler/clock-exclamation";
import IconPin from "~icons/tabler/pin";
import IconKeyboard from "~icons/tabler/keyboard";
import IconBug from "~icons/tabler/bug";
import IconDatabase from "~icons/tabler/database";

// Symbole fest eingebunden (dynamische Namen löst das Icon-Plugin nicht auf)
const ICONS: Record<string, unknown> = {
    "shield-check": IconShieldCheck,
    wand: IconWand,
    key: IconKey,
    sparkles: IconSparkles,
    trash: IconTrash,
    lock: IconLock,
    "text-plus": IconTextPlus,
    refresh: IconRefresh,
    "shield-lock": IconShieldLock,
    fingerprint: IconFingerprint,
    "shield-search": IconShieldSearch,
    browser: IconBrowser,
    clock: IconClock,
    pin: IconPin,
    keyboard: IconKeyboard,
    bug: IconBug,
    database: IconDatabase
};

export default {
    // tips-changed: ein Tipp wurde ausgeblendet oder erledigt (Fußleiste prüft dann, ob ✨ weiter pulsiert)
    emits: ["close", "tips-changed"],
    data: () => ({
        open: [] as string[],
        tips: [] as Tip[],
        dismissed: [] as string[],
        tipsLoaded: false,
        connected: false
    }),
    computed: {
        // Installierte Version zuerst, danach ältere (künftige Einträge, falls vorhanden, nicht anzeigen)
        releases: function () {
            const current = currentVersion();
            const i = WHATS_NEW.findIndex(r => r.version === current);
            return i >= 0 ? WHATS_NEW.slice(i) : WHATS_NEW;
        },
        // Deutsche Oberfläche: gleich zum deutschen Teil des CHANGELOG springen
        changelogUrl: function () {
            const base = "https://github.com/KeePassFerry/KeePassFerry/blob/main/CHANGELOG.md";
            return chrome.i18n.getUILanguage().toLowerCase().startsWith("de") ? base + "#deutsch" : base;
        },
        visibleTips: function () {
            return this.tips.filter(t => !this.dismissed.includes(t.id));
        }
    },
    mounted: async function () {
        markNewsSeen();
        this.dismissed = await loadDismissedTips();
        await this.loadTips();
    },
    methods: {
        tipText(tip: Tip) {
            return tipText(tip);
        },
        iconComponent(name: string) {
            return ICONS[name] ?? IconSparkles;
        },
        toggle(version: string) {
            this.open = this.open.includes(version) ? this.open.filter(v => v !== version) : [...this.open, version];
        },
        async dismissTip(id: string) {
            if (!this.dismissed.includes(id)) this.dismissed = [...this.dismissed, id];
            await saveDismissedTips(this.dismissed);
            this.$emit("tips-changed");
        },
        async loadTips() {
            const { tips, connected } = await loadTips(async () => {
                await this.loadTips();
                this.$emit("tips-changed");
            });
            this.tips = tips;
            this.connected = connected;
            this.tipsLoaded = true;
        }
    }
};
</script>

<style>
.ferry-news {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: rgb(var(--v-theme-background)) !important;
}
.ferry-news-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--ferry-line);
}
.ferry-news-title {
    font-size: 15px;
    font-weight: 600;
}
.ferry-news-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 12px;
}
.ferry-news-section {
    margin: 14px 16px 4px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--ferry-faint);
}
.ferry-news-item {
    display: flex;
    gap: 12px;
    padding: 8px 16px;
}
.ferry-news-icon {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ferry-tint);
    color: rgb(var(--v-theme-primary));
}
.ferry-news-icon.warn {
    background: rgba(var(--v-theme-warning), 0.14);
    color: rgb(var(--v-theme-warning));
}
.ferry-news-icon.plain {
    background: var(--ferry-field);
    color: var(--ferry-muted);
}
.ferry-news-icon .ferry-ico {
    width: 17px;
    height: 17px;
}
.ferry-news-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.ferry-news-item-title {
    font-size: 13px;
    font-weight: 600;
}
.ferry-news-item-hint {
    font-size: 12px;
    color: var(--ferry-muted);
}
.ferry-news-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
}
.ferry-news-empty {
    margin: 4px 16px;
    font-size: 12.5px;
    color: var(--ferry-muted);
}
.ferry-news-version {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: calc(100% - 16px);
    margin: 2px 8px;
    padding: 8px 8px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
}
.ferry-news-version:hover {
    background: var(--ferry-hover);
}
.ferry-news-version .ferry-ico {
    color: var(--ferry-muted);
}
.ferry-news-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 14px 16px 0;
    font-size: 12.5px;
    color: rgb(var(--v-theme-primary));
    text-decoration: none;
}
.ferry-news-link .ferry-ico {
    width: 14px;
    height: 14px;
}
</style>
