/*
FloatingFieldIcons.ts: KeePassFerry-Symbole, die neben Eingabefeldern über der Seite schweben.
Ein Host-Element am Dokument (geschlossener Shadow DOM, position: fixed), darin ein Knopf je Feld.
Die Seite selbst wird nicht verändert. Die Position folgt dem Feld bei Scrollen, Größen- und Layoutänderungen;
verdeckte oder unsichtbare Felder bekommen kein Symbol.
- waagerecht: rechts im Feld, links neben eigenen Symbolen der Seite (Auge, Stift …); in Edge-Passwortfeldern
  Platz für Edges Anzeigen-Knopf, solange der Nutzer selbst tippt
- senkrecht: Mitte des sichtbaren Feldrahmens (auch über Shadow DOM hinweg), sonst Mitte des Felds
*/

const HOST_TAG = "keepassferry-field-icons";
const BASE_OFFSET = 4;
const EDGE_REVEAL_OFFSET = 30;

export interface FloatingIconOptions {
    image: string;
    width: number;
    label: string;
    // Rechts neben dem Feld statt darin (z. B. neben dem letzten von mehreren Einzelziffernfeldern)
    outside?: boolean;
    onClick: () => void;
}

interface IconState {
    button: HTMLButtonElement;
    img: HTMLImageElement;
    width: number;
    offset: number;
    outside: boolean;
    // Edge zeigt sein Auge, weil der Nutzer selbst tippt: zusätzlich Platz dafür lassen
    edgeTyped?: boolean;
    onInput?: (e: Event) => void;
}

type PointRoot = { elementFromPoint(x: number, y: number): Element };

function rootFor(element: Element): PointRoot {
    const rootNode = element.getRootNode() as any;
    return typeof rootNode.elementFromPoint === "function" ? rootNode : document;
}

function isOwnHost(el: Element): boolean {
    return el?.tagName?.toLowerCase() === HOST_TAG;
}

// Linke Kante des sichtbaren Teils eines fremden Elements: Knöpfe haben oft eine große unsichtbare
// Klickfläche (Innenabstand); maßgeblich ist das Symbol darin (svg/img/i) bzw. der Inhaltsbereich.
function visibleLeft(el: Element, field: DOMRect): number {
    const target = (el.closest("svg") as Element) ?? el;
    const box = target.getBoundingClientRect();
    let left = Infinity;
    const media = target.matches("svg, img, i") ? [target] : Array.from(target.querySelectorAll("svg, img, i"));
    for (const m of media) {
        const r = m.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.height > field.height * 1.5) continue;
        if (r.bottom < field.top || r.top > field.bottom) continue;
        left = Math.min(left, r.left);
    }
    if (left !== Infinity) return left;
    const style = window.getComputedStyle(target);
    return box.left + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
}

// Abstand vom rechten Feldrand: links neben einem eigenen Element der Seite, das rechts im Feld liegt
export function computeIconOffset(element: HTMLElement, iconWidth: number): number {
    let offset = BASE_OFFSET;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return offset;
    const y = rect.top + rect.height / 2;
    const root = rootFor(element);
    for (let i = 0; i < 3; i++) {
        const iconRight = rect.right - offset;
        if (iconRight - iconWidth <= rect.left + rect.width / 2) break;
        let blocker: Element = null;
        for (const x of [iconRight - 1, iconRight - iconWidth / 2, iconRight - iconWidth + 1]) {
            const topmost = root.elementFromPoint(x, y);
            if (topmost && topmost !== element && !isOwnHost(topmost) && !topmost.contains(element) && !element.contains(topmost)) {
                blocker = topmost;
                break;
            }
        }
        if (!blocker) break;
        // Große Ebenen (Labels, Wrapper) sind keine Knöpfe und werden ignoriert
        const b = blocker.getBoundingClientRect();
        if (b.width >= rect.width * 0.5 || b.left >= rect.right || b.right <= rect.left) break;
        const newOffset = Math.ceil(rect.right - visibleLeft(blocker, rect)) + 4;
        if (newOffset <= offset) break;
        offset = newOffset;
    }
    return offset;
}

