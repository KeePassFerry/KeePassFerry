import { FerryLog } from "../common/Logger";
import { configManager } from "../common/ConfigManager";
import { Entry } from "../common/model/Entry";
import { setup as i18nSetup } from "../common/i18n";

// Auswahl wie im Passkey-Dialog: Eintrag markieren, mit "Anmelden" bestätigen (Doppelklick und Enter direkt).
// "Abbrechen" schließt das Fenster, der Browser zeigt dann sein eigenes Anmeldefenster.
class NetworkAuth {
    private selected = 0;
    private items: HTMLButtonElement[] = [];
    // Kein passender Eintrag: Benutzername und Passwort selbst eingeben; mit Haken öffnet sich nach erfolgreicher
    // Anmeldung das Speichern-Popup
    private manual = false;

    public setupPage(entries: Entry[], realm: string, url: string, isProxy: boolean, canSave: boolean) {
        let host = url;
        try {
            host = new URL(url).host || url;
        } catch (e) {
            // keine gültige Adresse: so anzeigen, wie sie kam
        }
        document.getElementById("network_auth_site").textContent = $STRF(
            isProxy ? "ferry_netauth_proxy" : "ferry_netauth_site",
            [host]
        );
        document.getElementById("network_auth_realm").textContent = realm ? $STRF("ferry_netauth_realm", [realm]) : "";
        if (entries.length === 0) {
            this.manual = true;
            document.getElementById("network_auth_question").textContent = $STR("ferry_netauth_question_new");
            document.getElementById("network_auth_list").hidden = true;
            document.getElementById("network_auth_form").hidden = false;
            document.getElementById("network_auth_save_row").hidden = !canSave;
            (document.getElementById("network_auth_username") as HTMLInputElement).focus();
            return;
        }
        document.getElementById("network_auth_question").textContent = $STR(
            entries.length === 1 ? "ferry_netauth_question_one" : "ferry_netauth_question_many"
        );
        const list = document.getElementById("network_auth_list");
        if (entries.length === 1) list.classList.add("single");
        FerryLog.debug("setting " + entries.length + " matched entries");
        entries.forEach((entry, i) => list.append(this.createItem(entry, i)));
        this.select(0);
    }

    private createItem(entry: Entry, index: number) {
        const username = Entry.getUsernameField(entry)?.value || "[" + $STR("noUsername_partial_tip") + "]";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "item";
        b.setAttribute("role", "radio");
        const radio = document.createElement("span");
        radio.className = "radio";
        const text = document.createElement("span");
        text.className = "text";
        const title = document.createElement("span");
        title.className = "title";
        title.textContent = username;
        const sub = document.createElement("span");
        sub.className = "subtitle";
        sub.textContent = entry.title + " · " + entry.parentGroup.path;
        text.append(title, sub);
        b.append(radio, text);
        b.title = $STRF("matchedLogin_tip", [entry.title, entry.database.name + "/" + entry.parentGroup.path, username]);
        b.addEventListener("click", () => this.select(index));
        b.addEventListener("dblclick", () => this.submit(index));
        this.items.push(b);
        return b;
    }

    private select(index: number) {
        if (index < 0 || index >= this.items.length) return;
        this.selected = index;
        this.items.forEach((b, i) => {
            b.classList.toggle("selected", i === index);
            b.setAttribute("aria-checked", i === index ? "true" : "false");
            b.tabIndex = i === index ? 0 : -1;
        });
        this.items[index].focus();
    }

    async submit(index = this.selected) {
        let message;
        if (this.manual) {
            const username = (document.getElementById("network_auth_username") as HTMLInputElement).value;
            const password = (document.getElementById("network_auth_password") as HTMLInputElement).value;
            const saveRow = document.getElementById("network_auth_save_row");
            const save = !saveRow.hidden && (document.getElementById("network_auth_save") as HTMLInputElement).checked;
            message = { action: "NetworkAuth_ok", username, password, save };
        } else {
            if (!this.items[index]) return;
            message = { action: "NetworkAuth_ok", selectedEntryIndex: index };
        }
        const tab = await chrome.tabs.getCurrent();
        await chrome.runtime.sendMessage(message);
        await chrome.tabs.remove(tab.id);
    }

    public onKey(event: KeyboardEvent) {
        if (event.key === "Enter") {
            // Enter auf "Abbrechen" bzw. dem Haken bleibt dessen Aktion
            const id = (event.target as HTMLElement)?.id;
            if (id === "network_auth_cancel" || id === "network_auth_save") return;
            event.preventDefault();
            this.submit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            window.close();
        } else if (!this.manual && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            this.select(this.selected + (event.key === "ArrowDown" ? 1 : -1));
        }
    }
}

let networkAuth: NetworkAuth;

async function setupNetworkAuthDialog() {
    await configManager.load();
    FerryLog.attachConfig(configManager.current);
    const theme = configManager.current.theme;
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    networkAuth = new NetworkAuth();
    chrome.runtime.onMessage.addListener(message => {
        if (message && message.action && message.action === "NetworkAuth_matchedEntries") {
            networkAuth.setupPage(message.entries, message.realm, message.url, message.isProxy, !!message.canSave);
        }
    });
    chrome.runtime.sendMessage({ action: "NetworkAuth_load" });
    document.getElementById("network_auth_cancel").addEventListener("click", () => window.close());
    document.getElementById("network_auth_ok").addEventListener("click", () => networkAuth.submit());
    // Enter im Formular nicht als Seiten-Submit (würde das Fenster neu laden)
    document.getElementById("network_auth_form").addEventListener("submit", e => e.preventDefault());
    document.addEventListener("keydown", e => networkAuth.onKey(e), true);
    document.getElementById("i18n_root").style.display = "flex";
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => await setupNetworkAuthDialog());
} else {
    (async () => {
        await setupNetworkAuthDialog();
    })();
}

i18nSetup();
