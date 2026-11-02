import jsQR from "jsqr";
import { ferry } from "./KF";
import { FerryURL } from "../common/FerryURL";
import { Action } from "../common/Action";
import { FerryLog } from "../common/Logger";
import { Entry } from "../common/model/Entry";
import type { AddonMessage } from "../common/AddonMessage";
import { diag } from "./ferryDiag";
import { rememberAutoFill } from "./otpRepeat";
import { sameSite } from "../common/relatedDomains";
import { totpMatches } from "../common/totp";

/*
otpSetup.ts: Einrichtung eines Zwei-Faktor-Schlüssels (TOTP) von einer Webseite.
Die Seite meldet Hinweise (otpauth-Link, Schlüssel als Text, QR-artiges Bild). Für QR-Codes wird
der sichtbare Tab abfotografiert und mit jsQR dekodiert. Der Fund wird je Tab vorgehalten, bis der
Nutzer ihn in einem Eintrag speichert oder verwirft. Das Secret geht nur an das KeePass-Plugin.
*/

type Source = "uri" | "qr" | "text";

interface PendingOtpSetup {
    uri: string;
    issuer: string;
    account: string;
    url: string;
    domain: string;
    source: Source;
    at: number;
    dismissed?: boolean;
    // Seite (Dokument des Hauptframes), auf der der Schlüssel erkannt wurde: Neu laden oder eine andere Seite verwirft
    // den Fund, denn viele Websites (z. B. Amazon) erzeugen dabei einen neuen Schlüssel und der alte gilt nicht mehr
    documentId?: string;
    // Bei gesperrter oder noch nicht verbundener Datenbank gefunden: noch nicht mit den Einträgen verglichen
    unchecked?: boolean;
    // Vergleich nach dem Entsperren (gleichzeitige Anfragen warten auf dasselbe Ergebnis)
    check?: Promise<boolean>;
}

export interface OtpSetupCandidate {
    uuid: string;
    dbFileName: string;
    title: string;
    username: string;
    icon: string;
    hasTotp: boolean;
}

const pending = new Map<number, PendingOtpSetup>();
// Laufende Auswertung je Tab (z. B. QR-Dekodierung), damit eine gleichzeitige Code-Anfrage darauf warten kann
const inFlight = new Map<number, Promise<void>>();
const lastQrScan = new Map<number, number>();
const MAX_AGE_MS = 30 * 60 * 1000;
const SESSION_KEY = "ferryOtpPending";

// Funde auch über einen Neustart des Hintergrunds hinweg merken (Edge/Chrome beenden ihn bei Leerlauf).
// chrome.storage.session liegt nur im Arbeitsspeicher, ist für Inhaltsskripte gesperrt und endet mit dem Browser
function persistPending() {
    const data: Record<string, Omit<PendingOtpSetup, "check">> = {};
    for (const [tabId, setup] of pending) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { check, ...rest } = setup;
        data[String(tabId)] = rest;
    }
    chrome.storage.session?.set({ [SESSION_KEY]: data }).catch(() => undefined);
}

const restored: Promise<void> = (async () => {
    try {
        const r = await chrome.storage.session?.get(SESSION_KEY);
        const data = r?.[SESSION_KEY] ?? {};
        for (const [tabId, setup] of Object.entries<PendingOtpSetup>(data)) {
            if (!pending.has(Number(tabId)) && Date.now() - setup.at <= MAX_AGE_MS) pending.set(Number(tabId), setup);
        }
    } catch (e) {
        // ohne Wiederherstellung
    }
})();

// Prüft eine otpauth-URI (nur TOTP mit Base32-Secret) und liest Aussteller und Konto aus
export function parseOtpauth(uri: string): { issuer: string; account: string } {
    if (!/^otpauth:\/\/totp\//i.test(uri)) return null;
    try {
        const u = new URL(uri);
        const secret = (u.searchParams.get("secret") ?? "").replace(/\s/g, "");
        if (secret.length < 16 || !/^[A-Z2-7]+=*$/i.test(secret)) return null;
        const label = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
        let issuer = u.searchParams.get("issuer") ?? "";
        let account = label;
        const colon = label.indexOf(":");
        if (colon >= 0) {
            if (!issuer) issuer = label.slice(0, colon);
            account = label.slice(colon + 1);
        } else if (issuer && label === issuer) {
            // Nur Aussteller im Label (z. B. aus einem Schlüssel als Text): kein Kontoname bekannt
            account = "";
        }
        return { issuer: issuer.trim(), account: account.trim() };
    } catch (e) {
        return null;
    }
}

// QR-Codes bestehen fast nur aus sehr hellen und sehr dunklen Pixeln; Fotos, Avatare und Logos nicht
function looksTwoTone(data: Uint8ClampedArray): boolean {
    let dark = 0, light = 0, total = 0;
    for (let i = 0; i < data.length; i += 16) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 80) dark++;
        else if (lum > 175) light++;
        total++;
    }
    return total > 0 && (dark + light) / total > 0.85 && dark / total > 0.12 && light / total > 0.2;
}