// Edge zeigt in Passwortfeldern einen eigenen Anzeigen-Knopf, aber nur, solange der Nutzer selbst tippt
// (nicht nach dem Ausfüllen) und die Seite ihn nicht per ::-ms-reveal ausblendet.
function edgeRevealPossible(element: HTMLElement): boolean {
    const isEdge = (navigator as any).userAgentData?.brands?.some(b => b.brand === "Microsoft Edge");
    if (!isEdge || (element as HTMLInputElement).type !== "password") return false;
    try {
        return window.getComputedStyle(element, "::-ms-reveal").display !== "none";
    } catch (e) {
        return true;
    }
}

// Senkrechte Mitte des sichtbaren Feldrahmens: nächster Vorfahr (auch über Shadow DOM hinweg), der höher ist
// als das Feld, kaum breiter ist und einen Rahmen oder eigenen Hintergrund hat. Sonst die Mitte des Felds.
function visualCenterY(element: HTMLElement, rect: DOMRect): number {
    let node: Element = element;
    for (let i = 0; i < 6; i++) {
        const parent = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element);
        if (!parent || parent === document.body || parent === document.documentElement) break;
        node = parent;
        const r = parent.getBoundingClientRect();
        if (r.height < rect.height + 4) continue;
        if (r.height > rect.height * 3.5 || r.width > rect.width * 2.2) break;
        const s = window.getComputedStyle(parent);
        const framed =
            parseFloat(s.borderTopWidth) > 0 ||
            parseFloat(s.borderBottomWidth) > 0 ||
            (s.boxShadow && s.boxShadow !== "none") ||
            (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
        if (framed) return r.top + r.height / 2;
    }
    return rect.top + rect.height / 2;
}

// Sichtbar und nicht von etwas anderem verdeckt (z. B. Dialog über dem Formular)
function isShown(element: HTMLElement, rect: DOMRect): boolean {
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    const x = Math.min(rect.right - 2, Math.max(rect.left + 2, rect.left + rect.width / 3));
    const hit = rootFor(element).elementFromPoint(x, rect.top + rect.height / 2);
    if (!hit) return false;
    if (hit === element || element.contains(hit) || hit.contains(element) || isOwnHost(hit)) return true;
    // Schwebende Beschriftungen (Material-Design-Felder) liegen oft über dem Feld
    const labels = (element as HTMLInputElement).labels;
    return hit.tagName === "LABEL" || (!!labels && Array.from(labels).some(l => l.contains(hit)));
}

export class FloatingFieldIcons {
    private host: HTMLElement = null;
    private root: ShadowRoot = null;
    private icons = new Map<HTMLElement, IconState>();
    private timer: number = null;
    private resizeObserver: ResizeObserver = null;
    private scheduled = false;
    private onViewportChange = () => this.positionAllSoon();

    public has(element: HTMLElement) {
        return this.icons.has(element);
    }

    public elements(): HTMLElement[] {
        return Array.from(this.icons.keys()).filter(el => el.isConnected);
    }

