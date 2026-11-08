// Ist ein Feld für den Nutzer wirklich zu sehen? Gemeinsam für das Ausfüllen (OtpFields, page.ts) und die Feldsymbole
// (FloatingFieldIcons), damit kein Symbol an einem Feld hängt, in das nie ausgefüllt würde.

export function isVisible(el: HTMLElement): boolean {
    if (el.offsetWidth <= 0 && el.offsetHeight <= 0) return false;
    // Inhalt eines zugeklappten <details> (Chromium: content-visibility: hidden) behält seine Maße, ist aber nicht zu sehen.
    // Sonst landet der Code z. B. im verborgenen Feld "App entfernen" und die Seite schickt es selbst ab.
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true } as any)) return false;
    const closedDetails = el.closest("details:not([open])");
    if (closedDetails && !el.closest("summary")?.parentElement?.isSameNode(closedDetails)) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (isClippedByStyle(style)) return false;
    if (isOffPage(el)) return false;
    return !isClippedAway(el);
}

// Ganz links bzw. oberhalb des Seitenanfangs (z. B. left: -9999px): dorthin kann man nicht scrollen. Zalando legt so
// die weiteren Anmeldestufen ab; ohne diese Prüfung gewann ein solches Formular und das sichtbare bekam kein Symbol
export function isOffPage(el: Element): boolean {
    const r = el.getBoundingClientRect();
    return r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0;
}

// Nur für Screenreader sichtbar ("sr-only"/"visually-hidden"): clip: rect(0 0 0 0) bzw. clip-path auf nichts
function isClippedByStyle(style: CSSStyleDeclaration): boolean {
    if (style.position === "absolute" || style.position === "fixed") {
        if (/rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(style.clip)) return true;
    }
    return /inset\(\s*(50|100)%/.test(style.clipPath) || /circle\(\s*0(px)?\b/.test(style.clipPath);
}

// Zugeklappte Bereiche, die nur über Höhe 0 und overflow: hidden verborgen sind (z. B. Amazon: QR-Code der
// Authentifizierungs-App, bevor diese Option gewählt ist). Scrollbereiche zählen nicht: dort kann man hinscrollen.
function isClippedAway(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        const clips = /hidden|clip/.test(s.overflowX) || /hidden|clip/.test(s.overflowY);
        if (!clips) continue;
        const pr = p.getBoundingClientRect();
        const w = Math.min(r.right, pr.right) - Math.max(r.left, pr.left);
        const h = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
        if (w < 2 || h < 2) return true;
    }
    return false;
}