// Screenshot des sichtbaren Tabs, nur die gemeldeten Ausschnitte prüfen; liefert die erste otpauth-TOTP-URI
async function decodeOtpQrFromVisibleTab(
    windowId: number,
    rects: { x: number; y: number; w: number; h: number }[],
    viewportWidth: number
): Promise<string> {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    // Screenshot-Pixel je CSS-Pixel (Bildschirmskalierung und Seitenzoom)
    const scale = viewportWidth > 0 ? bitmap.width / viewportWidth : 1;
    try {
        for (const r of rects) {
            const margin = Math.round(8 * scale);
            const sx = Math.max(0, Math.round(r.x * scale) - margin);
            const sy = Math.max(0, Math.round(r.y * scale) - margin);
            const sw = Math.min(bitmap.width - sx, Math.round(r.w * scale) + 2 * margin);
            const sh = Math.min(bitmap.height - sy, Math.round(r.h * scale) + 2 * margin);
            if (sw < 40 || sh < 40) continue;
            const canvas = new OffscreenCanvas(sw, sh);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
            const image = context.getImageData(0, 0, sw, sh);
            if (!looksTwoTone(image.data)) continue;
            const result = jsQR(image.data, sw, sh, { inversionAttempts: "attemptBoth" });
            if (result?.data && /^otpauth:\/\/totp\//i.test(result.data)) return result.data;
        }
    } finally {
        bitmap.close();
    }
    return null;
}

// Von der Seite gelieferte Bilder (Daten-URL oder https-Adresse) dekodieren; liefert die erste otpauth-TOTP-URI.
// Anmeldedaten (Cookies) nur bei Bildern derselben Herkunft wie die Seite mitschicken
async function decodeOtpQrFromImages(images: string[], frameUrl: string): Promise<string> {
    let pageOrigin: string = null;
    try {
        pageOrigin = new URL(frameUrl).origin;
    } catch {
        // ohne gültige Seitenadresse nie mit Anmeldedaten laden
    }
    for (const src of images.slice(0, 4)) {
        if (!/^(data:image\/|https:)/i.test(src)) continue;
        try {
            let sameOrigin = false;
            try {
                sameOrigin = !!pageOrigin && new URL(src).origin === pageOrigin;
            } catch {
                continue;
            }
            const blob = await (await fetch(src, { credentials: sameOrigin ? "include" : "omit" })).blob();
            const bitmap = await createImageBitmap(blob);
            try {
                const w = Math.min(bitmap.width, 1600);
                const h = Math.min(bitmap.height, 1600);
                const canvas = new OffscreenCanvas(w, h);
                const context = canvas.getContext("2d", { willReadFrequently: true });
                context.fillStyle = "#fff";
                context.fillRect(0, 0, w, h);
                context.drawImage(bitmap, 0, 0, w, h);
                const image = context.getImageData(0, 0, w, h);
                const result = jsQR(image.data, w, h, { inversionAttempts: "attemptBoth" });
                const isOtp = !!result?.data && /^otpauth:\/\/totp\//i.test(result.data);
                diag("hintergrund", "qr bild geprüft", { art: src.startsWith("data:") ? "daten" : "adresse", w, h, qr: !!result?.data, otpauth: isOtp });
                if (isOtp) return result.data;
            } finally {
                bitmap.close();
            }
        } catch (e) {
            diag("hintergrund", "qr bild fehler", { art: src.startsWith("data:") ? "daten" : "adresse", fehler: String(e) });
        }
    }
    return null;
}

const sourceRank: Record<Source, number> = { text: 0, qr: 1, uri: 2 };

// Hinweis einer Seite auswerten; bei einem gültigen Fund den Hinweis in der Seite anzeigen
export function handleOtpSetupCandidate(
    tabId: number,
    frameUrl: string,
    candidate: Parameters<typeof evaluateCandidate>[2]
): Promise<void> {
    // Synchron eintragen, bevor die nächste Nachricht der Seite (Code-Anfrage) bearbeitet wird
    const previous = inFlight.get(tabId) ?? Promise.resolve();
    const work = previous.then(() => evaluateCandidate(tabId, frameUrl, candidate)).catch(() => undefined);
    inFlight.set(tabId, work);
    work.finally(() => {
        if (inFlight.get(tabId) === work) inFlight.delete(tabId);
    });
    return work;
}

// Auf einer Seite mit neu gefundenem, noch nicht gespeichertem Schlüssel keinen vorhandenen Code eintragen
// (der vorhandene Code gehört zu einem anderen Schlüssel und würde die Einrichtung verfälschen)
export async function isOtpSetupPending(tabId: number, frameUrl: string): Promise<boolean> {
    await restored;
    await inFlight.get(tabId);
    const setup = pending.get(tabId);
    if (!setup || setup.dismissed || Date.now() - setup.at > MAX_AGE_MS) return false;
    if (FerryURL.fromString(frameUrl)?.domainOrIPAddress !== setup.domain) return false;
    return !(await settleIfStored(tabId, setup));
}

// Jede Plugin-Anfrage bei gesperrter Datenbank stößt in KeePass die Entsperrabfrage an
function databaseOpen() {
    return ferry.store.state.connected && ferry.store.state.KeePassDatabases.length > 0;
}

// Steht der Schlüssel schon in einem Eintrag der Seite? Vergleicht nur Codes: das Plugin liefert den aktuellen
// Code des Eintrags, die Erweiterung berechnet ihn selbst aus dem gefundenen Schlüssel (Secret bleibt hier)
async function isAlreadyStored(url: string, domain: string, tabId: number, uri: string): Promise<boolean> {
    const candidates: { uuid: string; dbFileName: string }[] = [];
    const last = ferry.persistentTabStates.get(tabId)?.lastFilledEntry;
    if (last && sameSite(last.domain, domain)) candidates.push({ uuid: last.uuid, dbFileName: last.dbFileName });
    try {
        const found: Entry[] = (await ferry.rpc.findLogins(url, null, null, null, null, null)) ?? [];
        for (const e of found.slice(0, 10)) {
            if (!candidates.some(c => c.uuid === e.uuid)) candidates.push({ uuid: e.uuid, dbFileName: e.database.fileName });
        }
    } catch (e) {
        diag("hintergrund", "otp einrichtung: suche fehlgeschlagen", { fehler: String(e) });
    }
    let withTotp = 0;
    for (const c of candidates) {
        try {
            const totp = await ferry.rpc.getTotp(c.uuid, c.dbFileName);
            if (totp?.code) withTotp++;
            if (totp?.code && (await totpMatches(uri, totp.code, Date.now()))) {
                diag("hintergrund", "otp einrichtung: schlüssel schon gespeichert", { uuid: c.uuid });
                return true;
            }
        } catch (e) {
            // Eintrag ohne TOTP oder Abfrage fehlgeschlagen: nächster Eintrag
        }
    }
    diag("hintergrund", "otp einrichtung: schlüssel nicht gespeichert", { eintraege: candidates.length, mitOtp: withTotp });
    return false;
}

// Ohne offene Datenbank gemerkten Fund prüfen, sobald sie verfügbar ist; schon gespeichert -> Fund verwerfen
// und den bereits gezeigten Hinweis in der Seite schließen
function settleIfStored(tabId: number, setup: PendingOtpSetup): Promise<boolean> {
    if (!setup.check) {
        if (!setup.unchecked || !databaseOpen()) return Promise.resolve(false);
        setup.check = isAlreadyStored(setup.url, setup.domain, tabId, setup.uri)
            .catch(() => false)
            .then(stored => {
                if (stored && pending.get(tabId) === setup) {
                    pending.delete(tabId);
                    persistPending();
                    hideNotice(tabId);
                }
                return stored;
            });
    }
    return setup.check;
}

// Datenbank ist verfügbar geworden (Start, Verbinden, Entsperren): offene Funde aller Tabs nachprüfen
export function recheckPendingOtpSetups() {
    for (const tabId of new Set([...pending.keys(), ...inFlight.keys()])) {
        (inFlight.get(tabId) ?? Promise.resolve()).then(() => {
            const setup = pending.get(tabId);
            if (setup) settleIfStored(tabId, setup);
        });
    }
}

async function evaluateCandidate(
    tabId: number,
    frameUrl: string,
    candidate: {
        otpUri?: string;
        otpSecret?: string;
        otpQrRects?: { x: number; y: number; w: number; h: number }[];
        otpQrImages?: string[];
        viewportWidth?: number;
    }
) {
    const domain = FerryURL.fromString(frameUrl)?.domainOrIPAddress;
    if (!domain) return;
    await restored;

    let uri: string = null;
    let source: Source = null;
    if (candidate.otpUri) {
        uri = candidate.otpUri;
        source = "uri";
    } else if (candidate.otpSecret) {
        const secret = candidate.otpSecret.replace(/[\s-]/g, "").toUpperCase();
        uri = `otpauth://totp/${encodeURIComponent(domain)}?secret=${secret}&issuer=${encodeURIComponent(domain)}`;
        source = "text";
    } else if (candidate.otpQrImages?.length) {
        const data = await decodeOtpQrFromImages(candidate.otpQrImages, frameUrl);
        if (data) {
            uri = data;
            source = "qr";
        }
    } else if (candidate.otpQrRects?.length) {
        // Höchstens ein Screenshot alle 2 Sekunden je Tab, nur im aktiven Tab
        if (Date.now() - (lastQrScan.get(tabId) ?? 0) < 2000) return;
        lastQrScan.set(tabId, Date.now());
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.active) return;
        try {
            const data = await decodeOtpQrFromVisibleTab(tab.windowId, candidate.otpQrRects.slice(0, 8), candidate.viewportWidth ?? 0);
            if (data) {
                uri = data;
                source = "qr";
            }
        } catch (e) {
            FerryLog.debug("QR scan failed: " + e);
        }
    }
    if (!uri) return;
    const info = parseOtpauth(uri);
    if (!info) return;

    // Schlüssel schon in einem Eintrag: kein Hinweis, Code wird normal eingetragen.
    // Gesperrte oder noch nicht verbundene Datenbank (z. B. kurz nach dem Browserstart): nicht anfragen
    // (Entsperrabfrage), Hinweis wie bisher; nachgeprüft wird, sobald die Datenbank verfügbar ist
    const open = databaseOpen();
    if (!open) diag("hintergrund", "otp einrichtung: datenbank nicht verfügbar -> später prüfen");
    if (open && (await isAlreadyStored(frameUrl, domain, tabId, uri))) {
        if (pending.get(tabId)?.uri === uri) {
            pending.delete(tabId);
            persistPending();
        }
        return;
    }

    const existing = pending.get(tabId);
    if (existing && existing.domain === domain && Date.now() - existing.at < MAX_AGE_MS) {
        // Derselbe Schlüssel erneut gemeldet (die Seite sucht nach Klicks noch einmal): Karte nicht wieder zeigen,
        // sie wurde für diese Seite schon angeboten (danach weiter über das Popup)
        if (existing.uri === uri || sourceRank[existing.source] > sourceRank[source]) return;
    }
    const documentId: string = (ferry.tabStates.get(tabId)?.framePorts?.get(0)?.sender as any)?.documentId;
    const entry: PendingOtpSetup = { uri, ...info, url: frameUrl, domain, source, at: Date.now(), unchecked: !open, documentId };
    pending.set(tabId, entry);
    persistPending();
    showNotice(tabId, entry);
}

