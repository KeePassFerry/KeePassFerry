<template>
    <div v-if="code" class="ferry-row">
        <span class="ferry-row-icon otp-ring">
            <v-progress-circular :model-value="remainingPercent" :size="18" :width="3" :color="remaining <= 5 ? 'error' : 'primary'">
            </v-progress-circular>
        </span>
        <span class="ferry-row-value otp-code">
            <v-tooltip location="bottom" :open-delay="tooltipDelay" activator="parent">
                <span>{{ $i18n("otp_code_tip", [remaining.toString()]) }}</span>
            </v-tooltip>
            {{ displayCode }}
        </span>
        <v-btn size="small" variant="text" icon class="my-0" :color="copied ? 'success' : undefined" @click="copyCode">
            <v-tooltip location="start" :open-delay="tooltipDelay" activator="parent">
                <span>{{ $i18n("otp_copy_tip") }}</span>
            </v-tooltip>
            <mdi-check v-if="copied" />
            <mdi-content-copy v-else />
        </v-btn>
    </div>
</template>

<script lang="ts">
import { copyStringToClipboard } from "../../common/copyStringToClipboard";
import { tooltipDelay } from "../../common/Timings";

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
        tooltipDelay: tooltipDelay
    }),
    computed: {
        displayCode: function () {
            const c = this.code ?? "";
            return c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c;
        },
        remainingPercent: function () {
            return Math.round((this.remaining / this.period) * 100);
        }
    },
    mounted: async function () {
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
        }
    }
};
</script>

<style scoped>
.otp-ring {
    opacity: 1;
}
.otp-code {
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    cursor: default;
}
</style>
