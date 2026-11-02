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

// Einstellungen, die im Plugin liegen: Passwortprüfung (HIBP) und abgelaufene Einträge ausblenden/erinnern.
// Änderungen fängt das Dokument ab (sofort, auch solange die Verbindung zu KeePass noch aufgebaut wird); den Stand
// liest loadPluginSettings beim Öffnen und erneut, sobald KeePass verbunden und entsperrt ist (refreshStatus)
function setupPluginSettings() {
    document.addEventListener("change", async e => {
        const target = e.target as HTMLInputElement & HTMLSelectElement;
        if (target?.id === "ferryHibpCheck") {
            try {
                await chrome.runtime.sendMessage({ keepassferry: "setHibpCheck", enabled: target.checked });
            } catch (err) {
                // Hintergrund startet gerade neu; beim nächsten Laden zeigt die Seite den gespeicherten Stand
            }
            refreshHibpProgress();
        } else if (target?.id === "ferryExpiryMode") {
            try {
                await chrome.runtime.sendMessage({ keepassferry: "setHideExpired", hide: target.value === "hide" });
            } catch (err) {
                // wie oben
            }
        } else if (target?.id === "ferryExpiryWarnDays") {
            configManager.setASAP({ ferryExpiryWarnDays: parseInt(target.value, 10) || 0 });
        }
    });
}

async function loadPluginSettings() {
    let s: { hibpCheck?: boolean; expiry?: boolean } = null;
    try {
        s = await chrome.runtime.sendMessage({ keepassferry: "connectionStatus" });
    } catch (e) {
        s = null;
    }
    const hibpSupported = !!s?.hibpCheck;
    const expirySupported = !!s?.expiry;
    let hibp = false;
    let hide = false;
    try {
        if (hibpSupported) hibp = !!(await chrome.runtime.sendMessage({ keepassferry: "getHibpCheck" }));
        if (expirySupported) hide = !!(await chrome.runtime.sendMessage({ keepassferry: "getHideExpired" }));
    } catch (e) {
        // ohne Verbindung bleibt der angezeigte Stand
    }
    const hibpInput = document.getElementById("ferryHibpCheck") as HTMLInputElement;
    const hibpHint = document.getElementById("ferryHibpHint");
    if (hibpInput) {
        hibpInput.checked = hibp;
        hibpInput.disabled = !hibpSupported;
    }
    if (hibpHint) hibpHint.textContent = hibpSupported ? $STR("ferry_setting_hibp_hint") : $STR("ferry_setting_hibp_unavailable");

    await configManager.load();
    const mode = document.getElementById("ferryExpiryMode") as HTMLSelectElement;
    const warn = document.getElementById("ferryExpiryWarnDays") as HTMLSelectElement;
    const modeHint = document.getElementById("ferryExpiryModeHint");
    if (mode) {
        mode.value = hide ? "hide" : "remind";
        mode.disabled = !expirySupported;
    }
    if (warn) {
        warn.value = String(configManager.current.ferryExpiryWarnDays ?? 7);
        warn.disabled = !expirySupported;
    }
    if (modeHint) modeHint.textContent = expirySupported ? $STR("ferry_setting_expiryMode_hint") : $STR("ferry_setting_expiryMode_unavailable");
    refreshHibpProgress();
}

// Stand der Passwortprüfung unter dem Schalter (alle 3 s, nur wenn eingeschaltet)
async function refreshHibpProgress() {
    const box = document.getElementById("ferryHibpProgress");
    const input = document.getElementById("ferryHibpCheck") as HTMLInputElement;
    if (!box || !input) return;
    let p: { total: number; done: number; leaked: number; running: boolean; lastPass?: string; lastFailure?: string } = null;
    if (input.checked && !input.disabled) {
        try {
            p = await chrome.runtime.sendMessage({ keepassferry: "getHibpProgress" });
        } catch (e) {
            p = null;
        }
    }
    if (!p || !p.total) {
        box.hidden = true;
        return;
    }
    box.hidden = false;
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = Math.round((100 * p.done) / p.total) + "%";
    bar.append(fill);
    const text = document.createElement("span");
    text.textContent = $STRF("ferry_hibp_progress", [p.done.toLocaleString(), p.total.toLocaleString()]) +
        (p.running || p.done < p.total ? " · " + $STR("ferry_hibp_progress_running") : "");
    const parts: HTMLElement[] = [bar, text];
    if (p.leaked > 0) {
        const leaked = document.createElement("span");
        leaked.className = "leaked";
        leaked.textContent = $STRF("ferry_hibp_progress_leaked", [p.leaked.toLocaleString()]);
        parts.push(leaked);
    }
    // Zuletzt geprüft bzw. Verbindungsproblem (statt einer Meldung in Windows)
    const when = (iso: string) =>
        new Date(iso).toLocaleString(chrome.i18n.getUILanguage(), { dateStyle: "short", timeStyle: "short" });
    if (p.lastFailure) {
        const failure = document.createElement("span");
        failure.className = "leaked";
        failure.textContent = $STRF("ferry_hibp_offline", [when(p.lastFailure)]);
        parts.push(failure);
    } else if (p.lastPass) {
        const last = document.createElement("span");
        last.textContent = $STRF("ferry_hibp_last_check", [when(p.lastPass)]);
        parts.push(last);
    }
    box.replaceChildren(...parts);
}

let pluginReady = false;

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
    const ready = !!s?.connected && (s?.databases?.length ?? 0) > 0;
    if (ready && !pluginReady) loadPluginSettings();
    pluginReady = ready;
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
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#ferryNav a[data-panel]"));
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
setupClipboardPermission();
setupResetPairing();
setupNav();
refreshStatus();
setupPluginSettings();
loadPluginSettings();
highlightFromHash();
setInterval(refreshHibpProgress, 3000);
setInterval(refreshStatus, 2000);
