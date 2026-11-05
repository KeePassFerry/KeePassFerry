import { copyStringToClipboard } from "../common/copyStringToClipboard";
import { FerryLog } from "../common/Logger";
import { Action } from "../common/Action";
import { AddonMessage } from "../common/AddonMessage";
import { Entry } from "../common/model/Entry";
import {setup as i18nSetup } from "../common/i18n";

const QUICK_ICON_USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0";
const QUICK_ICON_KEY = "M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm2.8-6.8L20 3m-3 3 3 3m-5.5-.5 2 2";
const QUICK_ICON_OTP = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2";
const ICON_MORE = "M5 12h.01M12 12h.01M19 12h.01";
const ICON_COPY = "M9 9h10v10H9zM5 15V5h10";
const ICON_BACK = "M15 18l-6-6 6-6";
const ICON_FIELD = "M4 7h16M4 12h16M4 17h10";
const ICON_KEEPASS = "M4 5h16v14H4zM4 9h16M14 13h4M14 16h2";

export class MatchedLoginsPanel {
    constructor(
        private myPort: chrome.runtime.Port,
        private closePanel: () => void,
        private parentFrameId: number,
        // Liste hängt an einem Feld (sonst mittig per Tastenkürzel: nichts zum Eintragen, ein Klick kopiert)
        private hasTarget = false
    ) {}

    public createNearNode(node: HTMLElement, entries: Entry[]) {
        const container = document.createElement("div");
        container.id = "Ferry-MatchedLoginsList";
        const list = document.createElement("ul");
        this.setLogins(entries, list);
        container.appendChild(list);
        node.parentNode.insertBefore(container, node.nextSibling);

        return container;
    }

