/*
PasskeyDialog.ts: Dialog in der Seite (geschlossener Shadow DOM) für Passkeys.
- Erstellen: Eintrag wählen, in dem der Passkey gespeichert wird (vorausgewählt der passende), oder neuer Eintrag
- Anmelden: Passkey wählen
Knöpfe: Hauptaktion, "Abbrechen", "Anderes Gerät verwenden" (gibt die Anfrage an den Browser/Windows weiter).
*/

export interface DialogItem {
    key: string;
    title: string;
    subtitle: string;
    badges?: { text: string; tone: "green" | "amber" }[];
    warning?: string;
}

export interface DialogOptions {
    heading: string;
    subheading: string;
    question: string;
    items: DialogItem[];
    selectedKey: string;
    primaryLabel: (item: DialogItem) => string;
    cancelLabel?: string;
    // false: kein "Anderes Gerät verwenden"
    showFallback?: boolean;
    danger?: boolean;
}

export type DialogResult = { action: "ok"; key: string } | { action: "cancel" } | { action: "fallback" };

const HOST_ID = "keepassferry-passkey-dialog";
const SVG_NS = "http://www.w3.org/2000/svg";

function logo(): SVGSVGElement {
    const el = (name: string, attrs: Record<string, string>) => {
        const n = document.createElementNS(SVG_NS, name);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        return n;
    };
    const svg = el("svg", { viewBox: "0 0 128 128", width: "36", height: "36", "aria-hidden": "true" }) as SVGSVGElement;
    svg.append(
        el("rect", { x: "4", y: "4", width: "120", height: "120", rx: "28", fill: "#15497f" }),
        el("circle", { cx: "42", cy: "47", r: "15", fill: "none", stroke: "#fff", "stroke-width": "9" }),
        el("path", { d: "M57 47 H100 M88 47 V60 M99 47 V57", fill: "none", stroke: "#fff", "stroke-width": "9", "stroke-linecap": "round", "stroke-linejoin": "round" }),
        el("path", { d: "M18 72 H110 L97 94 Q95 97 91 97 H37 Q33 97 31 94 Z", fill: "#22c55e" }),
        el("path", { d: "M20 108 q 8.8 -7 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0 t 17.6 0", fill: "none", stroke: "#7dd3fc", "stroke-width": "6", "stroke-linecap": "round" })
    );
    return svg;
}

const STYLE = `
    :host { all: initial; }
    .backdrop {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center;
        font: 14px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif;
        animation: fade 0.18s ease-out;
    }
    .dialog {
        width: 448px; max-width: calc(100vw - 32px); max-height: calc(100vh - 48px);
        display: flex; flex-direction: column;
        background: #ffffff; color: #0f172a;
        border-radius: 16px;
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.35), 0 2px 6px rgba(15, 23, 42, 0.12);
        animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
        overflow: hidden;
    }
    .head { display: flex; align-items: center; gap: 14px; padding: 20px 22px 8px; }
    .head svg { flex: none; }
    .heading { font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
    .sub { font-size: 13px; color: #475569; margin-top: 2px; word-break: break-word; }
    .question { padding: 10px 22px 8px; font-size: 13.5px; font-weight: 600; color: #334155; }
    .list { padding: 2px 22px 4px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
    .item {
        display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box;
        padding: 11px 14px; border-radius: 12px; cursor: pointer; text-align: left;
        border: 1.5px solid #e2e8f0; background: #ffffff; color: inherit; font: inherit;
        transition: border-color 0.12s, background-color 0.12s, box-shadow 0.12s;
    }
    .item:hover { border-color: #93c5fd; }
    .item.selected { border-color: #1d4ed8; background: #eff6ff; box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.12); }
    .item:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
    .radio { width: 18px; height: 18px; flex: none; border-radius: 50%; border: 2px solid #94a3b8; box-sizing: border-box; }
    .item.selected .radio { border-color: #1d4ed8; background: radial-gradient(circle, #1d4ed8 42%, transparent 46%); }
    .single .radio { display: none; }
    .single .item { cursor: default; }
    .text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .subtitle { font-size: 12.5px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badges { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    .badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
    .badge.green { background: #dcfce7; color: #166534; }
    .badge.amber { background: #fef3c7; color: #92400e; }
    .warning {
        margin: 8px 22px 0; padding: 9px 12px; border-radius: 10px;
        background: #fffbeb; color: #78350f; border: 1px solid #fde68a; font-size: 12.5px;
    }
    .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 16px 22px 18px; }
    /* Link links; bei Platzmangel rutschen Abbrechen + Hauptaktion rechtsbündig in die nächste Zeile */
    .actions .secondary { margin-left: auto; }
    .spacer { display: none; }
    button.btn {
        font: inherit; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer;
        border: 1px solid transparent; transition: background-color 0.12s, box-shadow 0.12s;
    }
    button.primary { background: #1d4ed8; color: #fff; box-shadow: 0 1px 2px rgba(29, 78, 216, 0.4); }
    button.primary:hover { background: #1e40af; }
    button.primary.danger { background: #dc2626; box-shadow: 0 1px 2px rgba(220, 38, 38, 0.4); }
    button.primary.danger:hover { background: #b91c1c; }
    button.secondary { background: #f1f5f9; color: #0f172a; }
    button.secondary:hover { background: #e2e8f0; }
    button.link { background: none; color: #1d4ed8; padding: 9px 4px; font-weight: 500; white-space: nowrap; }
    button.link:hover { text-decoration: underline; }
    button:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pop { from { transform: translateY(8px) scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .backdrop, .dialog { animation: none; } }
    @media (prefers-color-scheme: dark) {
        .dialog { background: #111827; color: #f1f5f9; }
        .sub, .subtitle { color: #94a3b8; }
        .question { color: #cbd5e1; }
        .item { background: #111827; border-color: #334155; }
        .item.selected { background: #172554; border-color: #60a5fa; }
        .item.selected .radio { border-color: #60a5fa; background: radial-gradient(circle, #60a5fa 42%, transparent 46%); }
        button.secondary { background: #1f2937; color: #f1f5f9; }
        button.link { color: #93c5fd; }
        .warning { background: #422006; color: #fde68a; border-color: #78350f; }
    }
`;