function showNotice(tabId: number, setup: PendingOtpSetup) {
    try {
        ferry.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({
            action: Action.ShowOtpSetupNotice,
            otpIssuer: setup.issuer || setup.domain
        } as AddonMessage);
    } catch (e) {
        // Seite lädt gerade neu
    }
}

function hideNotice(tabId: number) {
    try {
        ferry.tabStates.get(tabId)?.framePorts?.get(0)?.postMessage({ action: Action.HideOtpSetupNotice } as AddonMessage);
    } catch (e) {
        // Seite lädt gerade neu
    }
}

// Hauptframe verbindet sich: neue Seite oder neu geladen -> Fund verwerfen (die Seite erkennt einen sichtbaren
// QR-Code erneut). Dieselbe Seite (Neustart des Hintergrunds, Port neu verbunden) -> Fund erneut anbieten
export async function offerPendingOtpSetup(tabId: number, url: string, documentId?: string) {
    await restored;
    const setup = pending.get(tabId);
    if (!setup) return;
    if (setup.documentId && documentId && setup.documentId !== documentId) {
        diag("hintergrund", "otp einrichtung: neue seite -> fund verworfen");
        forgetOtpSetup(tabId);
        return;
    }
    if (setup.dismissed || Date.now() - setup.at > MAX_AGE_MS) return;
    if (FerryURL.fromString(url)?.domainOrIPAddress !== setup.domain) return;
    if (await settleIfStored(tabId, setup)) return;
    showNotice(tabId, setup);
}

