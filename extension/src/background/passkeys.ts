import { ferry } from "./KF";
import { configManager } from "../common/ConfigManager";
import { FerryURL } from "../common/FerryURL";
import { FerryLog } from "../common/Logger";
import { Entry } from "../common/model/Entry";
import { utils } from "../common/utils";
import { diag } from "./ferryDiag";

/*
passkeys.ts: Hintergrund-Teil der Passkey-Unterstützung.
1. prepare: Herkunft prüfen (RP-ID muss zur vom Browser gemeldeten Frame-URL passen oder sie über Related Origins
   freigeben, nur HTTPS oder localhost),
   bei gesperrter DB im Hintergrund entsperren, Auswahl für den Dialog zusammenstellen. Der Kontext (RP-ID,
   Origin, Challenge, Benutzer) wird hier gespeichert, die Seite kann ihn danach nicht mehr ändern.
2. finish: mit der Auswahl des Nutzers clientDataJSON bilden und das Plugin den Passkey erzeugen bzw. signieren lassen.
*/

interface PasskeyContext {
    kind: "create" | "get";
    tabId: number;
    origin: string;
    crossOrigin: boolean;
    rpId: string;
    rpName: string;
    challenge: string;
    user?: { id: string; name: string; displayName: string };
    allowedUuids?: Set<string>;
    at: number;
}

const contexts = new Map<string, PasskeyContext>();
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// RP-ID-Regeln nach WebAuthn: sicherer Kontext, RP-ID = Host oder registrierbares Suffix davon (keine öffentliche Endung)
export function rpIdAllowed(frameUrl: string, rpId: string): boolean {
    let u: URL;
    try {
        u = new URL(frameUrl);
    } catch (e) {
        return false;
    }
    const host = u.hostname.toLowerCase();
    const rp = (rpId ?? "").toLowerCase();
    const localhost = host === "localhost" || host.endsWith(".localhost");
    if (u.protocol !== "https:" && !(u.protocol === "http:" && localhost)) return false;
    if (!rp || (host !== rp && !host.endsWith("." + rp))) return false;
    if (!localhost) {
        const registrable = FerryURL.fromString(u.href)?.domain;
        if (!registrable || !(rp === registrable || rp.endsWith("." + registrable))) return false;
    }
    return true;
}

/*
Related Origin Requests (WebAuthn L3, 5.11.1): Eine Seite darf die RP-ID einer anderen Domain nutzen, wenn
https://<RP-ID>/.well-known/webauthn ihre Herkunft unter "origins" aufführt (z. B. GMX: RP-ID auth.gmx.net auf
passkey-admin.gmx.net). Abruf ohne Cookies und Referrer, Umleitungen nur auf HTTPS, Antwort 200 mit application/json;
höchstens 5 verschiedene Domain-Namen zählen.
*/
const RELATED_MAX_LABELS = 5;
const RELATED_TIMEOUT_MS = 5000;
const RELATED_CACHE_MS = 10 * 60 * 1000;
const relatedCache = new Map<string, { origins: string[]; at: number }>();

async function relatedOrigins(rpId: string): Promise<string[]> {
    const cached = relatedCache.get(rpId);
    if (cached && Date.now() - cached.at < RELATED_CACHE_MS) return cached.origins;
    let origins: string[] = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELATED_TIMEOUT_MS);
    try {
        const res = await fetch("https://" + rpId + "/.well-known/webauthn", {
            credentials: "omit",
            redirect: "follow",
            referrerPolicy: "no-referrer",
            cache: "no-store",
            signal: controller.signal
        });
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const finalHttps = !res.url || res.url.startsWith("https://");
        const json = res.status === 200 && finalHttps && contentType === "application/json" ? await res.json() : null;
        if (Array.isArray(json?.origins) && json.origins.every((o: any) => typeof o === "string")) origins = json.origins;
    } catch (e) {
        // nicht erreichbar oder kein gültiges JSON: keine verwandten Herkünfte
    } finally {
        clearTimeout(timer);
    }
    relatedCache.set(rpId, { origins, at: Date.now() });
    return origins;
}

export function relatedOriginListed(origins: string[], callerOrigin: string): boolean {
    const labels = new Set<string>();
    for (const item of origins ?? []) {
        let u: URL;
        try {
            u = new URL(item);
        } catch (e) {
            continue;
        }
        const domain = utils.psl.getDomain(u.hostname);
        const suffix = utils.psl.getPublicSuffix(u.hostname);
        if (!domain || !suffix || domain.length <= suffix.length) continue;
        const label = domain.slice(0, domain.length - suffix.length - 1);
        if (labels.size >= RELATED_MAX_LABELS && !labels.has(label)) continue;
        if (u.origin === callerOrigin) return true;
        labels.add(label);
    }
    return false;
}

