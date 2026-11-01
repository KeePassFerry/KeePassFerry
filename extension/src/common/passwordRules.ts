/*
passwordRules.ts: Passwortregeln von Websites im Format von Apple ("passwordrules", WHATWG-Vorschlag), z. B.
"minlength: 5; maxlength: 8; required: lower, upper; required: digit;". Quelle der Regeln: Apples Password Manager
Resources (siehe siteData/appleQuirks.json, NOTICE.md). Hier: Einlesen, passendes Passwort erzeugen, Kurzbeschreibung.
*/
import appleQuirks from "./siteData/appleQuirks.json";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGIT = "0123456789";
// Sonderzeichen laut Vorschlag ohne Leerzeichen (lässt sich schlecht tippen und wird oft abgeschnitten)
const SPECIAL = "-~!@#$%^&*_+=`|(){}[:;\"'<>,.?]/\\";

export type CharClass = "upper" | "lower" | "digit" | "special" | "custom";

export interface CharSet {
    classes: CharClass[];
    chars: string;
}

export interface PasswordRules {
    minLength: number;
    maxLength: number;
    required: CharSet[];
    allowed: string;
    maxConsecutive: number;
}

function unique(chars: string): string {
    return Array.from(new Set(Array.from(chars))).join("");
}

function parseClasses(value: string): CharSet {
    const classes: CharClass[] = [];
    let chars = "";
    // Eigene Zeichen in eckigen Klammern; "]" darf als letztes, "-" als erstes Zeichen darin stehen
    const custom = /\[(.*?)\](?=\s*(,|$))/g;
    const rest = value.replace(custom, (_m, inner: string) => {
        classes.push("custom");
        chars += inner;
        return "";
    });
    for (const raw of rest.split(",")) {
        const name = raw.trim().toLowerCase();
        if (!name) continue;
        if (name === "upper") { classes.push("upper"); chars += UPPER; }
        else if (name === "lower") { classes.push("lower"); chars += LOWER; }
        else if (name === "digit") { classes.push("digit"); chars += DIGIT; }
        else if (name === "special") { classes.push("special"); chars += SPECIAL; }
        else if (name === "ascii-printable" || name === "unicode") {
            classes.push("upper", "lower", "digit", "special");
            chars += UPPER + LOWER + DIGIT + SPECIAL;
        }
    }
    // Nur druckbare ASCII-Zeichen ohne Leerzeichen erzeugen
    chars = unique(Array.from(chars).filter(c => c > " " && c <= "~").join(""));
    return { classes: Array.from(new Set(classes)), chars };
}

export function parsePasswordRules(text: string): PasswordRules {
    const rules: PasswordRules = { minLength: 0, maxLength: 0, required: [], allowed: "", maxConsecutive: 0 };
    let allowed = "";
    for (const part of (text ?? "").split(";")) {
        const i = part.indexOf(":");
        if (i < 0) continue;
        const key = part.slice(0, i).trim().toLowerCase();
        const value = part.slice(i + 1).trim();
        if (key === "minlength") rules.minLength = Math.max(rules.minLength, parseInt(value, 10) || 0);
        else if (key === "maxlength") {
            const n = parseInt(value, 10) || 0;
            if (n > 0) rules.maxLength = rules.maxLength ? Math.min(rules.maxLength, n) : n;
        } else if (key === "max-consecutive") {
            const n = parseInt(value, 10) || 0;
            if (n > 0) rules.maxConsecutive = rules.maxConsecutive ? Math.min(rules.maxConsecutive, n) : n;
        } else if (key === "required") {
            const set = parseClasses(value);
            if (set.chars) rules.required.push(set);
        } else if (key === "allowed") {
            allowed += parseClasses(value).chars;
        }
    }
    allowed += rules.required.map(r => r.chars).join("");
    rules.allowed = unique(allowed) || unique(UPPER + LOWER + DIGIT + SPECIAL);
    return rules;
}

// Regel für eine Adresse: Eintrag für den Host oder eine übergeordnete Domain (gilt auch für Subdomains)
export function passwordRulesForHost(hostname: string): { domain: string; text: string } {
    const table = (appleQuirks as any).passwordRules as Record<string, string>;
    const labels = (hostname ?? "").toLowerCase().replace(/\.$/, "").split(".");
    for (let i = 0; i < labels.length - 1; i++) {
        const domain = labels.slice(i).join(".");
        if (table[domain]) return { domain, text: table[domain] };
    }
    return null;
}

function randomIndex(n: number, random: (n: number) => number): number {
    return random(n);
}

function cryptoRandom(n: number): number {
    // Gleichverteilt ohne Modulo-Verzerrung
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % n;
    }
}

function tooManyConsecutive(pw: string, max: number): boolean {
    if (!max) return false;
    let run = 1;
    for (let i = 1; i < pw.length; i++) {
        run = pw[i] === pw[i - 1] ? run + 1 : 1;
        if (run > max) return true;
    }
    return false;
}

// Passwort nach den Regeln; Länge: so lang wie erlaubt, höchstens preferredLength
export function generatePassword(rules: PasswordRules, preferredLength = 20, random: (n: number) => number = cryptoRandom): string {
    const max = rules.maxLength || Math.max(preferredLength, rules.minLength);
    let length = Math.min(max, Math.max(preferredLength, rules.minLength));
    length = Math.max(length, rules.required.length, 1);
    for (let attempt = 0; attempt < 100; attempt++) {
        const chars: string[] = rules.required.map(r => r.chars[randomIndex(r.chars.length, random)]);
        while (chars.length < length) chars.push(rules.allowed[randomIndex(rules.allowed.length, random)]);
        for (let i = chars.length - 1; i > 0; i--) {
            const j = randomIndex(i + 1, random);
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        // Zu lange Folgen gleicher Zeichen: das Zeichen durch ein anderes erlaubtes ersetzen (Pflichtzeichen bleiben,
        // denn ersetzt wird nur ein Zeichen, das direkt davor schon vorkommt)
        if (rules.maxConsecutive && rules.allowed.length > 1) {
            let run = 1;
            for (let i = 1; i < chars.length; i++) {
                run = chars[i] === chars[i - 1] ? run + 1 : 1;
                if (run > rules.maxConsecutive) {
                    const others = Array.from(rules.allowed).filter(c => c !== chars[i - 1] && c !== chars[i + 1]);
                    if (others.length) chars[i] = others[randomIndex(others.length, random)];
                    run = 1;
                }
            }
        }
        const pw = chars.join("");
        if (!tooManyConsecutive(pw, rules.maxConsecutive)) return pw;
    }
    throw new Error("Could not generate a password for these rules");
}

export interface RuleSummary {
    minLength: number;
    maxLength: number;
    required: CharClass[][];
    // Erlaubte Sonderzeichen, wenn die Website sie einschränkt (sonst leer)
    specialChars: string;
}

export function summarizeRules(rules: PasswordRules): RuleSummary {
    const specials = Array.from(rules.allowed).filter(c => SPECIAL.includes(c)).join("");
    return {
        minLength: rules.minLength,
        maxLength: rules.maxLength,
        required: rules.required.map(r => r.classes.filter(c => c !== "custom").concat(r.classes.includes("custom") ? ["special"] : [])),
        specialChars: specials.length > 0 && specials.length < unique(SPECIAL).length ? specials : ""
    };
}
