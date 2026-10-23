import { Port } from "../common/port";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";
import { findInputsInOpenShadowRoots } from "./shadowDom";
import { KeeFieldIcon } from "./keeFieldIcon";
import { FloatingFieldIcons } from "./FloatingFieldIcons";
import { pageDiag } from "./ferryDiagPage";
import { configManager } from "../common/ConfigManager";
import { pageCodeChannel } from "./codeChannel";

/*
OtpFields.ts erkennt Eingabefelder für Einmalcodes (TOTP) und füllt den Code ein,
den der Hintergrund vom KeePass-Plugin holt. Das Secret bleibt in KeePass.

Erkannt werden:
- ein Feld mit autocomplete="one-time-code" oder typischen Namen/Beschriftungen (otp, 2fa, Bestätigungscode …)
- 6 bis 8 aufeinanderfolgende Einzelziffernfelder (maxlength=1)
Felder, deren Beschriftung auf SMS oder E-Mail hindeutet, werden ausgelassen (dort passt kein TOTP-Code).
*/

const OTP_HINT =
    /(one[-_ ]?time|\botp\b|\botc\b|totp|\b2fa\b|\bmfa\b|two[-_ ]?factor|2[-_ ]?step|zwei[-_ ]?faktor|verification[-_ ]?code|verify[-_ ]?code|bestätigungscode|bestaetigungscode|sicherheitscode|security[-_ ]?code|auth(entication|enticator)?[-_ ]?code|authenticator|einmal[-_ ]?(code|passwort|kennwort)|totp[-_ ]?code|otp[-_ ]?code|mfa[-_ ]?code|app[-_ ]?code)/i;
// Kein TOTP: SMS/E-Mail/Telefon, Captcha, Wiederherstellungs- und Backup-Codes
const NOT_TOTP_HINT =
    /(\bsms\b|e-?mail|text message|textnachricht|\bphone\b|telefonnummer|handynummer|captcha|recovery|backup|wiederherstellung|sicherungscode|notfallcode)/i;
const TEXT_TYPES = ["text", "tel", "number", ""];

// Allgemeine Feldnamen, die erst zusammen mit einem Zwei-Faktor-Kontext der Seite als OTP-Feld gelten
const WEAK_HINT = /(\bcode\b|\bpin\b|\btoken\b)/i;
// Zwei-Faktor-Kontext im sichtbaren Text der Seite (Überschrift, Erklärung)
const PAGE_2FA_CONTEXT =
    /(authenticator|authentifizierungs[-\s]?app|zwei[-\s]?(faktor|schritt)|two[-\s]?(factor|step)|2[-\s]?step|\b2fa\b|\bmfa\b|einmal[-\s]?(kennwort|passwort|code)|one[-\s]?time[-\s]?(code|password|passcode)|\botp\b|\btotp\b)/i;

let pageContextCache: { at: number; value: boolean } = null;
function pageHas2faContext(): boolean {
    if (pageContextCache && Date.now() - pageContextCache.at < 1500) return pageContextCache.value;
    const text = (document.body?.innerText ?? "").slice(0, 50000);
    const value = PAGE_2FA_CONTEXT.test(text) || PAGE_2FA_CONTEXT.test(document.title ?? "");
    pageContextCache = { at: Date.now(), value };
    return value;
}

export function isOtpField(el: HTMLInputElement): boolean {
    if (!(el instanceof HTMLInputElement)) return false;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (!TEXT_TYPES.includes(type)) return false;
    const hints = hintText(el);
    if (NOT_TOTP_HINT.test(hints)) return false;
    if ((el.getAttribute("autocomplete") ?? "").toLowerCase().includes("one-time-code")) return true;
    const max = el.maxLength;
    // Eindeutige Hinweise: Länge egal (manche Seiten erlauben 20+ Zeichen), mindestens 4
    if (OTP_HINT.test(hints)) return max <= 0 || max >= 4;
    // Allgemeiner Name ("Code", "PIN") nur mit Zwei-Faktor-Kontext auf der Seite und passender Länge
    if (WEAK_HINT.test(hints) && pageHas2faContext()) return max <= 0 || (max >= 4 && max <= 20);
    return false;
}