// RP-ID der eigenen Domain oder über Related Origins freigegeben (nur HTTPS)
export async function rpIdPermitted(frameUrl: string, rpId: string): Promise<boolean> {
    if (rpIdAllowed(frameUrl, rpId)) return true;
    let u: URL;
    try {
        u = new URL(frameUrl);
    } catch (e) {
        return false;
    }
    const rp = (rpId ?? "").toLowerCase();
    if (u.protocol !== "https:" || !/^[a-z0-9.-]+$/.test(rp) || !utils.psl.getDomain(rp)) return false;
    return relatedOriginListed(await relatedOrigins(rp), u.origin);
}

async function ensureUnlocked(tabId: number, url: string): Promise<boolean> {
    // Die Seite wartet auf einen Passkey: ohne Bremsen entsperren lassen (Windows Hello)
    return ferry.unlockAndWait(tabId, url);
}

export async function preparePasskey(sender: chrome.runtime.MessageSender, kind: "create" | "get", payload: any) {
    // Einstellung "Passkeys mit KeePassFerry" aus: Anfrage geht an Browser bzw. Windows
    if (configManager.current.ferryPasskeys === false) return { result: "fallback" };
    const frameUrl = sender.url ?? "";
    let origin: URL;
    try {
        origin = new URL(frameUrl);
    } catch (e) {
        return { result: "fallback" };
    }
    const rpId: string = (kind === "create" ? payload?.rp?.id : payload?.rpId) || origin.hostname;
    if (!(await rpIdPermitted(frameUrl, rpId))) {
        diag("hintergrund", "passkey rp-id abgelehnt", { art: kind, rpId, seite: origin.hostname });
        return { result: "security" };
    }
    if (!(await ensureUnlocked(sender.tab.id, frameUrl))) return { result: "fallback" };

    let topOrigin = origin.origin;
    try {
        topOrigin = new URL(sender.tab.url).origin;
    } catch (e) {
        // ohne Tab-URL gilt die Frame-Herkunft
    }
    const id = crypto.randomUUID();
    const ctx: PasskeyContext = {
        kind,
        tabId: sender.tab.id,
        origin: origin.origin,
        crossOrigin: topOrigin !== origin.origin,
        rpId,
        rpName: kind === "create" ? String(payload?.rp?.name ?? "") : "",
        challenge: String(payload?.challenge ?? ""),
        at: Date.now()
    };

    try {
        if (kind === "create") {
            ctx.user = {
                id: String(payload?.user?.id ?? ""),
                name: String(payload?.user?.name ?? ""),
                displayName: String(payload?.user?.displayName ?? "")
            };
            const exclude: string[] = Array.isArray(payload?.excludeCredentials) ? payload.excludeCredentials : [];
            if (exclude.length > 0) {
                const existing = await ferry.rpc.passkeyFind(rpId, exclude);
                if (existing?.length > 0) return { result: "excluded" };
            }
            const candidates = await createCandidates(ctx, frameUrl);
            contexts.set(id, ctx);
            return {
                result: "choose",
                prepareId: id,
                rpId,
                rpName: ctx.rpName,
                userName: ctx.user.name || ctx.user.displayName,
                candidates,
                databases: ferry.store.state.KeePassDatabases.map(db => ({ fileName: db.fileName, name: db.name }))
            };
        }

        const allow: string[] = Array.isArray(payload?.allowCredentials) ? payload.allowCredentials : [];
        const passkeys = (await ferry.rpc.passkeyFind(rpId, allow)) ?? [];
        if (passkeys.length === 0) return { result: "fallback" };
        ctx.allowedUuids = new Set(passkeys.map(p => p.dbFileName + "|" + p.uuid));
        contexts.set(id, ctx);
        return { result: "choose", prepareId: id, rpId, passkeys };
    } catch (e) {
        FerryLog.warn("Passkey prepare failed: " + e);
        return { result: "fallback" };
    }
}