export async function dismissOtpSetup(tabId: number) {
    await restored;
    const setup = pending.get(tabId);
    if (setup) {
        setup.dismissed = true;
        persistPending();
    }
}

export function forgetOtpSetup(tabId: number) {
    if (pending.delete(tabId)) persistPending();
    lastQrScan.delete(tabId);
}

// Noch nicht gespeicherter Fund im Tab (auch nach "Später"), solange der Tab auf derselben Domain ist:
// das normale Popup bietet dann die Auswahl erneut an (die Seite muss nichts neu erkennen)
export async function getOtpSetupSummary(tabId: number): Promise<{ issuer: string }> {
    await restored;
    const setup = pending.get(tabId);
    if (!setup || Date.now() - setup.at > MAX_AGE_MS) {
        diag("hintergrund", "otp hinweis im popup: kein fund", { tab: tabId, offen: pending.size, abgelaufen: !!setup });
        return null;
    }
    try {
        const tab = await chrome.tabs.get(tabId);
        if (FerryURL.fromString(tab?.url)?.domainOrIPAddress !== setup.domain) {
            diag("hintergrund", "otp hinweis im popup: andere domain");
            return null;
        }
    } catch (e) {
        return null;
    }
    if (await settleIfStored(tabId, setup)) return null;
    return { issuer: setup.issuer || setup.domain };
}

