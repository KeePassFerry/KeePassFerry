import { Port } from "../common/port";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";

/*
SaveNotice.ts zeigt oben rechts in der Seite einen Hinweis mit zwei Knöpfen. Eigener Shadow DOM,
damit Seiten-CSS nicht durchschlägt.
- "login": gerade eingegebene Zugangsdaten können gespeichert werden ("Speichern" öffnet das Popup im Speichern-Dialog)
- "otp": auf der Seite wurde ein Zwei-Faktor-Schlüssel gefunden ("In KeePass speichern" öffnet die Eintragsauswahl)
- "update": das gerade eingegebene Passwort weicht vom gespeicherten Eintrag ab ("Aktualisieren" öffnet diesen Eintrag
  mit dem neuen Passwort)
- "expiring"/"expired": Passwort des ausgefüllten Eintrags läuft bald ab bzw. ist abgelaufen ("Passwort ändern" öffnet
  die Änderungsseite der Website, "Später" blendet ihn für diesen Eintrag bis morgen aus). Verdrängt keinen anderen Hinweis.
"Nicht jetzt" blendet den Hinweis für diesen Fund aus.
*/

export type NoticeKind = "login" | "otp" | "update" | "expiring" | "expired";

export const HOST_ID = "keepassferry-save-notice";

const NOTICE_TEXTS: Record<
    NoticeKind,
    { title: string; text: string; save: string; dismiss?: string; saveAction: Action; dismissAction: Action }
> = {
    login: {
        title: "saveNotice_title",
        text: "saveNotice_text",
        save: "saveNotice_save",
        saveAction: Action.OpenSavePopup,
        dismissAction: Action.DismissSaveNotice
    },
    otp: {
        title: "otpNotice_title",
        text: "otpNotice_text",
        save: "otpNotice_save",
        saveAction: Action.OpenOtpSetupPopup,
        dismissAction: Action.DismissOtpSetup
    },
    update: {
        title: "updateNotice_title",
        text: "updateNotice_text",
        save: "updateNotice_save",
        saveAction: Action.OpenSavePopup,
        dismissAction: Action.DismissSaveNotice
    },
    // Überschrift und Text kommen fertig vom Hintergrund (Tage, Datum)
    expiring: {
        title: null,
        text: null,
        save: "ferry_change_password",
        dismiss: "ferry_expiry_later",
        saveAction: Action.OpenChangePassword,
        dismissAction: Action.DismissExpiryNotice
    },
    expired: {
        title: null,
        text: null,
        save: "ferry_change_password",
        dismiss: "ferry_expiry_later",
        saveAction: Action.OpenChangePassword,
        dismissAction: Action.DismissExpiryNotice
    }
};

// Farbe des Randes und des Hauptknopfs
const ACCENT: Record<NoticeKind, string> = {
    login: "#16a34a",
    otp: "#16a34a",
    update: "#16a34a",
    expiring: "#d97706",
    expired: "#dc2626"
};

const SVG_NS = "http://www.w3.org/2000/svg";

// Logo als DOM-Elemente (kein Bild-URL, kein innerHTML), damit CSP und Trusted Types der Seite nicht greifen.
// Quelle: branding/keepassferry.svg
function createLogo(): SVGSVGElement {
    const el = (name: string, attrs: Record<string, string>) => {
        const node = document.createElementNS(SVG_NS, name);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        return node;
    };
    const svg = el("svg", { viewBox: "0 0 128 128", width: "28", height: "28", "aria-hidden": "true" }) as SVGSVGElement;
    svg.append(
        el("rect", { x: "4", y: "4", width: "120", height: "120", rx: "28", fill: "#15497f" }),
        el("circle", { cx: "42", cy: "47", r: "15", fill: "none", stroke: "#fff", "stroke-width": "9" }),
        el("path", {
            d: "M57 47 H100 M88 47 V60 M99 47 V57",
            fill: "none", stroke: "#fff", "stroke-width": "9", "stroke-linecap": "round", "stroke-linejoin": "round"
        }),
        el("path", { d: "M18 72 H110 L97 94 Q95 97 91 97 H37 Q33 97 31 94 Z", fill: "#22c55e" }),
        el("path", {
            d: "M20 108 q 8.8 -7 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0",
            fill: "none", stroke: "#7dd3fc", "stroke-width": "6", "stroke-linecap": "round"
        })
    );
    return svg;
}
const AUTO_HIDE_MS = 60000;