// Namen/IDs in Wörter zerlegen, damit Wortgrenzen greifen: "otpCode" → "otp Code", "auth-mfa-otp" → "auth mfa otp"
function splitWords(s: string): string {
    return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_.:[\]]+/g, " ");
}

function hintText(el: HTMLInputElement): string {
    return splitWords(rawHintText(el));
}

function rawHintText(el: HTMLInputElement): string {
    const parts = [
        el.name,
        el.id,
        el.placeholder,
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.getAttribute("autocomplete"),
        el.className
    ];
    if (el.labels) for (const label of Array.from(el.labels)) parts.push(label.textContent);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
        for (const id of labelledBy.split(/\s+/)) parts.push(document.getElementById(id)?.textContent);
    }
    return parts.filter(Boolean).join(" ");
}

function isVisible(el: HTMLElement): boolean {
    if (el.offsetWidth <= 0 && el.offsetHeight <= 0) return false;
    // Inhalt eines zugeklappten <details> (Chromium: content-visibility: hidden) behält seine Maße, ist aber nicht zu sehen.
    // Sonst landet der Code z. B. im verborgenen Feld "App entfernen" und die Seite schickt es selbst ab.
    if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
    const closedDetails = el.closest("details:not([open])");
    if (closedDetails && !el.closest("summary")?.parentElement?.isSameNode(closedDetails)) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
}

export function isEditable(el: HTMLInputElement): boolean {
    return !el.disabled && !el.readOnly && isVisible(el);
}

export function allInputs(): HTMLInputElement[] {
    return [
        ...Array.from(document.querySelectorAll("input")),
        ...findInputsInOpenShadowRoots(document.body)
    ].filter(el => el instanceof HTMLInputElement) as HTMLInputElement[];
}

// Merkmale eines Felds für das Diagnoseprotokoll (ohne Inhalt) und die Entscheidung der Erkennung
function describeInput(el: HTMLInputElement) {
    const hints = hintText(el);
    return {
        name: el.name,
        id: el.id,
        typ: el.getAttribute("type") ?? "",
        maxlength: el.maxLength,
        autocomplete: el.getAttribute("autocomplete"),
        gefuellt: !!el.value,
        sichtbar: isEditable(el),
        hinweise: hints.slice(0, 160),
        stark: OTP_HINT.test(hints),
        schwach: WEAK_HINT.test(hints),
        ausschluss: (hints.match(NOT_TOTP_HINT) ?? [null])[0],
        ergebnis: isOtpField(el)
    };
}

let lastDiagKey = "";
function diagScan(target: HTMLInputElement[] | null) {
    const inputs = allInputs().filter(el => TEXT_TYPES.includes((el.getAttribute("type") ?? "").toLowerCase()));
    const key = (target ? "T" : "N") + inputs.map(el => el.id + el.name + (el.value ? 1 : 0)).join("|");
    if (key === lastDiagKey) return;
    lastDiagKey = key;
    if (target) {
        pageDiag("otp-feld gefunden", { anzahl: target.length, feld: describeInput(target[0]) });
    } else if (inputs.length > 0 && pageHas2faContext()) {
        pageDiag("kein otp-feld trotz 2fa-text", { felder: inputs.slice(0, 10).map(describeInput) });
    }
}