// Daten für die Popup-Ansicht: Fund (ohne Secret) und vorgeschlagene Einträge
export async function getOtpSetupForPopup(tabId: number) {
    await restored;
    const setup = pending.get(tabId);
    if (!setup || Date.now() - setup.at > MAX_AGE_MS) return null;

    const candidates: OtpSetupCandidate[] = [];
    const seen = new Set<string>();
    const last = ferry.persistentTabStates.get(tabId)?.lastFilledEntry;
    const found: Entry[] = (await ferry.rpc.findLogins(setup.url, null, null, null, null, null)) ?? [];
    const ordered = last && sameSite(last.domain, setup.domain)
        ? [...found.filter(e => e.uuid === last.uuid), ...found.filter(e => e.uuid !== last.uuid)]
        : found;
    for (const e of ordered.slice(0, 8)) {
        if (seen.has(e.uuid)) continue;
        seen.add(e.uuid);
        const totp = await ferry.rpc.getTotp(e.uuid, e.database.fileName);
        candidates.push({
            uuid: e.uuid,
            dbFileName: e.database.fileName,
            title: e.title,
            username: Entry.getUsernameField(e)?.value ?? "",
            icon: e.icon?.iconImageData ?? "",
            hasTotp: !!totp?.code
        });
    }
    return {
        issuer: setup.issuer,
        account: setup.account,
        domain: setup.domain,
        candidates,
        lastFilledUuid: last && sameSite(last.domain, setup.domain) ? last.uuid : null
    };
}

// Schlüssel in den gewählten Eintrag schreiben; bei Erfolg den ersten Code in die Seite eintragen
export async function applyOtpSetup(tabId: number, uuid: string, dbFileName: string, overwrite: boolean) {
    await restored;
    const setup = pending.get(tabId);
    if (!setup) return { status: "nothing" };
    const result = await ferry.rpc.setTotp(uuid, dbFileName, setup.uri, overwrite);
    if (result?.status === "ok") {
        forgetOtpSetup(tabId);
        // Gewählter Eintrag gilt ab jetzt als benutzt: weitere Code-Anfragen dieser Seite nehmen genau ihn
        if (!ferry.persistentTabStates.get(tabId)) ferry.persistentTabStates.set(tabId, { items: [] });
        ferry.persistentTabStates.get(tabId).lastFilledEntry = { uuid, dbFileName, domain: setup.domain, at: Date.now() };
        const totp = await ferry.rpc.getTotp(uuid, dbFileName);
        const code = totp?.code ?? result.code;
        if (code) {
            // Lädt die Seite nach dem Absenden neu (z. B. "ungültig"), denselben Code nicht noch einmal von selbst eintragen
            await rememberAutoFill(tabId, setup.domain, code);
            ferry.tabStates.get(tabId)?.framePorts?.forEach(port => {
                try {
                    // Mit Restzeit, damit am Feld der Gültigkeitsring startet
                    port.postMessage({
                        action: Action.FillOtp,
                        otpCode: code,
                        otpRemaining: totp?.code ? totp.remainingSeconds : undefined,
                        otpPeriod: totp?.code ? totp.period || 30 : undefined
                    } as AddonMessage);
                } catch (e) {
                    // Frame ist weg
                }
            });
        }
    }
    return { status: result?.status ?? "error" };
}