// Vorschläge beim Erstellen: Einträge der RP/Domain aus dem Plugin, dazu Treffer der Seite; zuletzt im Tab ausgefüllter zuerst
async function createCandidates(ctx: PasskeyContext, frameUrl: string) {
    const list: any[] = [];
    const seen = new Set<string>();
    const add = (c: any) => {
        const key = c.dbFileName + "|" + c.uuid;
        if (seen.has(key)) return;
        seen.add(key);
        list.push(c);
    };
    for (const c of (await ferry.rpc.passkeyCandidates(ctx.rpId)) ?? []) add(c);
    const found: Entry[] = (await ferry.rpc.findLogins(frameUrl, null, null, null, null, null)) ?? [];
    for (const e of found) {
        add({
            uuid: e.uuid,
            dbFileName: e.database.fileName,
            title: e.title,
            username: Entry.getUsernameField(e)?.value ?? "",
            hasPasskey: false,
            rpMatch: false
        });
    }
    const last = ferry.persistentTabStates.get(ctx.tabId)?.lastFilledEntry;
    const lastKey = last ? last.dbFileName + "|" + last.uuid : null;
    const userName = (ctx.user?.name ?? "").toLowerCase();
    const score = (c: any) =>
        (c.dbFileName + "|" + c.uuid === lastKey ? 100 : 0) +
        (userName && (c.username ?? "").toLowerCase() === userName ? 50 : 0) +
        (c.rpMatch ? 10 : 0) - (c.hasPasskey ? 5 : 0);
    list.sort((a, b) => score(b) - score(a));
    return list.slice(0, 12).map(c => ({ ...c, lastUsed: c.dbFileName + "|" + c.uuid === lastKey }));
}

export async function finishPasskey(sender: chrome.runtime.MessageSender, prepareId: string, choice: any) {
    const ctx = contexts.get(prepareId);
    if (!ctx || ctx.tabId !== sender.tab.id || Date.now() - ctx.at > 10 * 60 * 1000) return { result: "fallback" };

    const clientData = JSON.stringify({
        type: ctx.kind === "create" ? "webauthn.create" : "webauthn.get",
        challenge: ctx.challenge,
        origin: ctx.origin,
        crossOrigin: ctx.crossOrigin
    });
    const clientDataBytes = enc.encode(clientData);

    try {
        if (ctx.kind === "create") {
            const res = await ferry.rpc.passkeyCreate(
                ctx.rpId, ctx.rpName, ctx.user.id, ctx.user.name || ctx.user.displayName, ctx.origin,
                choice?.uuid ?? "", choice?.dbFileName ?? ferry.store.state.KeePassDatabases[0]?.fileName ?? "", !!choice?.overwrite
            );
            if (res?.status === "exists") return { result: "exists" };
            if (res?.status !== "ok") return { result: "error" };
            contexts.delete(prepareId);
            rememberEntry(ctx, res.entryUuid, choice?.dbFileName);
            return { result: "ok", credential: { ...res, clientDataJSON: b64url(clientDataBytes) } };
        }

        const key = (choice?.dbFileName ?? "") + "|" + (choice?.uuid ?? "");
        if (!ctx.allowedUuids?.has(key)) return { result: "error" };
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
        const res = await ferry.rpc.passkeyGetAssertion(choice.uuid, choice.dbFileName, ctx.rpId, b64url(hash));
        if (res?.status !== "ok") return { result: "error" };
        contexts.delete(prepareId);
        rememberEntry(ctx, choice.uuid, choice.dbFileName);
        return { result: "ok", credential: { ...res, clientDataJSON: b64url(clientDataBytes) } };
    } catch (e) {
        FerryLog.warn("Passkey finish failed: " + e);
        return { result: "error" };
    }
}

// Eintrag im Tab merken (z. B. für den Einmalcode nach der Passkey-Anmeldung)
function rememberEntry(ctx: PasskeyContext, uuid: string, dbFileName: string) {
    if (!uuid) return;
    const domain = FerryURL.fromString(ctx.origin)?.domainOrIPAddress;
    if (!domain) return;
    if (!ferry.persistentTabStates.get(ctx.tabId)) ferry.persistentTabStates.set(ctx.tabId, { items: [] });
    ferry.persistentTabStates.get(ctx.tabId).lastFilledEntry = {
        uuid,
        dbFileName: dbFileName ?? ferry.store.state.KeePassDatabases[0]?.fileName,
        domain,
        at: Date.now()
    };
}

export function cancelPasskey(prepareId: string) {
    contexts.delete(prepareId);
}

/*
Signal API (WebAuthn L3): Die Website meldet, welche Passkeys es bei ihr (nicht mehr) gibt bzw. den aktuellen Kontonamen.
- unknown / allAccepted: betroffene Passkeys werden zum Entfernen angeboten (Rückfrage im Dialog). "Behalten" wird
  90 Tage je Credential-ID gemerkt, damit dieselbe Frage nicht bei jeder Anmeldung kommt.
- userDetails: geänderter Kontoname wird ohne Rückfrage übernommen (mit Historie).
Signale entsperren KeePass nie; bei gesperrter DB passiert nichts.
*/

