/*
ferry.ts: Ergänzungen der Einstellungsseite
- Verbindungsstatus zu KeePass (alle 2 s aktualisiert) und "Kopplung zurücksetzen"
- Hell/Dunkel nach Einstellung bzw. System
- Seitennavigation: aktiver Abschnitt beim Scrollen
*/
import { CONFIG_PREFIX, configManager } from "../common/ConfigManager";
import { browserName } from "../common/browserName";

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
    optionsDialog?: boolean;
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

    // Unterpunkte (data-parent-setting): nur bedienbar, wenn die übergeordnete Einstellung an ist
    for (const sub of Array.from(document.querySelectorAll<HTMLElement>("[data-parent-setting]"))) {
        const parent = document.querySelector<HTMLInputElement>(`input[data-ferry-setting="${sub.dataset.parentSetting}"]`);
        const input = sub.querySelector<HTMLInputElement>("input");
        if (!parent || !input) continue;
        const apply = () => {
            sub.classList.toggle("off", !parent.checked);
            input.disabled = !parent.checked;
        };
        apply();
        parent.addEventListener("change", apply);
    }

    // Diagnoseprotokoll (Entwicklung)
    const diag = document.getElementById("ferryDiagnostics") as HTMLInputElement;
    if (diag) {
        diag.checked = !!configManager.current.ferryDiagnostics;
        diag.addEventListener("change", () => configManager.setASAP({ ferryDiagnostics: diag.checked }));
    }
}

// "Aus Zwischenablage einfügen" im Popup: optionale Berechtigung clipboardRead hier erteilen oder entziehen.
// Im Popup selbst würde die Abfrage das Popup schließen; dieser Tab bleibt offen.
async function setupClipboardPermission() {
    const input = document.getElementById("ferryClipboardRead") as HTMLInputElement;
    if (!input) return;
    const perm = { permissions: ["clipboardRead"] } as chrome.permissions.Permissions;
    input.checked = await chrome.permissions.contains(perm);
    input.addEventListener("change", async () => {
        try {
            if (input.checked) input.checked = await chrome.permissions.request(perm);
            else await chrome.permissions.remove(perm);
        } catch (e) {
            input.checked = await chrome.permissions.contains(perm);
        }
    });
}

// Vom Popup aus geöffnet (#clipboard, #hibp): Zeile zeigen und hervorheben
// Erst nach dem vollständigen Aufbau (Übersetzungen, Abschnitte) scrollen, sonst verschiebt sich das Layout danach
function highlightFromHash() {
    const id = location.hash.slice(1);
    if (!["clipboard", "hibp"].includes(id)) return;
    const show = () =>
        requestAnimationFrame(() => {
            const row = document.getElementById(id);
            row?.scrollIntoView({ block: "center", behavior: "smooth" });
            row?.classList.add("highlight");
            row?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
        });
    if (document.readyState === "complete") setTimeout(show, 150);
    else window.addEventListener("load", () => setTimeout(show, 150), { once: true });
}

// Einstellungen, die in KeePass wirken (Datenlecks-Prüfung, abgelaufene Einträge), liegen im KeePassFerry-Optionsdialog
// von KeePass; die Knöpfe öffnen ihn. Ohne verbundenes KeePass (oder mit älterem Plugin) sind sie gesperrt.
function setupPluginSettings() {
    document.addEventListener("click", async e => {
        const button = (e.target as HTMLElement)?.closest?.(".ferry-open-keepass-options") as HTMLButtonElement;
        if (!button) return;
        button.disabled = true;
        try {
            await chrome.runtime.sendMessage({ keepassferry: "openKeePassOptions" });
        } catch (err) {
            // Hintergrund startet gerade neu
        } finally {
            button.disabled = false;
        }
    });
}

function updateKeePassOptionButtons(available: boolean) {
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".ferry-open-keepass-options"))) {
        button.disabled = !available;
        button.title = available ? "" : $STR("ferry_open_keepass_options_unavailable");
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
    // KeePass gerade verbunden und entsperrt (z. B. nach dem Neuladen der Erweiterung): Plugin-Einstellungen neu lesen
    const ready = !!s?.connected && !s?.pluginOutdated && (s?.databases?.length ?? 0) > 0;
    updateKeePassOptionButtons(!!s?.optionsDialog);
    const update = document.getElementById("ferryPluginUpdate");
    if (update) update.hidden = !(s?.connected && s?.pluginOutdated);
    dot.className = "status-dot " + tone;
    title.textContent = t;
    detail.textContent = d;
}

// "Jetzt aktualisieren" neben dem Hinweis "Neue Version für KeePass verfügbar" (wie im Popup)
function setupPluginUpdate() {
    const button = document.getElementById("ferryPluginUpdate") as HTMLButtonElement;
    button?.addEventListener("click", async () => {
        const done = () => {
            button.disabled = false;
            button.classList.remove("busy");
        };
        button.disabled = true;
        button.classList.add("busy");
        const result = await chrome.runtime.sendMessage({ keepassferry: "startPluginUpdate" }).catch(() => null);
        // Abgebrochen oder fehlgeschlagen: gleich wieder klickbar; sonst läuft das Setup und KeePass startet neu
        if (result !== "started") done();
        else setTimeout(done, 60000);
    });
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
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#ferryNav a[data-panel]"));
    for (const a of links) {
        a.addEventListener("click", e => {
            e.preventDefault();
            for (const other of links) other.classList.toggle("active", other === a);
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
    // Die letzten Abschnitte erreichen den oberen Bereich nie, wenn die Seite zu Ende ist: unten den letzten markieren
    window.addEventListener("scroll", () => {
        if (window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 4) return;
        for (const a of links) a.classList.toggle("active", a === links[links.length - 1]);
    }, { passive: true });
}

// Texte mit dem Namen des Browsers (Edge, Chrome, Brave …); unbekannter Browser: allgemeine Fassung (Schlüssel + "_generic")
function applyBrowserName() {
    const name = browserName();
    document.querySelectorAll<HTMLElement>("[data-i18n-browser]").forEach(el => {
        const key = el.dataset.i18nBrowser;
        el.textContent = name ? $STRF(key, [name]) : $STR(key + "_generic");
    });
}

applyBrowserName();
setupTheme();
setupClipboardPermission();
setupResetPairing();
setupPluginUpdate();
setupNav();
refreshStatus();
setupPluginSettings();
// Im Popup geänderte Einstellungen (z. B. "Neue Einträge immer hier speichern"): beim Zurückkehren neu laden, damit
// die Seite nicht den alten Stand zeigt
let changedWhileHidden = false;
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && document.hidden && Object.keys(changes).some(k => k.startsWith(CONFIG_PREFIX))) changedWhileHidden = true;
});
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && changedWhileHidden) location.reload();
});
highlightFromHash();
setInterval(refreshStatus, 2000);