let hideTimer: number = null;

export function showSaveNotice(kind: NoticeKind = "login", detail?: string, fixed?: { title: string; text: string }) {
    if (window.top !== window) return;
    if (!document.body) return;
    const texts = NOTICE_TEXTS[kind];
    const accent = ACCENT[kind];
    const isExpiry = kind === "expiring" || kind === "expired";
    const existing = document.getElementById(HOST_ID);
    if (existing) {
        if (existing.dataset.kind === kind) return;
        // Ablauf-Hinweis nur, wenn nichts anderes offen ist; er selbst weicht jedem anderen Hinweis
        if (isExpiry) return;
        // Ein OTP-Fund ersetzt einen offenen Speichern-Hinweis nicht umgekehrt
        if (existing.dataset.kind === "otp") return;
        existing.remove();
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.kind = kind;
    host.style.cssText =
        "all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
        .box {
            font: 14px/1.4 "Segoe UI", system-ui, sans-serif;
            color: #10233d;
            background: #ffffff;
            border-left: 6px solid ${accent};
            border-radius: 10px;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
            padding: 14px 16px 12px 14px;
            width: 320px;
            max-width: calc(100vw - 32px);
            box-sizing: border-box;
            animation: slide-in 0.35s ease-out, attention 1.2s ease-in-out 0.35s 3;
        }
        .head { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
        .head svg { width: 28px; height: 28px; flex: none; }
        .text { margin: 6px 0 12px 38px; color: #33475b; }
        .buttons { display: flex; gap: 8px; justify-content: flex-end; }
        button {
            font: inherit; border-radius: 6px; padding: 6px 14px; cursor: pointer;
            border: 1px solid #c3ccd6; background: #ffffff; color: #10233d;
        }
        button.primary { background: ${accent}; border-color: ${accent}; color: #ffffff; font-weight: 600; }
        button:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
        @keyframes slide-in {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @keyframes attention {
            0%, 100% { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28); }
            50% { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28), 0 0 0 6px ${accent}73; }
        }
        @media (prefers-reduced-motion: reduce) {
            .box { animation: none; }
        }
        @media (prefers-color-scheme: dark) {
            .box { background: #1f2933; color: #f2f5f8; }
            .text { color: #c8d1da; }
            button { background: #2b3843; color: #f2f5f8; border-color: #4a5a68; }
        }
    `;

    const box = document.createElement("div");
    box.className = "box";
    box.setAttribute("role", "dialog");
    const titleText = fixed ? fixed.title : $STR(texts.title);
    box.setAttribute("aria-label", titleText);

    const head = document.createElement("div");
    head.className = "head";
    const icon = createLogo();
    const title = document.createElement("span");
    title.textContent = titleText;
    head.append(icon, title);

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = fixed ? fixed.text : detail ? $STRF(texts.text, [detail]) : $STR(texts.text);

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = $STR(texts.dismiss ?? "saveNotice_dismiss");
    dismiss.addEventListener("click", () => {
        Port.postMessage({ action: texts.dismissAction } as AddonMessage);
        hideSaveNotice();
    });
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary";
    save.textContent = $STR(texts.save);
    save.addEventListener("click", () => {
        Port.postMessage({ action: texts.saveAction } as AddonMessage);
        hideSaveNotice();
    });
    buttons.append(dismiss, save);

    box.append(head, text, buttons);
    shadow.append(style, box);
    document.body.appendChild(host);

    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideSaveNotice, AUTO_HIDE_MS);
}

// Mit Art nur einen Hinweis dieser Art schließen (ein offener Speichern-Hinweis für Zugangsdaten bleibt)
export function hideSaveNotice(kind?: NoticeKind) {
    const existing = document.getElementById(HOST_ID);
    if (kind && existing?.dataset.kind !== kind) return;
    clearTimeout(hideTimer);
    hideTimer = null;
    existing?.remove();
}
