/*
ferry.ts: Ergänzungen der Einstellungsseite
- Verbindungsstatus zu KeePass (alle 2 s aktualisiert) und "Kopplung zurücksetzen"
- Hell/Dunkel nach Einstellung bzw. System
- Seitennavigation: aktiver Abschnitt beim Scrollen
*/
import { configManager } from "../common/ConfigManager";

type Status = {
    hostRunning: boolean;
    connected: boolean;
    paired: boolean;
    pairingCode: string;
    blockedUntil: number;
    hostError: string;
    databases: string[];
    pluginVersion?: string;
    pluginOutdated?: boolean;
};

// Eigene Passwortspeicherung von Edge: abschalten (KeePassFerry übernimmt) oder wieder freigeben
async function applyBrowserPasswordSaving(disable: boolean) {
    try {
        if (disable) await chrome.privacy.services.passwordSavingEnabled.set({ value: false });
        else await chrome.privacy.services.passwordSavingEnabled.clear({});
    } catch (e) {
        // Richtlinie des Administrators o. Ä.
    }
}

function applyTheme(theme: string) {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
}

async function setupTheme() {
    await configManager.load();
    applyTheme(configManager.current.theme ?? "");
    document.getElementById("pref_theme_desc")?.addEventListener("change", e => applyTheme((e.target as HTMLSelectElement).value));

    // KeePassFerry-Schalter (data-ferry-setting = Name in der Konfiguration)
    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("input[data-ferry-setting]"))) {
        const key = input.dataset.ferrySetting;
        input.checked = !!(configManager.current as any)[key];
        input.addEventListener("change", async () => {
            configManager.setASAP({ [key]: input.checked } as any);
            if (key === "ferryDisableBrowserPasswordSaving") await applyBrowserPasswordSaving(input.checked);
        });
    }

    // Diagnoseprotokoll (Entwicklung)
    const diag = document.getElementById("ferryDiagnostics") as HTMLInputElement;
    if (diag) {
        diag.checked = !!configManager.current.ferryDiagnostics;
        diag.addEventListener("change", () => configManager.setASAP({ ferryDiagnostics: diag.checked }));
    }
}

async function refreshStatus() {
    let s: Status = null;
    try {
        s = await chrome.runtime.sendMessage({ keepassferry: "connectionStatus" });
    } catch (e) {
        // Hintergrund startet gerade neu
    }
    const dot = document.getElementById("ferryStatusDot");
    const title = document.getElementById("ferryStatusTitle");
    const detail = document.getElementById("ferryStatusDetail");
    if (!dot || !title || !detail) return;

    let tone: "ok" | "warn" | "off";
    let t: string;
    let d: string;
    if (!s) {
        tone = "off";
        t = $STR("ferry_status_unknown");
        d = "";
    } else if (s.connected && s.pluginOutdated) {
        tone = "warn";
        t = $STR("ferry_plugin_update_title");
        d = $STR("ferry_plugin_update_message");
    } else if (s.connected && s.databases.length > 0) {
        tone = "ok";
        t = $STR("ferry_status_connected");
        d = s.databases.join(" · ") + (s.pluginVersion ? " · " + $STRF("ferry_plugin_version", [s.pluginVersion]) : "");
    } else if (s.pairingCode) {
        tone = "warn";
        t = $STR("ferry_status_pairing");
        d = $STRF("ferry_status_pairing_hint", [s.pairingCode.length === 6 ? s.pairingCode.slice(0, 3) + " " + s.pairingCode.slice(3) : s.pairingCode]);
    } else if (s.connected) {
        tone = "warn";
        t = $STR("ferry_status_locked");
        d = $STR("ferry_status_locked_hint");
    } else if (s.blockedUntil > 0) {
        tone = "warn";
        t = $STR("ferry_status_blocked");
        d = $STR("ferry_status_blocked_hint");
    } else if (s.hostError && /not found|nicht gefunden|Specified native messaging host/i.test(s.hostError)) {
        tone = "off";
        t = $STR("ferry_status_no_host");
        d = $STR("ferry_status_no_host_hint");
    } else {
        tone = "off";
        t = $STR("ferry_status_not_running");
        d = $STR("ferry_status_not_running_hint");
    }
    dot.className = "status-dot " + tone;
    title.textContent = t;
    detail.textContent = d;
}

function setupResetPairing() {
    const button = document.getElementById("ferryResetPairing") as HTMLButtonElement;
    button?.addEventListener("click", async () => {
        if (!confirm($STR("ferry_reset_pairing_confirm"))) return;
        button.disabled = true;
        try {
            await chrome.runtime.sendMessage({ keepassferry: "resetPairing" });
        } finally {
            button.disabled = false;
            refreshStatus();
        }
    });
}

function setupNav() {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#ferryNav a"));
    for (const a of links) {
        a.addEventListener("click", e => {
            e.preventDefault();
            document.getElementById(a.dataset.panel)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }
    const observer = new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                for (const a of links) a.classList.toggle("active", a.dataset.panel === entry.target.id);
            }
        },
        { rootMargin: "-20% 0px -70% 0px" }
    );
    for (const a of links) {
        const panel = document.getElementById(a.dataset.panel);
        if (panel) observer.observe(panel);
    }
}

setupTheme();
setupResetPairing();
setupNav();
refreshStatus();
setInterval(refreshStatus, 2000);
