import { copyStringToClipboard } from "../common/copyStringToClipboard";
import { KeeLog } from "../common/Logger";
import { Action } from "../common/Action";
import { AddonMessage } from "../common/AddonMessage";
import { Entry } from "../common/model/Entry";
import {setup as i18nSetup } from "../common/i18n";

const QUICK_ICON_USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0";
const QUICK_ICON_KEY = "M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm2.8-6.8L20 3m-3 3 3 3m-5.5-.5 2 2";

export class MatchedLoginsPanel {
    constructor(
        private myPort: chrome.runtime.Port,
        private closePanel: () => void,
        private parentFrameId: number
    ) {}

    public createNearNode(node: HTMLElement, entries: Entry[]) {
        const container = document.createElement("div");
        container.id = "Kee-MatchedLoginsList";
        const list = document.createElement("ul");
        this.setLogins(entries, list);
        container.appendChild(list);
        node.parentNode.insertBefore(container, node.nextSibling);

        return container;
    }

    private setLogins(entries: Entry[], container) {
        KeeLog.debug("setting " + entries.length + " matched entries");

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
            const more = document.createElement("button");
            more.className = "ferry-login-more";
            more.type = "button";
            more.tabIndex = -1;
            more.title = $STR("ferry_more_actions");
            more.setAttribute("aria-label", more.title);
            more.textContent = "⋯";
            row.append(icon, text);
            const quickUser = Entry.getUsernameField(entry);
            const quickPassword = Entry.getPasswordField(entry);
            if (quickUser?.value) row.append(this.quickCopyButton(QUICK_ICON_USER, $STR("copy_username_label"), quickUser.value));
            if (quickPassword?.value) row.append(this.quickCopyButton(QUICK_ICON_KEY, $STR("copy_password_label"), quickPassword.value));
            row.append(more);
            loginItem.appendChild(row);

            const loginContextActions = this.createContextActions(entry);
            loginItem.appendChild(loginContextActions);
            more.addEventListener("click", event => {
                event.stopPropagation();
                event.preventDefault();
                if (loginContextActions.classList.contains("enabled")) {
                    loginContextActions.classList.remove("enabled");
                    loginContextActions.classList.add("disabled");
                } else {
                    this.showContextActions(loginContextActions);
                }
            });

            loginItem.addEventListener("keydown", e => this.keyboardNavHandler(e), false);
            loginItem.addEventListener(
                "click",
                function (event) {
                    event.stopPropagation();
                    if (event.button == 0 || event.button == 1) {
                        this.dispatchEvent(new Event("keeCommand"));
                    }
                },
                false
            );
            loginItem.addEventListener(
                "contextmenu",
                event => {
                    event.stopPropagation();
                    event.preventDefault();
                    this.showContextActions(loginContextActions);
                },
                false
            );
            loginItem.addEventListener(
                "keeCommand",
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
                target.dispatchEvent(new Event("keeCommand"));
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
            case 93: // context
                event.preventDefault();
                event.stopPropagation();
                target.dispatchEvent(new Event("contextmenu"));
                break;
        }
    }

    // Kopierknopf in der Zeile; nach dem Kopieren schließt die Liste
    private quickCopyButton(svgPath: string, label: string, value: string) {
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
            await copyStringToClipboard(value);
            this.myPort.postMessage({ action: Action.CloseAllPanels } as AddonMessage);
        });
        return b;
    }

    public showContextActions(element: Element) {
        element.classList.remove("disabled");
        element.classList.add("enabled");
    }

    private createContextActions(this: MatchedLoginsPanel, entry: Entry) {
        const loginContextActions = document.createElement("div");
        loginContextActions.classList.add("disabled", "ferry-login-actions");

        const editButton = document.createElement("button");
        editButton.textContent = $STR("Logins_Context_Edit_Login_label");
        //"chrome://kee/skin/pencil.png"
        editButton.addEventListener(
            "click",
            event => {
                event.stopPropagation();
                event.preventDefault();
                this.myPort.postMessage({
                    loginEditor: {
                        uuid: entry.uuid,
                        DBfilename: entry.database.fileName
                    }
                } as AddonMessage);
                this.myPort.postMessage({
                    action: Action.CloseAllPanels
                } as AddonMessage);
            },
            false
        );
        editButton.addEventListener("keydown", event => {
            if (event.keyCode === 13) editButton.click();
        });
        loginContextActions.appendChild(editButton);

        const otherFieldCount = entry.fields.filter(f => f.type !== "password").length ?? 0;
        const passwordFieldCount = entry.fields.filter(f => f.type === "password").length ?? 0;

        // Benutzername und Passwort kopieren: Knöpfe direkt in der Zeile (quickCopyButton)
        if (otherFieldCount > 1) {
            entry.fields
                .filter(f => f.type !== "password")
                .forEach((o, i) => {
                    if (i != 0 && o.locators[0].type != "checkbox") {
                        const button = document.createElement("button");
                        button.textContent =
                            $STR("copy") + " " + o.name + " (" + o.locators[0].id + ")";
                        //"chrome://kee/skin/copy.png",
                        button.addEventListener(
                            "click",
                            async event => {
                                event.stopPropagation();
                                event.preventDefault();
                                await copyStringToClipboard(o.value);
                                this.myPort.postMessage({
                                    action: Action.CloseAllPanels
                                } as AddonMessage);
                            },
                            false
                        );
                        button.addEventListener("keydown", event => {
                            if (event.keyCode === 13) button.click();
                        });
                        loginContextActions.appendChild(button);
                    }
                });
        }
        if (passwordFieldCount > 1) {
            entry.fields
                .filter(f => f.type === "password")
                .forEach((p, i) => {
                    if (i != 0) {
                        const button = document.createElement("button");
                        button.textContent =
                            $STR("copy") + " " + p.name + " (" + p.locators[0].id + ")";
                        //"chrome://kee/skin/copy.png",
                        button.addEventListener(
                            "click",
                            async event => {
                                event.stopPropagation();
                                event.preventDefault();
                                await copyStringToClipboard(p.value);
                                this.myPort.postMessage({
                                    action: Action.CloseAllPanels
                                } as AddonMessage);
                            },
                            false
                        );
                        button.addEventListener("keydown", event => {
                            if (event.keyCode === 13) button.click();
                        });
                        loginContextActions.appendChild(button);
                    }
                });
        }
        return loginContextActions;
    }

}

i18nSetup();