export function showPasskeyDialog(opts: DialogOptions): Promise<DialogResult> {
    document.getElementById(HOST_ID)?.remove();
    return new Promise(resolve => {
        const host = document.createElement("div");
        host.id = HOST_ID;
        const shadow = host.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent = STYLE;

        const backdrop = document.createElement("div");
        backdrop.className = "backdrop";
        const dialog = document.createElement("div");
        dialog.className = "dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-label", opts.heading);

        const head = document.createElement("div");
        head.className = "head";
        const titles = document.createElement("div");
        const h = document.createElement("div");
        h.className = "heading";
        h.textContent = opts.heading;
        const sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = opts.subheading;
        titles.append(h, sub);
        head.append(logo(), titles);

        const question = document.createElement("div");
        question.className = "question";
        question.textContent = opts.question;

        const list = document.createElement("div");
        list.className = "list";
        const warning = document.createElement("div");
        warning.className = "warning";

        const actions = document.createElement("div");
        actions.className = "actions";
        const fallback = document.createElement("button");
        fallback.className = "btn link";
        fallback.type = "button";
        fallback.textContent = $STR("passkey_other_device");
        const spacer = document.createElement("div");
        spacer.className = "spacer";
        const cancel = document.createElement("button");
        cancel.className = "btn secondary";
        cancel.type = "button";
        cancel.textContent = opts.cancelLabel ?? $STR("passkey_cancel");
        const primary = document.createElement("button");
        primary.className = "btn primary" + (opts.danger ? " danger" : "");
        primary.type = "button";
        if (opts.showFallback === false) actions.append(spacer, cancel, primary);
        else actions.append(fallback, spacer, cancel, primary);

        let selected = opts.items.find(i => i.key === opts.selectedKey) ?? opts.items[0];
        const buttons = new Map<string, HTMLButtonElement>();

        const refresh = () => {
            buttons.forEach((b, key) => {
                b.classList.toggle("selected", key === selected?.key);
                b.setAttribute("aria-checked", key === selected?.key ? "true" : "false");
            });
            primary.textContent = selected ? opts.primaryLabel(selected) : "";
            if (selected?.warning) {
                warning.textContent = selected.warning;
                warning.style.display = "";
            } else {
                warning.style.display = "none";
            }
        };

        list.setAttribute("role", "radiogroup");
        if (opts.items.length === 1) list.classList.add("single");
        for (const item of opts.items) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "item";
            b.setAttribute("role", "radio");
            const radio = document.createElement("span");
            radio.className = "radio";
            const text = document.createElement("span");
            text.className = "text";
            const t = document.createElement("span");
            t.className = "title";
            t.textContent = item.title;
            const s = document.createElement("span");
            s.className = "subtitle";
            s.textContent = item.subtitle;
            text.append(t, s);
            b.append(radio, text);
            if (item.badges?.length) {
                const badges = document.createElement("span");
                badges.className = "badges";
                for (const bd of item.badges) {
                    const x = document.createElement("span");
                    x.className = "badge " + bd.tone;
                    x.textContent = bd.text;
                    badges.append(x);
                }
                b.append(badges);
            }
            b.addEventListener("click", () => {
                selected = item;
                refresh();
            });
            if (!opts.danger) b.addEventListener("dblclick", () => finish({ action: "ok", key: item.key }));
            buttons.set(item.key, b);
            list.append(b);
        }

        const finish = (result: DialogResult) => {
            document.removeEventListener("keydown", onKey, true);
            host.remove();
            resolve(result);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finish({ action: "cancel" });
            } else if (e.key === "Enter" && selected && !opts.danger) {
                e.preventDefault();
                e.stopPropagation();
                finish({ action: "ok", key: selected.key });
            }
        };
        primary.addEventListener("click", () => selected && finish({ action: "ok", key: selected.key }));
        cancel.addEventListener("click", () => finish({ action: "cancel" }));
        fallback.addEventListener("click", () => finish({ action: "fallback" }));
        backdrop.addEventListener("click", e => {
            if (e.target === backdrop) finish({ action: "cancel" });
        });
        document.addEventListener("keydown", onKey, true);

        dialog.append(head, question, list, warning, actions);
        backdrop.append(dialog);
        shadow.append(style, backdrop);
        (document.body ?? document.documentElement).appendChild(host);
        refresh();
        // Bei Entfernen-Rückfragen steht der Fokus auf "Behalten"
        (opts.danger ? cancel : primary).focus();
    });
}
