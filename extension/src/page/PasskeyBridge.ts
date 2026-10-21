import { Port } from "../common/port";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";
import { showPasskeyDialog, type DialogItem } from "./PasskeyDialog";

/*
PasskeyBridge.ts: Brücke zwischen der Seitenwelt (webauthnMain.ts) und dem Hintergrund.
Nachrichten der Seite sind nicht vertrauenswürdig: Der Hintergrund prüft die Herkunft anhand der vom Browser
gemeldeten Frame-URL und hält den Anfragekontext selbst fest. Die Brücke zeigt nur den Dialog und reicht weiter.
*/

const CHANNEL = "keepassferry-webauthn";
const NEW_ENTRY = "__new__";

export class PasskeyBridge {
    private nextReq = 1;
    private waiting = new Map<number, (msg: any) => void>();
    private aborted = new Set<number>();

    public start() {
        window.addEventListener("message", ev => this.onPageMessage(ev));
        this.announce();
    }

    private announce() {
        window.postMessage({ channel: CHANNEL, dir: "toPage", type: "ready" }, window.location.origin);
    }

    private reply(id: number, data: any) {
        if (this.aborted.delete(id)) return;
        window.postMessage({ channel: CHANNEL, dir: "toPage", id, ...data }, window.location.origin);
    }

    // Antwort des Hintergrunds (WebAuthnReply) an die wartende Anfrage
    public onBackgroundMessage(m: AddonMessage) {
        const w = (m as any).webauthn;
        if (!w) return;
        const cb = this.waiting.get(w.reqId);
        if (cb) {
            this.waiting.delete(w.reqId);
            cb(w);
        }
    }

    private async background(step: "prepare" | "finish" | "cancel" | "signal" | "signalFinish", data: any): Promise<any> {
        // Inhaltsskript verbindet sich erst nach dem Laden der Einstellungen; kurz darauf warten
        for (let i = 0; i < 30 && !Port.raw; i++) await new Promise(r => setTimeout(r, 100));
        if (!Port.raw) return { result: "fallback" };
        const reqId = this.nextReq++;
        return new Promise(resolve => {
            this.waiting.set(reqId, resolve);
            Port.postMessage({ action: Action.WebAuthnRequest, webauthn: { reqId, step, ...data } } as AddonMessage);
            // Abbruch nach 5 Minuten (WebAuthn-Zeitlimit der meisten Seiten)
            setTimeout(() => {
                if (this.waiting.delete(reqId)) resolve({ result: "fallback" });
            }, 5 * 60 * 1000);
        });
    }