// Liefert entweder ein einzelnes Feld oder eine Gruppe von Einzelziffernfeldern.
// allowFilled: auch schon ausgefüllte Felder (Knopf "in die Seite eintragen" im Popup)
function findOtpTarget(allowFilled = false): HTMLInputElement[] | null {
    const empty = (el: HTMLInputElement) => allowFilled || !el.value;
    const inputs = allInputs().filter(isEditable);

    // Mehrere Felder mit OTP-Hinweis (z. B. "twoFaCode1" … "twoFaCode6"): je Feld eine Ziffer
    // (wie Bitwarden: Anzahl der Felder = Codelänge; das prüft fill())
    const hinted = inputs.filter(el => isOtpField(el) && el.maxLength !== 1);
    if (hinted.length >= 6 && hinted.length <= 8 && hinted.every(empty)) return hinted;

    // Einzelziffernfelder: maxlength=1 oder schmales Feld ohne Längenangabe (z. B. type=number),
    // 6 bis 8 Stück auf gleicher Elternebene. Vor dem Einzelfeld prüfen, sonst gilt das erste Kästchen als Codefeld
    const isDigitBox = (el: HTMLInputElement) =>
        TEXT_TYPES.includes((el.getAttribute("type") ?? "").toLowerCase()) &&
        (el.maxLength === 1 || (el.maxLength <= 0 && el.offsetWidth > 0 && el.offsetWidth <= 64));
    const byParent = new Map<Node, HTMLInputElement[]>();
    for (const el of inputs.filter(isDigitBox)) {
        const key = el.parentElement?.parentElement ?? el.parentElement;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(el);
    }
    const grouped = new Set<HTMLInputElement>();
    for (const group of byParent.values()) {
        if (group.length < 6 || group.length > 8) continue;
        group.forEach(el => grouped.add(el));
        if (NOT_TOTP_HINT.test(group.map(hintText).join(" "))) continue;
        if (group.every(empty)) return group;
    }

    const single = inputs.find(el => !grouped.has(el) && isOtpField(el) && el.maxLength !== 1 && empty(el));
    return single ? [single] : null;
}

// Begriffe, die auf eine Zwei-Faktor-Einrichtung hindeuten. Nur für den Schlüssel als Text nötig;
// otpauth-Links und QR-Codes werden sprachunabhängig über ihren Inhalt erkannt.
const SETUP_HINT_MORE =
    /(deux facteurs|double authentification|clé secrète|dos pasos|dos factores|clave secreta|due fattori|chiave segreta|twee stappen|tweestaps|geheime sleutel|dwuetapow|klucz|dvoufázov|kétlépcsős|двухфактор|ключ)/i;
const SETUP_HINT =
    /(authenticator|zwei[-\s]?faktor|two[-\s]?factor|\b2fa\b|\bmfa\b|\btotp\b|qr[-\s]?code|einrichtungsschlüssel|setup key|secret key|geheimer schlüssel|schlüssel manuell|manuell eingeben|enter (this|the) key|can'?t scan|nicht scannen)/i;
const OTPAUTH_RE = /otpauth:\/\/totp\/[^\s"'<>]+/i;
// Base32 in Gruppen (z. B. "JBSW Y3DP EHPK 3PXP"), mindestens 16 Zeichen
const SECRET_RE = /(?:^|[^A-Za-z2-7])((?:[A-Za-z2-7]{4}[  -]?){4,16}(?:[A-Za-z2-7]{1,4})?)(?![A-Za-z2-7])/g;

function findOtpauthUri(): string {
    const link = document.querySelector("a[href^='otpauth:' i]") as HTMLAnchorElement;
    if (link && OTPAUTH_RE.test(link.href)) return link.href.match(OTPAUTH_RE)[0];
    const html = document.documentElement.outerHTML.slice(0, 2000000).replace(/&amp;/g, "&");
    const m = html.match(OTPAUTH_RE);
    return m ? m[0] : null;
}

function findSecretText(pageText: string): string {
    SECRET_RE.lastIndex = 0;
    let m: RegExpExecArray;
    while ((m = SECRET_RE.exec(pageText)) !== null) {
        const raw = m[1].replace(/[\s -]/g, "");
        if (raw.length < 16 || raw.length > 64) continue;
        // Nur einheitliche Schreibweise und mindestens eine Ziffer 2–7 (schließt normale Wörter aus)
        if (raw !== raw.toUpperCase() && raw !== raw.toLowerCase()) continue;
        if (!/[2-7]/.test(raw)) continue;
        return raw.toUpperCase();
    }
    return null;
}

export interface QrRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

// Sichtbare, annähernd quadratische Bilder/Canvas/SVG als mögliche QR-Codes (Viewport-Koordinaten in CSS-Pixeln).
// Welche davon wirklich OTP-QR-Codes sind, entscheidet erst der Inhalt (otpauth://totp/...) nach dem Dekodieren.
function qrCandidateElements(inViewportOnly: boolean): HTMLElement[] {
    const found: HTMLElement[] = [];
    const nodes = Array.from(document.querySelectorAll("img, canvas, svg")) as HTMLElement[];
    for (const el of nodes) {
        if (el instanceof HTMLImageElement && !el.complete) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.width > 800 || r.height < 80) continue;
        if (Math.abs(r.width - r.height) / r.width > 0.15) continue;
        if (inViewportOnly && (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth)) continue;
        if (!isVisible(el)) continue;
        // Verschachtelte SVG-Teile nicht doppelt melden
        if (el instanceof SVGElement && el.ownerSVGElement) continue;
        found.push(el);
        if (found.length >= 8) break;
    }
    return found;
}

function qrCandidateRects(): QrRect[] {
    return qrCandidateElements(true).map(el => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
}

// Bildinhalt als PNG-Daten-URL mit weißem Rand (Ruhezone für den QR-Dekoder); wirft bei fremden Bildern ohne CORS
async function elementToDataUrl(el: HTMLElement): Promise<string> {
    let source: CanvasImageSource;
    let w = 0;
    let h = 0;
    if (el instanceof HTMLCanvasElement) {
        source = el;
        w = el.width;
        h = el.height;
    } else if (el instanceof HTMLImageElement) {
        source = el;
        w = el.naturalWidth;
        h = el.naturalHeight;
    } else if (el instanceof SVGSVGElement) {
        const r = el.getBoundingClientRect();
        const img = new Image();
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(el));
        await img.decode();
        source = img;
        w = Math.round(r.width) * 2;
        h = Math.round(r.height) * 2;
    }
    if (!source || !w || !h) return null;
    const scale = Math.min(1, 1024 / Math.max(w, h));
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    const pad = Math.round(Math.max(dw, dh) * 0.1);
    const canvas = document.createElement("canvas");
    canvas.width = dw + 2 * pad;
    canvas.height = dh + 2 * pad;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, pad, pad, dw, dh);
    return canvas.toDataURL("image/png");
}

