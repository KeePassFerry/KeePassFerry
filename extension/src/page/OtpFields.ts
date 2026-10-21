import { Port } from "../common/port";
import { Action } from "../common/Action";
import type { AddonMessage } from "../common/AddonMessage";
import { findInputsInOpenShadowRoots } from "./shadowDom";
import { KeeFieldIcon } from "./keeFieldIcon";
import { FloatingFieldIcons } from "./FloatingFieldIcons";
import { pageDiag } from "./ferryDiagPage";

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
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
}

function isEditable(el: HTMLInputElement): boolean {
    return !el.disabled && !el.readOnly && isVisible(el);
}

function allInputs(): HTMLInputElement[] {
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

// Liefert entweder ein einzelnes Feld oder eine Gruppe von Einzelziffernfeldern
function findOtpTarget(): HTMLInputElement[] | null {
    const inputs = allInputs().filter(isEditable);

    const single = inputs.find(el => isOtpField(el) && el.maxLength !== 1 && !el.value);
    if (single) return [single];

    // Einzelziffernfelder: gleiche Elternebene, aufeinanderfolgend, maxlength=1
    const singles = inputs.filter(el => el.maxLength === 1 && TEXT_TYPES.includes((el.getAttribute("type") ?? "").toLowerCase()));
    const byParent = new Map<Node, HTMLInputElement[]>();
    for (const el of singles) {
        const key = el.parentElement?.parentElement ?? el.parentElement;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(el);
    }
    for (const group of byParent.values()) {
        if (group.length >= 6 && group.length <= 8 && group.every(el => !el.value)) {
            if (NOT_TOTP_HINT.test(group.map(hintText).join(" "))) continue;
            return group;
        }
    }
    return null;
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
function qrCandidateRects(): QrRect[] {
    const rects: QrRect[] = [];
    const nodes = Array.from(document.querySelectorAll("img, canvas, svg")) as HTMLElement[];
    for (const el of nodes) {
        if (el instanceof HTMLImageElement && !el.complete) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.width > 800 || r.height < 80) continue;
        if (Math.abs(r.width - r.height) / r.width > 0.15) continue;
        if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) continue;
        if (!isVisible(el)) continue;
        // Verschachtelte SVG-Teile nicht doppelt melden
        if (el instanceof SVGElement && el.ownerSVGElement) continue;
        rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
        if (rects.length >= 8) break;
    }
    return rects;
}

