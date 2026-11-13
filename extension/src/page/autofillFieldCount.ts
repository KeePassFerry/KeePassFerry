// Felder eines Formulars, die für die Quote beim automatischen Ausfüllen zählen: Text und Passwort mit id oder name.
// Versteckte Felder (z. B. ein ausgeblendetes Captcha) zählen nicht, sonst fiel die Quote unter die Schwelle (#45).
// Gilt keines als sichtbar, zählen wie bisher alle, damit eine Fehleinschätzung der Sichtbarkeit nichts verschlechtert.

export interface CountableField {
    type: string;
    id?: string;
    name?: string;
}

export function autofillFieldCount(fields: CountableField[], visible: boolean[]): number {
    const countable = fields.map(f => (f.type === "password" || f.type === "text") && !!(f.id || f.name));
    const all = countable.filter(Boolean).length;
    const shown = countable.filter((c, i) => c && visible[i] !== false).length;
    return shown > 0 ? shown : all;
}
