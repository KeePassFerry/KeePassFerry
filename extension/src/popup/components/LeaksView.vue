<template>
    <!-- In Datenlecks gefundene Passwörter: eigene Ansicht über dem Popup (wie Neuigkeiten), zuerst die neu gefundenen.
         Eine Zeile je Eintrag wie in der Eintragsliste; Klick auf die Zeile öffnet das Bearbeiten-Fenster. -->
    <v-dialog :model-value="true" fullscreen persistent :scrim="false" transition="dialog-transition" @keydown.esc="close()">
        <v-card class="ferry-news">
            <div class="ferry-news-head">
                <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_back')" @click="close()">
                    <tabler-arrow-left class="ferry-ico" />
                </button>
                <span class="ferry-news-title">{{ $i18n("ferry_leaks_heading") }}</span>
                <span v-if="shown.length" class="ferry-leaklist-total">{{ shown.length }}</span>
            </div>
            <div ref="body" class="ferry-news-body">
                <p v-if="shown.length" class="ferry-leaklist-intro">{{ $i18n("ferry_leaks_intro") }}</p>
                <div class="ferry-leaklist-list">
                    <div
                        v-for="leak of shown" :key="leak.dbFileName + leak.uuid" class="ferry-leaklist-row" role="button" tabindex="0"
                        @click="edit(leak)" @keydown.enter.prevent="edit(leak)">
                        <span class="ferry-leaklist-tile">
                            <tabler-alert-triangle class="ferry-ico" />
                        </span>
                        <span class="ferry-leaklist-text">
                            <span class="ferry-leaklist-title">{{ leak.title || domainOf(leak.url) || "—" }}</span>
                            <span v-if="leak.url" class="ferry-leaklist-domain">{{ domainOf(leak.url) }}</span>
                        </span>
                        <span class="ferry-leaklist-count">
                            {{ countShort(leak.count) }}
                            <v-tooltip activator="parent" location="top">{{ countText(leak.count) }}</v-tooltip>
                        </span>
                        <button
                            v-if="leak.url" type="button" class="ferry-ib" :aria-label="$i18n('ferry_change_password')"
                            @click.stop="changePassword(leak.url)">
                            <tabler-external-link class="ferry-ico" />
                            <v-tooltip activator="parent" location="top">{{ $i18n("ferry_change_password") }}</v-tooltip>
                        </button>
                        <button type="button" class="ferry-ib" :aria-label="$i18n('ferry_edit_entry')" @click.stop="edit(leak)">
                            <tabler-pencil class="ferry-ico" />
                            <v-tooltip activator="parent" location="top">{{ $i18n("ferry_edit_entry") }}</v-tooltip>
                        </button>
                    </div>
                </div>
                <v-progress-linear v-if="!loaded" indeterminate color="primary" class="mx-4 my-3" />
                <p v-if="loaded && !shown.length" class="ferry-news-empty">{{ $i18n("ferry_leaks_none") }}</p>
                <button v-if="!showAll" type="button" class="ferry-news-link ferry-leaks-all" @click="loadAll">
                    {{ $i18n("ferry_leaks_show_all") }}
                </button>
            </div>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { FerryURL } from "../../common/FerryURL";

export interface Leak {
    uuid: string;
    dbFileName: string;
    title: string;
    url: string;
    count: number;
    leakedAt: string;
}

