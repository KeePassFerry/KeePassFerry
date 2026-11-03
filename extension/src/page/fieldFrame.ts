// Sichtbarer Rahmen eines Felds: manche Seiten (z. B. Microsoft-Anmeldung) zeichnen den Rahmen um ein schmaleres
// Eingabefeld, das erst in der Mitte beginnt und schmaler wird, sobald die Seite ein Auge einblendet. Bis zu drei Ebenen
// nach oben, solange die Ebene kaum höher ist und kein weiteres Eingabefeld enthält.
export function fieldFrameRect(field: HTMLElement): DOMRect {
    const fieldRect = field.getBoundingClientRect();
    let best = fieldRect;
    let node: Element = field;
    for (let i = 0; i < 3; i++) {
        node = node.parentElement;
        if (!node || node === document.body || node === document.documentElement) break;
        const r = node.getBoundingClientRect();
        if (r.height > fieldRect.height + 16 || r.width > Math.max(fieldRect.width * 6, 600)) break;
        if (node.querySelectorAll("input:not([type=hidden]), textarea, select").length > 1) break;
        if (r.left <= best.left && r.right >= best.right) best = r;
    }
    return best;
}
