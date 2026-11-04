// Sichtbarer Rahmen eines Felds: manche Seiten (z. B. Microsoft-Anmeldung) zeichnen den Rahmen um ein schmaleres
// Eingabefeld, das erst in der Mitte beginnt und schmaler wird, sobald die Seite ein Auge einblendet. Bis zu drei Ebenen
// nach oben, solange die Ebene kaum höher ist und kein weiteres Eingabefeld enthält. Als Rahmen zählt nur eine
// gezeichnete Ebene (Rand, Hintergrund, Schatten); ein Feld mit eigenem Rahmen ist selbst der Rahmen. Sonst galt ein
// unsichtbarer, breiterer Layout-Container (SourceForge) als Rahmen und das Symbol landete neben dem Feld.
export function fieldFrameRect(field: HTMLElement): DOMRect {
    const fieldRect = field.getBoundingClientRect();
    if (isDrawn(field)) return fieldRect;
    let best = fieldRect;
    let node: Element = field;
    for (let i = 0; i < 3; i++) {
        node = node.parentElement;
        if (!node || node === document.body || node === document.documentElement) break;
        const r = node.getBoundingClientRect();
        if (r.height > fieldRect.height + 16 || r.width > Math.max(fieldRect.width * 6, 600)) break;
        if (node.querySelectorAll("input:not([type=hidden]), textarea, select").length > 1) break;
        if (r.left <= best.left && r.right >= best.right && isDrawn(node)) best = r;
    }
    return best;
}

function isDrawn(element: Element): boolean {
    const style = getComputedStyle(element);
    const border = (width: string, lineStyle: string, color: string) =>
        parseFloat(width) > 0 && lineStyle !== "none" && lineStyle !== "hidden" && !isTransparent(color);
    return (
        border(style.borderTopWidth, style.borderTopStyle, style.borderTopColor) ||
        border(style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor) ||
        !isTransparent(style.backgroundColor) ||
        (!!style.boxShadow && style.boxShadow !== "none")
    );
}

function isTransparent(color: string): boolean {
    return !color || color === "transparent" || /^rgba\(.*,\s*0(\.0+)?\)$/.test(color);
}