function setValue(el: HTMLInputElement, value: string) {
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
    private observer: MutationObserver = null;
    private onImageLoad = (e: Event) => {
        if (e.target instanceof HTMLImageElement) this.scanSoon();
    };

    // Nachgeladene QR-Codes erkennen (viele Seiten zeigen ihn erst nach einem Klick auf "2FA aktivieren")
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
        this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
        document.addEventListener("load", this.onImageLoad, true);
    }

    private scan() {
        this.scanSetup();
        const target = findOtpTarget();
        diagScan(target);
        if (!target) return;
        if (this.requestedFor === target[0] && document.contains(target[0])) return;
        this.target = target;
        this.requestedFor = target[0];
        Port.postMessage({ action: Action.RequestOtp, url: window.location.href } as AddonMessage);
        this.onCodeRequested();
    }

    // Hinweise auf eine Zwei-Faktor-Einrichtung melden (je Art einmal pro Seite)
    private scanSetup() {
        if (!document.body) return;
        const report = (key: string, otpSetup: AddonMessage["otpSetup"]) => {
            if (this.setupReported.has(key)) return;
            this.setupReported.add(key);
            Port.postMessage({ action: Action.OtpSetupCandidate, otpSetup } as AddonMessage);
        };

        // 1. otpauth-Link im Dokument: eindeutig, in jeder Sprache
        const uri = findOtpauthUri();
        if (uri) {
            report("uri:" + uri, { otpUri: uri });
            return;
        }

        // 2. QR-Code-Kandidaten: in jeder Sprache, Prüfung im Hintergrund über den Inhalt
        const rects = window.top === window ? qrCandidateRects() : [];
        if (rects.length > 0) {
            const key = "qr:" + rects.map(r => `${r.x},${r.y},${r.w}`).join(";");
            report(key, { otpQrRects: rects, viewportWidth: window.innerWidth });
        }

        // 3. Schlüssel als Text: nur mit Einrichtungsbegriffen auf der Seite (sonst zu viele Fehltreffer)
        const pageText = (document.body.innerText ?? "").slice(0, 200000);
        if (SETUP_HINT.test(pageText) || SETUP_HINT_MORE.test(pageText)) {
            const secret = findSecretText(pageText);
            if (secret) report("text:" + secret, { otpSecret: secret });
        }
    }

    // Nach dem Entsperren erneut nach einem OTP-Feld fragen (vorherige Anfrage lief bei gesperrter DB ins Leere)
    // Datenbank gesperrt: Zeitkreis anhalten, Symbol bleibt (Klick entsperrt und trägt den aktuellen Code ein).
    // Der Code im Feld bleibt stehen, damit eine laufende Eingabe nicht verloren geht.
    public onLocked() {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        const el = this.iconField;
        if (!el?.isConnected) return;
        this.icons.setImage(el, KeeFieldIcon.FERRY_ICON_32, 16);
        this.icons.setLabel(el, $STR("ferry_otp_icon_locked"));
    }

    public rescan() {
        this.requestedFor = null;
        // Klick aufs Symbol bei gesperrter DB: nach dem Entsperren den Code für dieses Feld holen,
        // auch wenn dort noch ein alter Code steht (normale Suche nimmt nur leere Felder)
        if (this.forceNextFill && this.iconField?.isConnected) {
            this.target = [this.iconField];
            Port.postMessage({ action: Action.RequestOtp, url: window.location.href, userInitiated: true } as AddonMessage);
            return;
        }
        this.scanSoon();
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
        if (target.length === 1) {
            const filled = !target[0].value || force;
            if (filled) setValue(target[0], code);
            // Symbol und Zeitkreis sind Zusatz: ein Fehler dort darf das Eintragen nicht verhindern
            try {
                this.showIcon(target[0]);
                if (filled) this.startCountdown(target[0], code, remaining, period);
            } catch (e) {
                console.debug("KeePassFerry: OTP icon failed", e);
            }
            return;
        }
        if (code.length !== target.length) return;
        target.forEach((el, i) => setValue(el, code[i]));
    }

    // KeePassFerry-Symbol am Codefeld (schwebend wie bei Benutzer-/Passwortfeldern), sobald ein Einmalcode vorliegt.
    // Klick auf das Symbol trägt den aktuellen Code (neu) ein.
    private forceNextFill = false;
    private iconField: HTMLInputElement = null;
    private icons = new FloatingFieldIcons();

    private showIcon(el: HTMLInputElement) {
        if (this.iconField === el || el.offsetWidth < 60) return;
        if (this.iconField) this.icons.remove(this.iconField);
        this.iconField = el;
        this.icons.add(el, {
            image: KeeFieldIcon.FERRY_ICON_32,
            width: 16,
            label: $STR("ferry_otp_icon_label"),
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

    private startCountdown(el: HTMLInputElement, code: string, remaining: number, period: number) {
        clearInterval(this.countdownTimer);
        if (!(remaining > 0) || !(period > 0)) return;
        const endsAt = Date.now() + remaining * 1000;
        const tick = () => {
            if (!el.isConnected || this.iconField !== el) {
                clearInterval(this.countdownTimer);
                return;
            }
            const left = Math.max(0, (endsAt - Date.now()) / 1000);
            if (left <= 0) {
                clearInterval(this.countdownTimer);
                if (el.value === code) {
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
        this.observer?.disconnect();
        this.observer = null;
        document.removeEventListener("load", this.onImageLoad, true);
    }
}