export default {
    // leaks: die neu gefundenen (aus der Karte im Popup); "Alle anzeigen" lädt alle geleakten Einträge.
    // startWithAll: über das Symbol in der Fußleiste geöffnet – gleich alle zeigen.
    // restoreScroll: Scroll-Position beim letzten Verlassen (Bearbeiten oder zurück) – wieder an dieselbe Stelle
    props: {
        leaks: { type: Array, default: () => [] },
        startWithAll: { type: Boolean, default: false },
        restoreScroll: { type: Number, default: 0 }
    },
    // close: (scrollTop), edit: (leak, scrollTop) – die Position gibt der Aufrufer beim nächsten Öffnen als restoreScroll mit
    emits: ["close", "edit"],
    data: () => ({
        all: null as Leak[],
        loaded: true,
        showAll: false
    }),
    computed: {
        shown: function (): Leak[] {
            return this.showAll ? this.all ?? [] : (this.leaks as Leak[]);
        }
    },
    mounted: async function () {
        if (this.startWithAll) await this.loadAll();
        this.scrollBack();
    },
    methods: {
        edit(leak: Leak) {
            this.$emit("edit", leak, (this.$refs.body as HTMLElement)?.scrollTop ?? 0);
        },
        close() {
            this.$emit("close", (this.$refs.body as HTMLElement)?.scrollTop ?? 0);
        },
        // Beim Einblenden setzt Vuetify den Fokus nach oben und die Liste springt zurück; außerdem ist sie anfangs noch
        // kurz. Deshalb bis zu ~1 s je Frame setzen, bis die Position 5 Frames hintereinander stimmt.
        async scrollBack() {
            if (!(this.restoreScroll > 0)) return;
            let stable = 0;
            for (let i = 0; i < 60 && stable < 5; i++) {
                await new Promise(resolve => setTimeout(resolve, 16));
                const body = this.$refs.body as HTMLElement;
                if (!body) continue;
                if (Math.abs(body.scrollTop - this.restoreScroll) < 2) {
                    stable++;
                } else {
                    stable = 0;
                    body.scrollTop = this.restoreScroll;
                }
            }
        },
        domainOf(url: string) {
            return FerryURL.fromString(url ?? "")?.domainOrIPAddress ?? url ?? "";
        },
        countText(count: number) {
            return count > 0 ? this.$i18n("ferry_password_leaked_count", [count.toLocaleString()]) : this.$i18n("ferry_password_leaked");
        },
        // Kurz für die Plakette: 63×, 48.425×, ab einer Million in Kurzschreibweise der Sprache (1,2 Mio.× / 1.2M×)
        countShort(count: number) {
            if (!(count > 0)) return "!";
            if (count >= 1000000) return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(count) + "×";
            return count.toLocaleString() + "×";
        },
        async loadAll() {
            this.showAll = true;
            this.loaded = false;
            try {
                this.all = (await chrome.runtime.sendMessage({ keepassferry: "getHibpLeaks", since: "" })) ?? [];
            } catch (e) {
                this.all = [];
            }
            this.loaded = true;
        },
        // Wie am Eintrag: Änderungsseite der Website, sonst die Website selbst
        async changePassword(url: string) {
            let target: string = null;
            try {
                target = await chrome.runtime.sendMessage({ keepassferry: "changePasswordUrl", url, quick: false });
            } catch (e) {
                target = null;
            }
            chrome.tabs.create({ url: target || url });
            window.close();
        }
    }
};
</script>

<style>
.ferry-leaklist-total {
    margin-left: 2px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: rgba(var(--v-theme-error), 0.12);
    color: rgb(var(--v-theme-error));
    font-size: 12px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
}
.ferry-leaklist-intro {
    margin: 8px 16px 6px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ferry-muted);
}
.ferry-leaklist-list {
    display: flex;
    flex-direction: column;
    padding: 0 8px;
}
.ferry-leaklist-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 4px 6px 8px;
    border-radius: 10px;
    cursor: pointer;
}
.ferry-leaklist-row + .ferry-leaklist-row {
    border-top: 1px solid var(--ferry-line);
}
.ferry-leaklist-row:hover,
.ferry-leaklist-row:focus-visible {
    background: var(--ferry-hover, rgba(var(--v-theme-on-surface), 0.05));
    outline: none;
}
.ferry-leaklist-row:hover + .ferry-leaklist-row,
.ferry-leaklist-row:focus-visible + .ferry-leaklist-row {
    border-top-color: transparent;
}
.ferry-leaklist-tile {
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--v-theme-error), 0.12);
    color: rgb(var(--v-theme-error));
}
.ferry-leaklist-tile .ferry-ico {
    width: 17px;
    height: 17px;
}
.ferry-leaklist-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.ferry-leaklist-title {
    font-size: 13.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ferry-leaklist-domain {
    font-size: 12px;
    color: var(--ferry-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ferry-leaklist-count {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(var(--v-theme-error), 0.1);
    color: rgb(var(--v-theme-error));
    font-size: 11.5px;
    font-weight: 700;
    white-space: nowrap;
}
.ferry-leaks-all {
    display: block;
    margin: 10px 16px 0;
    background: none;
    border: 0;
    cursor: pointer;
}
</style>