    private setLogins(entries: Entry[], container) {
        FerryLog.debug("setting " + entries.length + " matched entries");

        // add every matched entry to the container(s)
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            let usernameDisplayValue = "[" + $STR("noUsername_partial_tip") + "]";
            const displayGroupPath = entry.database.name + "/" + entry.parentGroup.path;

            const usernameField = Entry.getUsernameField(entry);
            if (usernameField && usernameField.value) {
                usernameDisplayValue = usernameField.value;
            }

            const loginItem = document.createElement("li");
            loginItem.className = "ferry-login";
            loginItem.dataset.filename = entry.database.fileName;
            loginItem.dataset.formIndex = entry.formIndex.toString();
            loginItem.dataset.entryIndex = entry.entryIndex.toString();
            loginItem.dataset.uuid = entry.uuid;
            loginItem.title = $STRF("matchedLogin_tip", [
                entry.title,
                displayGroupPath,
                usernameDisplayValue
            ]);
            loginItem.tabIndex = i == 0 ? 0 : -1;

            // Symbol, Benutzername (fett) + Titel, Knopf für weitere Aktionen
            const row = document.createElement("div");
            row.className = "ferry-login-row";
            const icon = document.createElement("img");
            icon.className = "ferry-login-icon";
            icon.alt = "";
            icon.src = "data:image/png;base64," + entry.icon.iconImageData;
            const text = document.createElement("div");
            text.className = "ferry-login-text";
            const user = document.createElement("div");
            user.className = "ferry-login-user";
            user.textContent = usernameDisplayValue;
            const title = document.createElement("div");
            title.className = "ferry-login-title";
            title.textContent = entry.title;
            text.append(user, title);
            // Nur über eine zugehörige Domain gefunden (z. B. outlook.com auf login.live.com): Grund dazuschreiben
            const related = entry.relatedDomain ? $STRF("ferry_related_domain", [entry.relatedDomain]) : "";
            if (related) {
                const via = document.createElement("div");
                via.className = "ferry-login-related";
                via.textContent = related;
                text.append(via);
            }
            // Voller Text als Tooltip, falls die Zeile trotz breiterer Liste abgeschnitten wird
            text.title = [usernameDisplayValue, entry.title, related].filter(Boolean).join("\n");
            row.append(icon, text);
            // Ein Aktionsknopf statt einer Knopfreihe: einzelne Werte in dieses Feld eintragen oder kopieren, bearbeiten
            const more = this.quickButton(ICON_MORE, $STR("ferry_panel_more"), () => this.showActions(entry, usernameDisplayValue));
            more.classList.add("ferry-login-more");
            row.append(more);
            loginItem.appendChild(row);

            loginItem.addEventListener("keydown", e => this.keyboardNavHandler(e), false);
            loginItem.addEventListener(
                "click",
                function (event) {
                    event.stopPropagation();
                    if (event.button == 0 || event.button == 1) {
                        this.dispatchEvent(new Event("ferryCommand"));
                    }
                },
                false
            );
            loginItem.addEventListener(
                "ferryCommand",
                event => {
                    this.myPort.postMessage({
                        action: Action.ManualFill,
                        selectedEntryIndex: (event.currentTarget as any).dataset.entryIndex,
                        frameId: this.parentFrameId
                    });
                },
                false
            );
            container.appendChild(loginItem);
        }
    }

    private keyboardNavHandler(event: KeyboardEvent) {
        const target = event.target as HTMLLIElement;

        switch (event.keyCode) {
            case 13: // enter
                event.preventDefault();
                event.stopPropagation();
                target.dispatchEvent(new Event("ferryCommand"));
                break;
            case 40: // down
                event.preventDefault();
                event.stopPropagation();
                if (target.nextElementSibling) {
                    (target.nextElementSibling as HTMLLIElement).focus();
                }
                break;
            case 38: // up
                event.preventDefault();
                event.stopPropagation();
                if (target.previousElementSibling) {
                    (target.previousElementSibling as HTMLLIElement).focus();
                }
                break;
            case 27: // esc
                event.preventDefault();
                event.stopPropagation();
                this.closePanel();
                break;
        }
    }

    private close() {
        this.myPort.postMessage({ action: Action.CloseAllPanels } as AddonMessage);
    }

    // Aktionsansicht eines Eintrags statt der Liste: je Wert eine Zeile "in dieses Feld eintragen" mit ⧉ zum Kopieren,
    // darunter Bearbeiten. Das Panel wächst auf die nötige Höhe und kehrt mit "Zurück" zur Liste zurück
    private async showActions(entry: Entry, usernameDisplayValue: string) {
        const list = document.getElementById("Ferry-MatchedLoginsList");
        if (!list || document.getElementById("Ferry-EntryActions")) return;
        const ref = { uuid: entry.uuid, dbFileName: entry.database.fileName };
        const rows: { icon: string; label: string; fill: () => void | Promise<void>; copy: () => Promise<void> }[] = [];
        const fillValue = (value: string) => () =>
            this.myPort.postMessage({ action: Action.FillPanelTarget, frameId: this.parentFrameId, fillValue: value, filledEntry: ref } as AddonMessage);
        const copyValue = (value: string) => async () => {
            await copyStringToClipboard(value);
            this.close();
        };
        const user = Entry.getUsernameField(entry);
        const password = Entry.getPasswordField(entry);
        if (user?.value) rows.push({ icon: QUICK_ICON_USER, label: $STR("ferry_panel_username"), fill: fillValue(user.value), copy: copyValue(user.value) });
        if (password?.value) rows.push({ icon: QUICK_ICON_KEY, label: $STR("ferry_panel_password"), fill: fillValue(password.value), copy: copyValue(password.value) });
        // Einmalcode erst beim Klick aus KeePass holen (ändert sich alle 30 s)
        if (entry.hasOtp) {
            rows.push({
                icon: QUICK_ICON_OTP,
                label: $STR("ferry_panel_otp"),
                fill: () => this.myPort.postMessage({ action: Action.FillPanelTarget, frameId: this.parentFrameId, otpFor: ref, filledEntry: ref } as AddonMessage),
                copy: async () => {
                    const copied = await chrome.runtime.sendMessage({ keepassferry: "copyTotp", ...ref }).catch(() => false);
                    if (copied) this.close();
                }
            });
        }
        // Weitere Formularfelder des Eintrags (von KeePassFerry beim Speichern übernommen, z. B. E-Mail, Land)
        for (const f of entry.fields ?? []) {
            if (!f.value || f === user || f === password || f.type === "boolean" || f.type === "existing") continue;
            rows.push({ icon: ICON_FIELD, label: f.name || $STR("ferry_panel_field"), fill: fillValue(f.value), copy: copyValue(f.value) });
        }
        // Eigene Felder aus KeePass (Erweitert → Zeichenfolgen, z. B. PIN, Kundennummer); geschützte Werte erst beim Klick
        const extras = await Promise.race([
            chrome.runtime.sendMessage({ keepassferry: "getEntryExtras", ...ref }).catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 1500))
        ]) as { fields?: { name: string; isProtected: boolean; value: string }[] };
        const known = new Set(rows.map(r => r.label.toLowerCase()));
        for (const f of extras?.fields ?? []) {
            if (!f?.name || known.has(f.name.toLowerCase())) continue;
            if (!f.isProtected && !f.value) continue;
            const value = async (): Promise<string> =>
                f.isProtected
                    ? await chrome.runtime.sendMessage({ keepassferry: "getEntryFieldValue", ...ref, name: f.name }).catch(() => null)
                    : f.value;
            rows.push({
                icon: ICON_FIELD,
                label: f.name,
                fill: async () => {
                    const v = await value();
                    if (v) fillValue(v)();
                },
                copy: async () => {
                    const v = await value();
                    if (v) await copyValue(v)();
                }
            });
        }
        if (document.getElementById("Ferry-EntryActions")) return;

        const view = document.createElement("div");
        view.id = "Ferry-EntryActions";
        const head = document.createElement("div");
        head.className = "ferry-actions-head";
        const back = this.quickButton(ICON_BACK, $STR("ferry_panel_back"), () => {
            view.remove();
            list.style.display = "";
            this.myPort.postMessage({ action: Action.ResizePanel, frameId: this.parentFrameId, panelHeight: 0 } as AddonMessage);
            (list.querySelector("li.ferry-login") as HTMLElement)?.focus({ preventScroll: true });
        });
        back.classList.add("ferry-actions-back");
        const name = document.createElement("div");
        name.className = "ferry-actions-name";
        const nameUser = document.createElement("div");
        nameUser.className = "ferry-login-user";
        nameUser.textContent = usernameDisplayValue;
        const nameTitle = document.createElement("div");
        nameTitle.className = "ferry-login-title";
        nameTitle.textContent = entry.title;
        name.append(nameUser, nameTitle);
        // Symbol des Eintrags wie in der Liste
        const siteIcon = document.createElement("img");
        siteIcon.className = "ferry-login-icon";
        siteIcon.alt = "";
        siteIcon.src = "data:image/png;base64," + entry.icon.iconImageData;
        head.append(back, siteIcon, name);

        const heading = document.createElement("div");
        heading.className = "ferry-actions-heading";
        heading.textContent = this.hasTarget ? $STR("ferry_panel_fill_heading") : $STR("ferry_panel_copy_heading");

        const items = document.createElement("ul");
        items.className = "ferry-actions";
        const addRow = (icon: string, label: string, onClick: () => void | Promise<void>, copy?: () => Promise<void>) => {
            const li = document.createElement("li");
            li.className = "ferry-action";
            li.tabIndex = 0;
            const svg = this.icon(icon);
            const text = document.createElement("span");
            text.className = "ferry-action-label";
            text.textContent = label;
            li.append(svg, text);
            if (copy) {
                const copyButton = this.quickButton(ICON_COPY, $STR("ferry_panel_copy"), copy);
                copyButton.classList.add("ferry-action-copy");
                li.append(copyButton);
            }
            li.addEventListener("click", () => void onClick());
            li.addEventListener("keydown", e => {
                if (e.key === "Enter") void onClick();
                if (e.key === "Escape") this.closePanel();
                if (e.key === "ArrowDown") (li.nextElementSibling as HTMLElement)?.focus();
                if (e.key === "ArrowUp") (li.previousElementSibling as HTMLElement)?.focus();
            });
            items.append(li);
        };
        for (const r of rows) {
            if (this.hasTarget) addRow(r.icon, r.label, r.fill, r.copy);
            else addRow(r.icon, r.label, () => void r.copy());
        }
        // Eintrag in KeePass öffnen (Bearbeiten-Fenster von KeePass): dort, wo der Eintrag wirklich gepflegt wird
        const openInKeePass = () => {
            this.myPort.postMessage({ loginEditor: { uuid: entry.uuid, DBfilename: entry.database.fileName } } as AddonMessage);
            this.close();
        };
        addRow(ICON_KEEPASS, $STR("ferry_panel_open_keepass"), openInKeePass);
        items.lastElementChild?.classList.add("ferry-action-separated");

        view.append(head, heading, items);
        list.style.display = "none";
        list.parentNode.insertBefore(view, list.nextSibling);
        // Höhe aus dem tatsächlichen Inhalt: Kopf des Panels, Aktionsansicht und unterer Rand (sonst Scrollleiste)
        const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
        const needed = Math.ceil(view.getBoundingClientRect().top + window.scrollY + view.scrollHeight + bottomPadding + 12);
        this.myPort.postMessage({ action: Action.ResizePanel, frameId: this.parentFrameId, panelHeight: needed } as AddonMessage);
        // Fokus ohne Scrollen: die Ansicht ist noch so klein wie die Liste, bis das Panel gewachsen ist; sonst rutschte
        // der Inhalt kurz nach oben und sprang beim Wachsen von oben herein
        (items.firstElementChild as HTMLElement)?.focus({ preventScroll: true });
        view.scrollTop = 0;
        document.scrollingElement?.scrollTo(0, 0);
    }

    private icon(svgPath: string) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "ferry-action-icon");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", svgPath);
        svg.appendChild(path);
        return svg;
    }

    // Kleiner Symbolknopf in der Zeile (Klick wählt nicht den Eintrag zum Ausfüllen)
    private quickButton(svgPath: string, label: string, onClick: () => void | Promise<void>) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ferry-login-quick";
        b.tabIndex = -1;
        b.title = label;
        b.setAttribute("aria-label", label);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", svgPath);
        svg.appendChild(path);
        b.appendChild(svg);
        b.addEventListener("click", async event => {
            event.stopPropagation();
            event.preventDefault();
            await onClick();
        });
        return b;
    }


}

i18nSetup();