// QR-Kandidaten als Bilddaten (auch in iframes, deren Lage im Bildschirmfoto unbekannt ist).
// Nicht auslesbare fremde Bilder gehen als Adresse an den Hintergrund, der sie selbst lädt.
// Schon geprüfte Elemente mit unveränderter Quelle werden übersprungen.
async function qrCandidateImages(seen: WeakMap<Element, string>): Promise<string[]> {
    const images: string[] = [];
    for (const el of qrCandidateElements(false)) {
        const signature = el instanceof HTMLImageElement ? el.currentSrc : el instanceof HTMLCanvasElement ? `${el.width}x${el.height}` : el.outerHTML.length.toString();
        if (seen.get(el) === signature && !(el instanceof HTMLCanvasElement)) continue;
        seen.set(el, signature);
        try {
            const data = await elementToDataUrl(el);
            if (data) images.push(data);
        } catch (e) {
            if (el instanceof HTMLImageElement && /^https:/i.test(el.currentSrc)) images.push(el.currentSrc);
        }
        if (images.length >= 4) break;
    }
    return images;
}

export function setValue(el: HTMLInputElement, value: string) {
    el.focus();
    // Über den nativen Setter, damit React/Vue die Änderung mitbekommen
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

export class OtpFields {
    // onCodeRequested: z. B. um bei gesperrter DB auf das Entsperren zu warten
    constructor(private onCodeRequested: () => void = () => undefined) {}

    private target: HTMLInputElement[] = null;
    private requestedFor: HTMLInputElement = null;
    private scanTimer: number = null;

    // Sucht nach einem OTP-Feld und fordert einmal pro Feld einen Code an
    public scanSoon() {
        if (this.scanTimer !== null) return;
        this.scanTimer = window.setTimeout(() => {
            this.scanTimer = null;
            this.scan();
        }, 300);
    }

    private setupReported = new Set<string>();
    private qrImagesSeen = new WeakMap<Element, string>();
    private observer: MutationObserver = null;
    private onImageLoad = (e: Event) => {
        if (e.target instanceof HTMLImageElement) this.scanSoon();
    };

    // Nachgeladene QR-Codes und erst später sichtbare Codefelder erkennen (viele Seiten zeigen sie erst nach einem Klick)
    public observe() {
        if (this.observer || !document.body) return;
        this.observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === "attributes") {
                    this.scanSoon();
                    return;
                }
                for (const node of Array.from(m.addedNodes)) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const el = node as Element;
                    if (el.matches?.("img, canvas, svg, input, a") || el.querySelector?.("img, canvas, svg, input, a")) {
                        this.scanSoon();
                        return;
                    }
                }
            }
        });
        // open/hidden: Codefeld erscheint erst beim Aufklappen (<details>, <dialog>) oder Einblenden, z. B. "App entfernen"
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "href", "open", "hidden"]
        });
        document.addEventListener("load", this.onImageLoad, true);
    }

    private scan() {
        const setupReported = this.scanSetup();
        const target = findOtpTarget();
        diagScan(target);
        if (!target) return;
        if (this.requestedFor === target[0] && document.contains(target[0])) return;
        this.target = target;
        this.requestedFor = target[0];
        // Einstellung "Einmalcodes automatisch eintragen" aus, oder der Code kommt laut Seite per SMS/E-Mail:
        // nur das Symbol zeigen, ein Klick holt den App-Code
        const channel = pageCodeChannel();
        pageDiag("codefeld herkunft", { herkunft: channel });
        if (configManager.current.ferryAutoFillOtp === false || channel === "other") {
            setupReported.finally(() => this.showIcon(target));
            return;
        }
        // Erst nach der Einrichtungsmeldung (QR-Auslesen ist asynchron) nach einem Code fragen,
        // sonst trägt der Hintergrund auf einer Einrichtungsseite den Code eines anderen Schlüssels ein
        setupReported.finally(() => {
            Port.postMessage({ action: Action.RequestOtp, url: window.location.href } as AddonMessage);
            this.onCodeRequested();
        });
    }

    // Hinweise auf eine Zwei-Faktor-Einrichtung melden (je Art einmal pro Seite)
    private scanSetup(): Promise<void> {
        if (!document.body || configManager.current.ferryDetectOtpSetup === false) return Promise.resolve();
        const report = (key: string, otpSetup: AddonMessage["otpSetup"]) => {
            if (this.setupReported.has(key)) return;
            this.setupReported.add(key);
            Port.postMessage({ action: Action.OtpSetupCandidate, otpSetup } as AddonMessage);
        };

        // 1. otpauth-Link im Dokument: eindeutig, in jeder Sprache
        const uri = findOtpauthUri();
        if (uri) {
            report("uri:" + uri, { otpUri: uri });
            return Promise.resolve();
        }

        // 2. QR-Code-Kandidaten: in jeder Sprache, Prüfung im Hintergrund über den Inhalt.
        // Bilddaten in jedem Frame (z. B. Einstellungen im iframe), Bildschirmfoto-Ausschnitt nur im Hauptframe
        const rects = window.top === window ? qrCandidateRects() : [];
        if (rects.length > 0) {
            const key = "qr:" + rects.map(r => `${r.x},${r.y},${r.w}`).join(";");
            report(key, { otpQrRects: rects, viewportWidth: window.innerWidth });
        }
        const images = qrCandidateImages(this.qrImagesSeen)
            .then(images => {
                if (images.length === 0) return;
                pageDiag("qr kandidaten", {
                    hauptframe: window.top === window,
                    anzahl: images.length,
                    arten: images.map(i => (i.startsWith("data:") ? "daten" : "adresse"))
                });
                report("img:" + images.map(i => i.length + i.slice(-32)).join(";"), { otpQrImages: images });
            })
            .catch(() => undefined);

        // 3. Schlüssel als Text: nur mit Einrichtungsbegriffen auf der Seite (sonst zu viele Fehltreffer)
        const pageText = (document.body.innerText ?? "").slice(0, 200000);
        if (SETUP_HINT.test(pageText) || SETUP_HINT_MORE.test(pageText)) {
            const secret = findSecretText(pageText);
            if (secret) report("text:" + secret, { otpSecret: secret });
        }
        return images;
    }

    // Nach dem Entsperren erneut nach einem OTP-Feld fragen (vorherige Anfrage lief bei gesperrter DB ins Leere)
    // Datenbank gesperrt: Zeitkreis anhalten, Symbol bleibt (Klick entsperrt und trägt den aktuellen Code ein).
    // Der Code im Feld bleibt stehen, damit eine laufende Eingabe nicht verloren geht.
    public onLocked() {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        // Noch kein Symbol (Seite bei gesperrter DB geladen): erkanntes Codefeld bekommt das Gesperrt-Symbol
        if (!this.iconField?.isConnected) {
            const target = findOtpTarget(true);
            if (!target) return;
            this.target = target;
            this.showIcon(target);
        }
        const el = this.iconField;
        if (!el?.isConnected) return;
        this.icons.setLabel(el, $STR("ferry_otp_icon_locked"));
        KeeFieldIcon.lockedIcon().then(image => {
            if (this.iconField === el && this.countdownTimer === null) this.icons.setImage(el, image, KeeFieldIcon.LOCKED_ICON_WIDTH);
        });
    }

    public rescan() {
        this.requestedFor = null;
        // Klick aufs Symbol bei gesperrter DB: nach dem Entsperren den Code für dieses Feld holen,
        // auch wenn dort noch ein alter Code steht (normale Suche nimmt nur leere Felder)
        if (this.forceNextFill && this.iconField?.isConnected) {
            this.target = this.iconTarget ?? [this.iconField];
            Port.postMessage({ action: Action.RequestOtp, url: window.location.href, userInitiated: true } as AddonMessage);
            return;
        }
        this.scanSoon();
    }

    // Derselbe Code wurde hier schon von selbst eingetragen: nichts eintragen, nur das Symbol (Klick trägt ein)
    public showIconOnly() {
        const target = this.target && document.contains(this.target[0]) ? this.target : findOtpTarget(true);
        if (!target) return;
        this.target = target;
        try {
            this.showIcon(target);
        } catch (e) {
            console.debug("KeePassFerry: OTP icon failed", e);
        }
    }

    // Für das Popup: hat die Seite ein Codefeld (auch schon ausgefülltes)?
    public hasTarget(): boolean {
        return !!findOtpTarget(true);
    }

    // Knopf "in die Seite eintragen" im Popup: Code eintragen, auch wenn dort schon ein Code steht
    public fillFromPopup(code: string, remaining?: number, period?: number) {
        this.target = findOtpTarget(true);
        if (!this.target) return;
        this.requestedFor = this.target[0];
        this.forceNextFill = true;
        this.fill(code, remaining, period);
    }

    public fill(code: string, remaining?: number, period?: number) {
        if (!this.target || !document.contains(this.target[0])) this.target = findOtpTarget();
        const target = this.target;
        const force = this.forceNextFill;
        this.forceNextFill = false;
        pageDiag("otp eintragen", {
            feld: target ? describeInput(target[0]) : null,
            gruppe: target?.length ?? 0,
            erneut: force
        });
        if (!target || !code || !target[0].isConnected) return;
        // Einzelziffernfelder: je Feld eine Ziffer, nur wenn die Länge passt
        if (target.length > 1 && code.length !== target.length) return;
        const filled = target.every(el => !el.value) || force;
        if (filled) {
            if (target.length === 1) setValue(target[0], code);
            else target.forEach((el, i) => setValue(el, code[i]));
        }
        // Symbol und Zeitkreis sind Zusatz: ein Fehler dort darf das Eintragen nicht verhindern
        try {
            this.showIcon(target);
            if (filled) this.startCountdown(target, code, remaining, period);
        } catch (e) {
            console.debug("KeePassFerry: OTP icon failed", e);
        }
    }

    // KeePassFerry-Symbol am Codefeld (schwebend wie bei Benutzer-/Passwortfeldern), sobald ein Einmalcode vorliegt.
    // Bei Einzelziffernfeldern rechts neben dem letzten Feld. Klick auf das Symbol trägt den aktuellen Code (neu) ein.
    private forceNextFill = false;
    private iconField: HTMLInputElement = null;
    private iconTarget: HTMLInputElement[] = null;
    private icons = new FloatingFieldIcons();

    private showIcon(target: HTMLInputElement[]) {
        if (configManager.current.ferryShowFieldIcons === false) return;
        // Neben das Feld: bei Einzelziffernfeldern und bei einem durchsichtigen Feld über gezeichneten Kästchen
        // (sonst läge das Symbol über der letzten Ziffer)
        const outside = target.length > 1 || Number(getComputedStyle(target[0]).opacity) === 0;
        const el = target[target.length - 1];
        this.iconTarget = target;
        if (this.iconField === el || (!outside && el.offsetWidth < 60)) return;
        if (this.iconField) this.icons.remove(this.iconField);
        this.iconField = el;
        this.icons.add(el, {
            image: KeeFieldIcon.FERRY_ICON_32,
            width: 16,
            label: $STR("ferry_otp_icon_label"),
            outside,
            onClick: () => {
                this.forceNextFill = true;
                Port.postMessage({ action: Action.RequestOtp, url: window.location.href, userInitiated: true } as AddonMessage);
                this.onCodeRequested();
            }
        });
    }

    // Gültigkeit des eingetragenen Codes als Kreis neben dem Symbol (grün, ab 10 s orange, ab 5 s rot).
    // Läuft der Code ab, während er noch unverändert im Feld steht, wird der neue Code eingetragen.
    private countdownTimer: number = null;
    private keyImage: HTMLImageElement = null;

    private startCountdown(target: HTMLInputElement[], code: string, remaining: number, period: number) {
        clearInterval(this.countdownTimer);
        if (!(remaining > 0) || !(period > 0)) return;
        const el = this.iconField;
        const currentValue = () => target.map(f => f.value).join("");
        const endsAt = Date.now() + remaining * 1000;
        const tick = () => {
            if (!el?.isConnected || this.iconField !== el) {
                clearInterval(this.countdownTimer);
                return;
            }
            const left = Math.max(0, (endsAt - Date.now()) / 1000);
            if (left <= 0) {
                clearInterval(this.countdownTimer);
                if (currentValue() === code) {
                    this.forceNextFill = true;
                    Port.postMessage({ action: Action.RequestOtp, url: window.location.href } as AddonMessage);
                } else {
                    this.icons.setImage(el, KeeFieldIcon.FERRY_ICON_32, 16);
                    this.icons.setLabel(el, $STR("ferry_otp_icon_label"));
                }
                return;
            }
            this.drawCountdown(el, left / period, left);
            this.icons.setLabel(el, $STRF("ferry_otp_icon_remaining", [String(Math.ceil(left))]));
        };
        tick();
        this.countdownTimer = window.setInterval(tick, 1000);
    }

    private drawCountdown(el: HTMLInputElement, fraction: number, secondsLeft: number) {
        const draw = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 66;
            canvas.height = 32;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(this.keyImage, 0, 0, 32, 32);
            const cx = 50, cy = 16, r = 11;
            ctx.lineWidth = 5;
            ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = secondsLeft <= 5 ? "#dc2626" : secondsLeft <= 10 ? "#d97706" : "#16a34a";
            ctx.beginPath();
            ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, fraction)));
            ctx.stroke();
            this.icons.setImage(el, canvas.toDataURL(), 33);
        };
        if (this.keyImage?.complete) {
            draw();
            return;
        }
        this.keyImage = new Image();
        this.keyImage.onload = draw;
        this.keyImage.src = KeeFieldIcon.FERRY_ICON_32;
    }

    public reset() {
        clearTimeout(this.scanTimer);
        this.scanTimer = null;
        this.target = null;
        this.requestedFor = null;
        this.setupReported.clear();
        clearInterval(this.countdownTimer);
        this.icons.clear();
        this.iconField = null;
        this.iconTarget = null;
        this.observer?.disconnect();
        this.observer = null;
        document.removeEventListener("load", this.onImageLoad, true);
    }
}
