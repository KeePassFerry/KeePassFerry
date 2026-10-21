import { FormUtils } from "./formsUtils";
import { Action } from "../common/Action";
import { type AddonMessage } from "../common/AddonMessage";
import { MatchedField } from "./MatchedField";
import { Entry } from "../common/model/Entry";
import { FloatingFieldIcons } from "./FloatingFieldIcons";
import { isUsernameField } from "./loginFields";
import { pageDiag } from "./ferryDiagPage";
import { configManager } from "../common/ConfigManager";
import { drawLockGlyph, LOCK_COLOR } from "../common/lockGlyph";

export class KeeFieldIcon {
    constructor(
        private myPort: chrome.runtime.Port,
        private parentFrameId: number,
        private formUtils: FormUtils,
        private createMatchedLoginsPanelNearNode: (e: HTMLElement) => void
    ) {}

    // Schwebende Symbole neben Benutzer- und Passwortfeldern (Klick öffnet die Auswahl)
    private icons = new FloatingFieldIcons();
    // Angezeigte Breite des Icons (16 px, mit Anzahl-Plakette breiter)
    private iconWidth = 16;
    private passwordFields: MatchedField[];
    private otherFields: MatchedField[];

    // Gesperrt: Symbole bleiben stehen, ein Klick entsperrt (Windows Hello) statt die Auswahl zu öffnen
    private locked = false;
    public onUnlockRequested: () => void = () => undefined;

    public removeKeeIconFromAllFields() {
        this.icons.clear();
        this.locked = false;
        this.passwordFields = null;
        this.otherFields = null;
    }

    // Datenbank gesperrt: vorhandene Symbole auf "gesperrt" stellen und erkannte Anmeldefelder (Passwort,
    // Benutzer nach loginFields.ts) mit dem Gesperrt-Symbol versehen. Ein Klick entsperrt, nichts geschieht von selbst.
    public lockKeeIcons(loginFields: HTMLElement[] = []) {
        if (configManager.current.ferryShowFieldIcons === false) return;
        const elements = [...this.icons.elements(), ...loginFields.filter(el => !this.icons.has(el) && el.offsetWidth >= 50)];
        pageDiag("gesperrt-symbole", { vorhanden: this.icons.elements().length, anmeldefelder: loginFields.length, gesetzt: elements.length });
        if (elements.length === 0) return;
        this.locked = true;
        this.iconWidth = KeeFieldIcon.LOCKED_ICON_WIDTH;
        KeeFieldIcon.lockedIcon().then(image => {
            if (!this.locked) return;
            for (const el of elements) {
                if (this.icons.has(el)) {
                    this.icons.setImage(el, image, KeeFieldIcon.LOCKED_ICON_WIDTH);
                    this.icons.setLabel(el, $STR("ferry_field_icon_locked"));
                } else if (el.isConnected) {
                    this.icons.add(el, {
                        image,
                        width: KeeFieldIcon.LOCKED_ICON_WIDTH,
                        label: $STR("ferry_field_icon_locked"),
                        onClick: () => this.onIconClick(el)
                    });
                }
            }
        });
    }