    public add(element: HTMLElement, options: FloatingIconOptions) {
        if (this.icons.has(element)) return;
        this.ensureHost();

        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.setAttribute("aria-label", options.label);
        // Eigener Tooltip statt title: der Text (z. B. Restzeit des Codes) aktualisiert sich, solange er offen ist
        button.addEventListener("mouseenter", () => this.showTip(element));
        button.addEventListener("mouseleave", () => this.hideTip());
        const img = document.createElement("img");
        img.alt = "";
        button.append(img);
        // Fokus bleibt im Feld
        button.addEventListener("mousedown", e => e.preventDefault());
        button.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            options.onClick();
        });
        this.root.append(button);

        const state: IconState = { button, img, width: options.width, offset: BASE_OFFSET, outside: !!options.outside };
        this.icons.set(element, state);
        this.setImage(element, options.image, options.width);
        this.resizeObserver.observe(element);

        this.recomputeOffset(element, state);
        if (!state.outside && edgeRevealPossible(element)) {
            state.onInput = (e: Event) => {
                const typed = e.isTrusted && (e as InputEvent).inputType?.startsWith("insert");
                if (!(element as HTMLInputElement).value) state.edgeTyped = false;
                else if (typed) state.edgeTyped = true;
                this.position(element, state);
            };
            element.addEventListener("input", state.onInput);
        }
        this.position(element, state);
    }

    // Abstand zu eigenen Knöpfen der Seite (Auge, Stift …) neu bestimmen. Das eigene Symbol ist dabei kurz
    // durchklickbar, damit darunterliegende Seitenelemente gefunden werden.
    private recomputeOffset(element: HTMLElement, state: IconState) {
        if (state.outside) return;
        const previous = state.button.style.pointerEvents;
        state.button.style.pointerEvents = "none";
        try {
            state.offset = computeIconOffset(element, state.width);
        } finally {
            state.button.style.pointerEvents = previous;
        }
    }

    // Bild austauschen (z. B. Anzahl-Plakette oder Gültigkeitskreis), Position bleibt rechtsbündig
    public setImage(element: HTMLElement, image: string, width: number) {
        const state = this.icons.get(element);
        if (!state) return;
        const widthChanged = state.width !== width;
        state.width = width;
        if (state.img.src !== image) state.img.src = image;
        state.img.style.width = width + "px";
        // Breiteres Symbol (z. B. Anzahl-Plakette) kann in Seitenknöpfe hineinragen
        if (widthChanged) this.recomputeOffset(element, state);
        this.position(element, state);
    }

    // Tooltip/Bedienhilfe-Text austauschen (z. B. Restlaufzeit des Einmalcodes)
    public setLabel(element: HTMLElement, label: string) {
        const state = this.icons.get(element);
        if (!state || state.button.getAttribute("aria-label") === label) return;
        state.button.setAttribute("aria-label", label);
        if (this.tipFor === element) this.showTip(element);
    }

    private tip: HTMLDivElement = null;
    private tipFor: HTMLElement = null;

    private showTip(element: HTMLElement) {
        const state = this.icons.get(element);
        if (!state || !this.root) return;
        if (!this.tip) {
            this.tip = document.createElement("div");
            this.tip.className = "tip";
            this.tip.setAttribute("aria-hidden", "true");
            this.root.append(this.tip);
        }
        this.tipFor = element;
        this.tip.textContent = state.button.getAttribute("aria-label") ?? "";
        this.tip.style.display = "block";
        const b = state.button.getBoundingClientRect();
        const t = this.tip.getBoundingClientRect();
        const left = Math.min(Math.max(4, b.left + b.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
        const below = b.bottom + 6 + t.height <= window.innerHeight;
        this.tip.style.left = Math.round(left) + "px";
        this.tip.style.top = Math.round(below ? b.bottom + 6 : b.top - 6 - t.height) + "px";
    }

    private hideTip() {
        this.tipFor = null;
        if (this.tip) this.tip.style.display = "none";
    }

    public remove(element: HTMLElement) {
        const state = this.icons.get(element);
        if (!state) return;
        if (state.onInput) element.removeEventListener("input", state.onInput);
        if (this.tipFor === element) this.hideTip();
        state.button.remove();
        this.resizeObserver?.unobserve(element);
        this.icons.delete(element);
        if (this.icons.size === 0) this.clear();
    }

    public clear() {
        this.icons.forEach((state, element) => {
            if (state.onInput) element.removeEventListener("input", state.onInput);
        });
        this.icons.clear();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        clearInterval(this.timer);
        this.timer = null;
        window.removeEventListener("scroll", this.onViewportChange, true);
        window.removeEventListener("resize", this.onViewportChange);
        this.host?.remove();
        this.host = null;
        this.root = null;
        this.tip = null;
        this.tipFor = null;
    }

    private ensureHost() {
        if (this.host?.isConnected) return;
        this.host = document.createElement(HOST_TAG);
        for (const [k, v] of [["all", "initial"], ["position", "fixed"], ["inset", "0"], ["pointer-events", "none"], ["z-index", "2147483646"]]) {
            this.host.style.setProperty(k, v, "important");
        }
        this.root = this.host.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent = `
            button { position: fixed; display: none; margin: 0; padding: 0; border: 0; background: transparent;
                     cursor: pointer; pointer-events: auto; line-height: 0; }
            button img { display: block; height: 16px; }
            button:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; border-radius: 4px; }
            .tip { position: fixed; display: none; pointer-events: none; white-space: nowrap; padding: 4px 8px;
                   border-radius: 4px; background: rgba(33, 33, 33, 0.92); color: #fff;
                   font: 12px/1.4 "Segoe UI", system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); }`;
        this.root.append(style);
        document.documentElement.appendChild(this.host);
        window.addEventListener("scroll", this.onViewportChange, { capture: true, passive: true });
        window.addEventListener("resize", this.onViewportChange, { passive: true });
        this.resizeObserver = new ResizeObserver(() => this.positionAllSoon());
        // Layoutverschiebungen ohne Scroll-/Größenereignis (nachgeladene Inhalte, Animationen)
        this.timer = window.setInterval(() => {
            // Seitenknöpfe erscheinen oft erst nach dem Feld (z. B. Angular/React): Abstand mitprüfen
            this.icons.forEach((state, element) => this.recomputeOffset(element, state));
            this.positionAll();
        }, 700);
    }

    private positionAllSoon() {
        if (this.scheduled) return;
        this.scheduled = true;
        requestAnimationFrame(() => {
            this.scheduled = false;
            this.positionAll();
        });
    }

    private positionAll() {
        this.icons.forEach((state, element) => this.position(element, state));
    }

    private position(element: HTMLElement, state: IconState) {
        const rect = element.getBoundingClientRect();
        if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || !isShown(element, rect)) {
            state.button.style.display = "none";
            return;
        }
        const offset = state.edgeTyped ? Math.max(state.offset, EDGE_REVEAL_OFFSET) : state.offset;
        const left = Math.round(state.outside ? rect.right + 8 : rect.right - offset - state.width);
        const top = Math.round(visualCenterY(element, rect) - 8);
        // Neben dem Feld (Einzelziffern) liegt naturgemäß kein Feld unter dem Symbol: dort nicht prüfen
        if (!state.outside && !this.spotBelongsToField(element, state, left + state.width / 2, top + 8)) {
            state.button.style.display = "none";
            return;
        }
        state.button.style.left = left + "px";
        state.button.style.top = top + "px";
        state.button.style.display = "block";
    }

    // Liegt an der Stelle des Symbols das Feld bzw. sein Rahmen oben? Sonst verdeckt etwas anderes das Feld
    // dort (Auswahlliste, Dialog, Cookie-Banner) und das Symbol darf nicht darüber schweben.
    private spotBelongsToField(element: HTMLElement, state: IconState, x: number, y: number): boolean {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
        const previous = state.button.style.pointerEvents;
        state.button.style.pointerEvents = "none";
        let hit: Element;
        try {
            hit = rootFor(element).elementFromPoint(x, y);
        } finally {
            state.button.style.pointerEvents = previous;
        }
        if (!hit) return false;
        if (isOwnHost(hit) || hit === element || element.contains(hit) || hit.contains(element)) return true;
        // Rahmen des Felds (bis zu drei Ebenen, kaum größer als das Feld) mit Seitenknöpfen wie dem Auge
        const fieldRect = element.getBoundingClientRect();
        let node: Element = element;
        for (let i = 0; i < 3; i++) {
            node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element);
            if (!node || node === document.body || node === document.documentElement) break;
            const r = node.getBoundingClientRect();
            if (r.width > fieldRect.width * 1.6 || r.height > fieldRect.height * 3) break;
            if (node.contains(hit)) return true;
        }
        return false;
    }
}
