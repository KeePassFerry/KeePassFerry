<template>
    <v-app>
        <div id="i18n_root" class="welcome">
            <header class="hero">
                <svg class="hero-logo" viewBox="0 0 128 128" width="72" height="72" aria-hidden="true">
                    <rect x="4" y="4" width="120" height="120" rx="28" fill="#15497f" />
                    <circle cx="42" cy="47" r="15" fill="none" stroke="#fff" stroke-width="9" />
                    <path d="M57 47 H100 M88 47 V60 M99 47 V57" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M18 72 H110 L97 94 Q95 97 91 97 H37 Q33 97 31 94 Z" fill="#22c55e" />
                    <path d="M20 108 q 8.8 -7 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0" fill="none" stroke="#7dd3fc" stroke-width="6" stroke-linecap="round" />
                </svg>
                <h1>{{ $i18n("welcome_to_kee") }}</h1>
                <p class="lead">{{ $i18n("ferry_welcome_intro") }}</p>
            </header>

            <section v-if="showPermissionsInfo" class="card">
                <h2>{{ $i18n("ferry_welcome_permission_title") }}</h2>
                <p>{{ $i18n("ferry_welcome_permission_text") }}</p>
                <button class="btn primary" @click="requestPermissions">{{ $i18n("continue") }}</button>
            </section>

            <section class="card status" :class="statusTone">
                <span class="dot" />
                <div>
                    <div class="status-title">{{ statusTitle }}</div>
                    <div class="hint">{{ statusDetail }}</div>
                </div>
            </section>

            <section class="steps">
                <div class="step" :class="{ done: status?.hostRunning || status?.connected }">
                    <span class="num">1</span>
                    <div>
                        <h3>{{ $i18n("ferry_welcome_step1_title") }}</h3>
                        <p>{{ $i18n("ferry_welcome_step1_text") }}</p>
                        <p v-if="!(status?.hostRunning || status?.connected)" class="download">
                            <a class="btn primary" href="https://github.com/KeePassFerry/KeePassFerry/releases/latest/download/KeePassFerry-Setup.exe">
                                {{ $i18n("ferry_welcome_download") }}
                            </a>
                            <a class="link" href="https://github.com/KeePassFerry/KeePassFerry/releases/latest" target="_blank" rel="noopener">
                                {{ $i18n("ferry_welcome_download_other") }}
                            </a>
                        </p>
                    </div>
                </div>
                <div class="step" :class="{ done: status?.connected || status?.pairingCode }">
                    <span class="num">2</span>
                    <div>
                        <h3>{{ $i18n("ferry_welcome_step2_title") }}</h3>
                        <p>{{ $i18n("ferry_welcome_step2_text") }}</p>
                    </div>
                </div>
                <div class="step" :class="{ done: status?.connected }">
                    <span class="num">3</span>
                    <div>
                        <h3>{{ $i18n("ferry_welcome_step3_title") }}</h3>
                        <p>{{ $i18n("ferry_welcome_step3_text") }}</p>
                    </div>
                </div>
            </section>

            <section v-if="showToolbarInfo" class="card pin">
                <svg viewBox="0 0 24 24" class="pin-icon" aria-hidden="true">
                    <path d="M14 4l6 6-3 1-4 4 1 4-2 1-4-5-4 5M9 10l5 5" />
                </svg>
                <p>{{ $i18n("ferry_welcome_pin") }}</p>
            </section>
        </div>
    </v-app>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import "../styles";
import { isFirefox } from "webext-detect-page";

type Status = {
    hostRunning: boolean;
    connected: boolean;
    pairingCode: string;
    blockedUntil: number;
    databases: string[];
};

const manifest = chrome.runtime.getManifest();
const showPermissionsInfo = ref(false);
const showToolbarInfo = ref(!isFirefox());
const status = ref<Status>(null);

async function requestPermissions() {
    await chrome.permissions.request({ origins: ["<all_urls>"] });
}

async function refresh() {
    try {
        status.value = await chrome.runtime.sendMessage({ keepassferry: "connectionStatus" });
    } catch (e) {
        status.value = null;
    }
}

const statusTone = computed(() => {
    const s = status.value;
    if (s?.connected && s.databases.length > 0) return "ok";
    if (s?.connected || s?.pairingCode || s?.blockedUntil) return "warn";
    return "off";
});

const formattedCode = computed(() => {
    const c = status.value?.pairingCode ?? "";
    return c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c;
});