    // Gesperrt-Symbol: KeePassFerry-Symbol mit oranger Plakette und weißem Schloss daneben (wie die Trefferzahl).
    // Angezeigt 29 × 16 px (Leinwand doppelt so groß für scharfe Darstellung).
    static readonly LOCKED_ICON_WIDTH = 29;
    private static lockedIconPromise: Promise<string> = null;
    public static lockedIcon(): Promise<string> {
        if (!KeeFieldIcon.lockedIconPromise) {
            KeeFieldIcon.lockedIconPromise = new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    const pillWidth = 24;
                    const canvas = document.createElement("canvas");
                    canvas.width = 32 + 2 + pillWidth;
                    canvas.height = 32;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, 32, 32);
                    const x = 34;
                    const r = 12;
                    ctx.beginPath();
                    ctx.moveTo(x + r, 4);
                    ctx.arcTo(x + pillWidth, 4, x + pillWidth, 28, r);
                    ctx.arcTo(x + pillWidth, 28, x, 28, r);
                    ctx.arcTo(x, 28, x, 4, r);
                    ctx.arcTo(x, 4, x + pillWidth, 4, r);
                    ctx.closePath();
                    ctx.fillStyle = LOCK_COLOR;
                    ctx.fill();
                    drawLockGlyph(ctx, x + pillWidth / 2, 16, 16);
                    resolve(canvas.toDataURL());
                };
                img.onerror = () => resolve(KeeFieldIcon.FERRY_ICON_32);
                img.src = KeeFieldIcon.FERRY_ICON_32;
            });
        }
        return KeeFieldIcon.lockedIconPromise;
    }

    private onIconClick(element: HTMLElement) {
        if (this.locked) {
            this.myPort.postMessage({ requestUnlock: true } as AddonMessage);
            this.onUnlockRequested();
            return;
        }
        this.showMatchedLoginsPanel(element);
    }

    public addKeeIconToFields(
        passwordFields: MatchedField[],
        otherFields: MatchedField[],
        entries: Entry[]
    ) {
        this.passwordFields = passwordFields;
        this.otherFields = otherFields;
        // Einstellung "Symbole in Eingabefeldern" aus: Auswahl nur über das Popup
        if (configManager.current.ferryShowFieldIcons === false) return;

        if (entries.length > 1) {
            this.getLabelledIcon(entries.length > 9 ? "9+" : entries.length.toString());
        } else {
            this.iconWidth = 16;
            this.afterImageLoaded(KeeFieldIcon.FERRY_ICON_32);
        }
    }

    private skipField(field: MatchedField) {
        if (
            !this.formUtils.isATextFormFieldType(field.field.type) &&
            field.field.type != "password"
        ) {
            return true;
        }
        if (
            !field.DOMelement ||
            field.DOMelement instanceof HTMLSelectElement ||
            !field.DOMelement.isConnected
        ) {
            return true;
        }
        if (field.DOMelement.maxLength > 0 && field.DOMelement.maxLength <= 3) return true;
        if (field.DOMelement.offsetWidth < 50) return true;
        // Textfelder nur, wenn sie das Benutzerfeld einer Anmeldung sind (Regeln in loginFields.ts)
        if (field.field.type !== "password" && !isUsernameField(field.DOMelement as HTMLInputElement)) return true;
        return false;
    }

    private addIcon(field: MatchedField, image: string) {
        const element: HTMLElement = field.DOMelement;
        this.locked = false;
        if (this.icons.has(element)) {
            this.icons.setImage(element, image, this.iconWidth);
            this.icons.setLabel(element, $STR("ferry_field_icon_label"));
            return;
        }
        this.icons.add(element, {
            image,
            width: this.iconWidth,
            label: $STR("ferry_field_icon_label"),
            onClick: () => this.onIconClick(element)
        });
    }

    private limitFields(fields: MatchedField[]) {
        const orderedFields = fields
            .filter(f => !this.skipField(f))
            .sort((a, b) => {
                if (a.highestScore === b.highestScore) return 0;
                return a.highestScore < b.highestScore ? 1 : -1;
            });
        return orderedFields.slice(0, 2);
    }

    private afterImageLoaded(image: string) {
        // Put icons in only the top 2 matching password and text fields
        const fieldSet1 = this.limitFields(this.passwordFields);
        const fieldSet2 = this.limitFields(this.otherFields);
        for (const field of fieldSet1.concat(fieldSet2)) {
            this.addIcon(field, image);
        }
    }

    private showMatchedLoginsPanel(element: HTMLElement) {
        if (this.parentFrameId !== 0) {
            this.myPort.postMessage({
                action: Action.ShowMatchedLoginsPanel
            } as AddonMessage);
        } else {
            this.createMatchedLoginsPanelNearNode(element);
        }
    }

    // Schlüssel-Icon plus grüne Plakette mit der Anzahl passender Einträge daneben.
    // Gezeichnet in doppelter Auflösung (Höhe 32 px), angezeigt mit 16 px Höhe.
    private getLabelledIcon(text: string) {
        const pillWidth = text.length > 1 ? 30 : 24;
        const canvas = document.createElement("canvas");
        canvas.height = 32;
        canvas.width = 32 + 2 + pillWidth;
        const img = document.createElement("img");
        img.addEventListener("load", () => {
            const context = canvas.getContext("2d");
            context.drawImage(img, 0, 0, 32, 32);
            const x = 34;
            const r = 12;
            context.beginPath();
            context.moveTo(x + r, 4);
            context.arcTo(x + pillWidth, 4, x + pillWidth, 28, r);
            context.arcTo(x + pillWidth, 28, x, 28, r);
            context.arcTo(x, 28, x, 4, r);
            context.arcTo(x, 4, x + pillWidth, 4, r);
            context.closePath();
            context.fillStyle = "#16a34a";
            context.fill();
            context.fillStyle = "#ffffff";
            context.font = "bold 19px Arial, sans-serif";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(text, x + pillWidth / 2, 17);
            this.iconWidth = canvas.width / 2;
            this.afterImageLoaded(canvas.toDataURL());
        });
        img.src = KeeFieldIcon.FERRY_ICON_32;
    }

    // KeePassFerry-Feld-Icon 32 px (branding/keepassferry-field.svg → branding/png/field-32.png)
    static readonly FERRY_ICON_32 =
        // eslint-disable-next-line max-len
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACrElEQVR4nMRXS2gTURQ9M0mqbUUU20LdKKGCixYEXbRFsK5MwYUgfqBqFy6qi+4UQbDGBtzYXanURRdVlKJ0V8zoQmOx1k3AzyaLEFwEhSaiVBNjazPOefGFSTL5qJnJgZn3u8k57869d96oaDDcVpMdvmt9WSjDiqIcNobecnY14JdxxXRdf65Cn13RAsvFBkrxRJtvbNogHoENMITcSWrjF8oKaB/0a4bZEdgK5Uki6PfJkUt2cjvHKdiPrpauQ53p6IsFIYc3PnNdUV/BQSh6tp8xoXLAgIPDkJwiuv9Eu6OQnDK9vHAeXrOAqnnesX2LaFe+fEed4M7fKpGOnjiI4wM9aNvWKuaSX1OYD73H5KOXdRGjllvo696F0NRFjBzrzZMT7HOOa7SxRQB3PnP1ZAExd2veMddoIx9NXQXQ7ZKcpOfG59A9NCEu9qUQ2tD2f2AZA3zmEpcmF6C9juTHsn937LRoz/r2YzWVQTWEI3E8C0erC6BLzbs3k5tFrK1voMnjQstmDy4PDaAWDAfmEFyOVBZQKxQFf43mTZ6SuRIB3DVTjV6gN3y9e0u8wDmPO/ceS2fWMTW/VLBu9kjqxxpam5vw6fMqFt/EUFUAwTxnqhETo0dFK0WQXM4R97Qwbt0PlReQyQno3LEVLlWtTQCLjCw+9AIDTka+Oe3oKdpWQjSeFL/5lv5p2JcWLss0JNn5mw8FgQT/pJicNlbVkKSyvXL7MfwzT3HG/wAbWb3EVoRS++B13UrIv5bifXt2or9nN5befcDb6EeUQyJ4Q6kooFgMUceXkRAgY4Cn14opWU9iE2c+BmJwHrG8AJ7b4TAkp5q76bNwGJJTlLNUdDHOo7JxTjsAB8APlIQWmGa/4R8mBYWIC1QHmyB2biIXcqwMG/px6jR+AwAA///9DnKbAAAABklEQVQDAJnrLCNIy+DdAAAAAElFTkSuQmCC";
}