interface SignalContext {
    tabId: number;
    rpId: string;
    items: Map<string, { uuid: string; dbFileName: string; credentialId: string }>;
    at: number;
}

const signals = new Map<string, SignalContext>();
const DECLINED_KEY = "passkeySignalDeclined";
const DECLINE_DAYS = 90;

async function declinedIds(): Promise<Record<string, number>> {
    try {
        const stored = await chrome.storage.local.get(DECLINED_KEY);
        const all = (stored?.[DECLINED_KEY] ?? {}) as Record<string, number>;
        const limit = Date.now() - DECLINE_DAYS * 24 * 3600 * 1000;
        for (const k of Object.keys(all)) if (all[k] < limit) delete all[k];
        return all;
    } catch (e) {
        return {};
    }
}

export async function signalPasskey(sender: chrome.runtime.MessageSender, kind: string, payload: any) {
    if (configManager.current.ferryPasskeys === false) return { result: "fallback" };
    const frameUrl = sender.url ?? "";
    const rpId = String(payload?.rpId ?? "");
    if (!(await rpIdPermitted(frameUrl, rpId))) return { result: "security" };
    if (!ferry.store.state.connected || ferry.store.state.KeePassDatabases.length === 0) return { result: "none" };

    try {
        const all: any[] = (await ferry.rpc.passkeyFind(rpId, [])) ?? [];
        if (kind === "userDetails") {
            const userId = String(payload?.userId ?? "");
            const name = String(payload?.name ?? "") || String(payload?.displayName ?? "");
            if (!userId || !name) return { result: "none" };
            for (const p of all.filter(c => c.userHandle === userId && c.username !== name)) {
                await ferry.rpc.passkeyUpdateUser(p.uuid, p.dbFileName, rpId, p.credentialId, name);
            }
            return { result: "none" };
        }

        let affected: any[] = [];
        if (kind === "unknown") {
            const credId = String(payload?.credentialId ?? "");
            affected = all.filter(p => p.credentialId === credId);
        } else if (kind === "allAccepted") {
            const userId = String(payload?.userId ?? "");
            const accepted = new Set<string>(Array.isArray(payload?.allAcceptedCredentialIds) ? payload.allAcceptedCredentialIds : []);
            affected = all.filter(p => p.userHandle === userId && !accepted.has(p.credentialId));
        }
        const declined = await declinedIds();
        affected = affected.filter(p => !declined[p.credentialId]);
        if (affected.length === 0) return { result: "none" };

        const id = crypto.randomUUID();
        signals.set(id, {
            tabId: sender.tab.id,
            rpId,
            items: new Map(affected.map(p => [p.dbFileName + "|" + p.uuid, { uuid: p.uuid, dbFileName: p.dbFileName, credentialId: p.credentialId }])),
            at: Date.now()
        });
        return {
            result: "ask",
            signalId: id,
            rpId,
            passkeys: affected.map(p => ({ uuid: p.uuid, dbFileName: p.dbFileName, title: p.title, username: p.username, passkeyOnly: !!p.passkeyOnly }))
        };
    } catch (e) {
        FerryLog.warn("Passkey signal failed: " + e);
        return { result: "none" };
    }
}

export async function finishSignal(sender: chrome.runtime.MessageSender, signalId: string, key: string, remove: boolean) {
    const ctx = signals.get(signalId);
    if (!ctx || ctx.tabId !== sender.tab.id || Date.now() - ctx.at > 10 * 60 * 1000) return { result: "error" };
    if (!remove) {
        signals.delete(signalId);
        const declined = await declinedIds();
        for (const item of ctx.items.values()) declined[item.credentialId] = Date.now();
        try {
            await chrome.storage.local.set({ [DECLINED_KEY]: declined });
        } catch (e) {
            // nur Komfort: ohne Speicher kommt die Frage beim nächsten Mal wieder
        }
        return { result: "kept" };
    }
    const item = ctx.items.get(key);
    if (!item) return { result: "error" };
    // Weitere betroffene Passkeys bleiben für die nächste Rückfrage im selben Dialogablauf
    ctx.items.delete(key);
    if (ctx.items.size === 0) signals.delete(signalId);
    const status =await ferry.rpc.passkeyRemove(item.uuid, item.dbFileName, ctx.rpId, item.credentialId);
    return { result: status === "recycled" || status === "fields" ? status : "error" };
}