const statusTitle = computed(() => {
    const s = status.value;
    if (!s) return $STR("ferry_status_unknown");
    if (s.connected && s.databases.length > 0) return $STR("ferry_welcome_ready");
    if (s.pairingCode) return $STR("ferry_status_pairing");
    if (s.connected) return $STR("ferry_status_locked");
    if (s.blockedUntil) return $STR("ferry_status_blocked");
    return $STR("ferry_status_not_running");
});

const statusDetail = computed(() => {
    const s = status.value;
    if (!s) return "";
    if (s.connected && s.databases.length > 0) return $STR("ferry_welcome_ready_hint");
    if (s.pairingCode) return $STRF("ferry_status_pairing_hint", [formattedCode.value]);
    if (s.connected) return $STR("ferry_status_locked_hint");
    if (s.blockedUntil) return $STR("ferry_status_blocked_hint");
    return $STR("ferry_status_not_running_hint");
});

async function setup() {
    document.title = "KeePassFerry " + manifest.version;
    if (!(await chrome.permissions.contains({ origins: ["<all_urls>"] }))) {
        showPermissionsInfo.value = true;
        chrome.permissions.onAdded.addListener(permissions => {
            if (permissions.origins?.includes("<all_urls>")) showPermissionsInfo.value = false;
        });
    }
    await refresh();
    setInterval(refresh, 2000);
}
setup();
</script>

<style>
:root {
    --w-bg: #f4f6fb;
    --w-surface: #ffffff;
    --w-text: #0f172a;
    --w-muted: #64748b;
    --w-border: #e2e8f0;
    --w-accent: #1d4ed8;
    --w-ok: #16a34a;
    --w-warn: #d97706;
    --w-off: #94a3b8;
}
@media (prefers-color-scheme: dark) {
    :root {
        --w-bg: #0b1120;
        --w-surface: #111827;
        --w-text: #e5e7eb;
        --w-muted: #94a3b8;
        --w-border: #1f2937;
        --w-accent: #60a5fa;
    }
}
html, body, #main, .v-application {
    background: var(--w-bg) !important;
}
.welcome {
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 24px 64px;
    color: var(--w-text);
    font: 15px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.hero { text-align: center; margin-bottom: 8px; }
.hero-logo { border-radius: 18px; box-shadow: 0 10px 30px rgba(21, 73, 127, 0.3); }
.hero h1 { font-size: 34px; font-weight: 750; letter-spacing: -0.02em; margin: 18px 0 6px; }
.lead { font-size: 16.5px; color: var(--w-muted); max-width: 560px; margin: 0 auto; }
.card {
    background: var(--w-surface);
    border: 1px solid var(--w-border);
    border-radius: 16px;
    padding: 18px 22px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 4px 16px rgba(15, 23, 42, 0.05);
}
.card h2 { font-size: 17px; font-weight: 700; margin: 0 0 6px; }
.card p { margin: 0 0 12px; color: var(--w-muted); }
.status { display: flex; align-items: center; gap: 16px; }
.status .dot { width: 14px; height: 14px; border-radius: 50%; flex: none; background: var(--w-off); }
.status.ok .dot { background: var(--w-ok); box-shadow: 0 0 0 6px rgba(22, 163, 74, 0.18); }
.status.warn .dot { background: var(--w-warn); box-shadow: 0 0 0 6px rgba(217, 119, 6, 0.18); }
.status.off .dot { box-shadow: 0 0 0 6px rgba(148, 163, 184, 0.22); }
.status-title { font-weight: 700; font-size: 16px; }
.hint { color: var(--w-muted); font-size: 13.5px; }
.steps { display: flex; flex-direction: column; gap: 10px; }
.step {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    background: var(--w-surface);
    border: 1px solid var(--w-border);
    border-radius: 14px;
    padding: 16px 20px;
}
.step .num {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    background: var(--w-border);
    color: var(--w-text);
}
.step.done .num { background: var(--w-ok); color: #fff; }
.step h3 { margin: 3px 0 2px; font-size: 15.5px; font-weight: 700; }
.step p { margin: 0; color: var(--w-muted); font-size: 14px; }
.pin { display: flex; align-items: center; gap: 14px; }
.pin p { margin: 0; }
.pin-icon { width: 26px; height: 26px; flex: none; fill: none; stroke: var(--w-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.btn {
    font: inherit;
    font-weight: 600;
    border: 0;
    border-radius: 10px;
    padding: 9px 18px;
    cursor: pointer;
}
.btn.primary { background: var(--w-accent); color: #fff; }
.step .download { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: 10px; }
.download .btn { text-decoration: none; display: inline-block; }
.download .link { color: var(--w-accent); font-size: 13.5px; }
</style>
