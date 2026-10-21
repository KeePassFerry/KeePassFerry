<template>
    <div v-if="code" class="ferry-row">
        <span class="ferry-row-icon">
            <v-progress-circular :model-value="remainingPercent" :size="18" :width="2.5" :color="ringColor" />
        </span>
        <span class="ferry-row-value otp-code">
            {{ displayCode }}
            <v-tooltip location="bottom" activator="parent">{{ $i18n("otp_code_tip", [remaining.toString()]) }}</v-tooltip>
        </span>
        <span class="otp-left" :class="ringColor">{{ remaining }} s</span>
        <button v-if="pageHasField" type="button" class="ferry-ib" :class="{ ok: filled }" :aria-label="$i18n('ferry_fill_into_page')" @click="fillIntoPage">
            <tabler-check v-if="filled" class="ferry-ico" />
            <tabler-arrow-bar-to-down v-else class="ferry-ico" />
            <v-tooltip location="top" activator="parent">{{ $i18n("ferry_fill_into_page") }}</v-tooltip>
        </button>
        <button type="button" class="ferry-ib" :class="{ ok: copied }" :aria-label="$i18n('otp_copy_tip')" @click="copyCode">
            <tabler-check v-if="copied" class="ferry-ico" />
            <tabler-copy v-else class="ferry-ico" />
            <v-tooltip location="top" activator="parent">{{ $i18n("otp_copy_tip") }}</v-tooltip>
        </button>
    </div>
</template>

<script lang="ts">
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import { tooltipDelay } from "../../common/Timings";
import { pageFieldKinds, fillPageField } from "../pageFields";

// Zeigt den aktuellen Einmalcode (TOTP) eines Eintrags mit Restlaufzeit und Kopier-Knopf.
// Der Code kommt über den Hintergrund vom KeePass-Plugin; das Secret bleibt in KeePass.
export default {
    props: ["uuid", "dbFileName"],
    data: () => ({
        code: null as string,
        remaining: 0,
        period: 30,
        timer: null as number,
        copied: false,
        filled: false,
        pageHasField: false,
        tooltipDelay: tooltipDelay
    }),
    computed: {
        displayCode: function () {
            const c = this.code ?? "";
            return c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c;
        },
        ringColor: function () {
            return this.remaining <= 5 ? "error" : this.remaining <= 10 ? "warning" : "success";
        },
        remainingPercent: function () {
            return Math.round((this.remaining / this.period) * 100);
        }
    },
    mounted: async function () {
        pageFieldKinds().then(k => (this.pageHasField = !!k.otp));
        await this.refresh();
        this.timer = window.setInterval(async () => {
            if (!this.code) return;
            this.remaining--;
            if (this.remaining <= 0) await this.refresh();
        }, 1000);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
    methods: {
        refresh: async function () {
            try {
                const result = await chrome.runtime.sendMessage({
                    keepassferry: "getTotp",
                    uuid: this.uuid,
                    dbFileName: this.dbFileName
                });
                this.code = result?.code ?? null;
                this.remaining = result?.remainingSeconds ?? 0;
                this.period = result?.period ?? 30;
            } catch (e) {
                this.code = null;
            }
        },
        copyCode: async function () {
            // Kurz vor dem Wechsel lieber den nächsten Code holen
            if (this.remaining <= 2) {
                await new Promise(resolve => setTimeout(resolve, (this.remaining + 1) * 1000));
                await this.refresh();
            }
            if (this.code) {
                await copyStringToClipboard(this.code);
                this.copied = true;
                setTimeout(() => (this.copied = false), 1500);
            }
        },
        // Den Code holt der Hintergrund frisch (mit Restzeit für den Ring am Feld)
        fillIntoPage: async function () {
            if (await fillPageField("otp", this.uuid, this.dbFileName)) {
                this.filled = true;
                setTimeout(() => (this.filled = false), 1500);
            }
        }
    }
};
</script>

<style scoped>
.otp-code {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
}
.otp-left {
    font-size: 12px;
    color: var(--ferry-muted);
    min-width: 30px;
    text-align: right;
}
.otp-left.warning {
    color: rgb(var(--v-theme-warning));
}
.otp-left.error {
    color: rgb(var(--v-theme-error));
}
</style>