    private async onPageMessage(ev: MessageEvent) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.channel !== CHANNEL || d.dir !== "toBridge") return;
        if (d.type === "ping") {
            this.announce();
            return;
        }
        if (d.type === "abort") {
            this.aborted.add(d.id);
            document.getElementById("keepassferry-passkey-dialog")?.remove();
            return;
        }
        if (d.type === "signal") {
            if (["unknown", "allAccepted", "userDetails"].includes(d.kind)) this.handleSignal(d.kind, d.payload).catch(() => undefined);
            return;
        }
        if (d.type !== "request" || (d.kind !== "create" && d.kind !== "get")) return;

        let result: any;
        try {
            result = await this.handle(d.kind, d.payload);
        } catch (e) {
            result = { result: "fallback" };
        }
        this.reply(d.id, result);
    }

    // Signal API: Website meldet nicht mehr gültige Passkeys → nachfragen, ob sie aus KeePass entfernt werden
    private signalBusy = false;
    private async handleSignal(kind: string, payload: any) {
        if (this.signalBusy) return;
        this.signalBusy = true;
        try {
            const res = await this.background("signal", { kind, payload });
            if (res.result !== "ask") return;
            let remaining: any[] = res.passkeys ?? [];
            while (remaining.length > 0) {
                const items: DialogItem[] = remaining.map((p: any) => ({
                    key: p.dbFileName + "|" + p.uuid,
                    title: p.username || p.title || res.rpId,
                    subtitle: p.title || res.rpId,
                    warning: p.passkeyOnly ? $STR("passkey_signal_recycle") : $STR("passkey_signal_fields")
                }));
                const dialog = await showPasskeyDialog({
                    heading: $STR("passkey_signal_heading"),
                    subheading: res.rpId,
                    question: remaining.length > 1 ? $STR("passkey_signal_question_many") : $STR("passkey_signal_question_one"),
                    items,
                    selectedKey: items[0].key,
                    primaryLabel: () => $STR("passkey_signal_remove"),
                    cancelLabel: $STR("passkey_signal_keep"),
                    showFallback: false,
                    danger: true
                });
                const remove = dialog.action === "ok";
                const key = dialog.action === "ok" ? dialog.key : "";
                const done = await this.background("signalFinish", { signalId: res.signalId, key, remove });
                if (!remove || (done.result !== "recycled" && done.result !== "fields")) return;
                remaining = remaining.filter((p: any) => p.dbFileName + "|" + p.uuid !== key);
            }
        } finally {
            this.signalBusy = false;
        }
    }

    private async handle(kind: "create" | "get", payload: any): Promise<any> {
        const prep = await this.background("prepare", { kind, payload });
        if (prep.result !== "choose") return { result: prep.result };

        if (kind === "create") {
            const items: DialogItem[] = (prep.candidates ?? []).map((c: any) => ({
                key: c.dbFileName + "|" + c.uuid,
                title: c.title || prep.rpId,
                subtitle: c.username || $STR("passkey_no_username"),
                badges: [
                    ...(c.lastUsed ? [{ text: $STR("passkey_just_used"), tone: "green" as const }] : []),
                    ...(c.hasPasskey ? [{ text: $STR("passkey_has_passkey"), tone: "amber" as const }] : [])
                ],
                warning: c.hasPasskey ? $STR("passkey_replace_warning") : undefined
            }));
            items.push({ key: NEW_ENTRY, title: $STR("passkey_new_entry"), subtitle: prep.rpName || prep.rpId });
            const dialog = await showPasskeyDialog({
                heading: $STR("passkey_create_heading"),
                subheading: [prep.rpName || prep.rpId, prep.userName].filter(Boolean).join(" · "),
                question: $STR("passkey_create_question"),
                items,
                selectedKey: items[0].key,
                primaryLabel: item => (item.warning ? $STR("passkey_replace") : $STR("passkey_save"))
            });
            if (dialog.action !== "ok") {
                this.background("cancel", { prepareId: prep.prepareId });
                return { result: dialog.action === "fallback" ? "fallback" : "cancel" };
            }
            const chosen = (prep.candidates ?? []).find((c: any) => c.dbFileName + "|" + c.uuid === dialog.key);
            const choice = chosen
                ? { uuid: chosen.uuid, dbFileName: chosen.dbFileName, overwrite: !!chosen.hasPasskey }
                : { uuid: "", dbFileName: prep.databases?.[0]?.fileName ?? "" };
            const done = await this.background("finish", { prepareId: prep.prepareId, choice });
            return done.result === "ok" ? done : { result: "fallback" };
        }

        const items: DialogItem[] = (prep.passkeys ?? []).map((p: any) => {
            const title = p.username || p.title;
            // Zweite Zeile nur, wenn sie etwas anderes sagt als die erste
            const subtitle = p.title && p.title !== title ? p.title : $STR("passkey_from_keepass");
            return { key: p.dbFileName + "|" + p.uuid, title, subtitle };
        });
        const dialog = await showPasskeyDialog({
            heading: $STR("passkey_get_heading"),
            subheading: prep.rpId,
            question: items.length > 1 ? $STR("passkey_get_question_many") : $STR("passkey_get_question_one"),
            items,
            selectedKey: items[0]?.key,
            primaryLabel: () => $STR("passkey_sign_in")
        });
        if (dialog.action !== "ok") {
            this.background("cancel", { prepareId: prep.prepareId });
            return { result: dialog.action === "fallback" ? "fallback" : "cancel" };
        }
        const chosen = (prep.passkeys ?? []).find((p: any) => p.dbFileName + "|" + p.uuid === dialog.key);
        const done = await this.background("finish", { prepareId: prep.prepareId, choice: { uuid: chosen.uuid, dbFileName: chosen.dbFileName } });
        return done.result === "ok" ? done : { result: "fallback" };
    }
}
