import { describe, expect, it } from "vitest";
import { generatePassword, parsePasswordRules, passwordRulesForHost, summarizeRules } from "../common/passwordRules";
import appleQuirks from "../common/siteData/appleQuirks.json";

const check = (pw: string, re: RegExp) => expect(pw).toMatch(re);

describe("parsePasswordRules", () => {
    it("liest Länge und Pflichtklassen", () => {
        const r = parsePasswordRules("minlength: 5; maxlength: 8; required: lower, upper; required: digit;");
        expect(r.minLength).toBe(5);
        expect(r.maxLength).toBe(8);
        expect(r.required.length).toBe(2);
        expect(r.allowed).not.toMatch(/[^A-Za-z0-9]/);
    });
    it("liest eigene Sonderzeichen in Klammern", () => {
        const r = parsePasswordRules("minlength: 8; allowed: lower, upper, digit, [-!$%&];");
        expect(r.allowed).toContain("-");
        expect(r.allowed).toContain("&");
        expect(r.allowed).not.toContain("@");
    });
    it("liest max-consecutive", () => {
        expect(parsePasswordRules("max-consecutive: 2;").maxConsecutive).toBe(2);
    });
});

describe("generatePassword", () => {
    it("hält Commerzbank-Regel ein (5–8, Groß, Klein, Ziffer)", () => {
        const r = parsePasswordRules("minlength: 5; maxlength: 8; required: lower, upper; required: digit;");
        for (let i = 0; i < 200; i++) {
            const pw = generatePassword(r);
            expect(pw.length).toBe(8);
            check(pw, /^[A-Za-z0-9]+$/);
            check(pw, /[A-Za-z]/);
            check(pw, /[0-9]/);
        }
    });
    it("hält getrennte Pflichtklassen ein", () => {
        const r = parsePasswordRules("minlength: 8; required: lower; required: upper; required: digit; required: [-!$];");
        for (let i = 0; i < 200; i++) {
            const pw = generatePassword(r);
            check(pw, /[a-z]/);
            check(pw, /[A-Z]/);
            check(pw, /[0-9]/);
            check(pw, /[-!$]/);
            check(pw, /^[A-Za-z0-9!$-]+$/);
        }
    });
    it("hält max-consecutive ein", () => {
        const r = parsePasswordRules("minlength: 30; maxlength: 30; required: digit; max-consecutive: 1;");
        for (let i = 0; i < 50; i++) expect(generatePassword(r)).not.toMatch(/(.)\1/);
    });
    it("ohne Höchstlänge: bevorzugte Länge", () => {
        expect(generatePassword(parsePasswordRules("minlength: 8;"), 20).length).toBe(20);
    });
});

describe("alle Regeln aus Apples Daten", () => {
    it("lassen sich einlesen und erfüllen", () => {
        const table = (appleQuirks as any).passwordRules as Record<string, string>;
        for (const [domain, text] of Object.entries(table)) {
            const r = parsePasswordRules(text);
            const pw = generatePassword(r);
            const ok =
                (!r.minLength || pw.length >= r.minLength) &&
                (!r.maxLength || pw.length <= r.maxLength) &&
                r.required.every(set => Array.from(pw).some(c => set.chars.includes(c))) &&
                Array.from(pw).every(c => r.allowed.includes(c));
            expect(ok, domain + ": " + text + " → " + pw).toBe(true);
        }
    });
});

describe("passwordRulesForHost", () => {
    it("findet Regel auch für Subdomains", () => {
        expect(passwordRulesForHost("kunden.commerzbank.de")?.domain).toBe("commerzbank.de");
        expect(passwordRulesForHost("commerzbank.de")?.domain).toBe("commerzbank.de");
    });
    it("liefert null ohne Regel", () => {
        expect(passwordRulesForHost("example.org")).toBeNull();
    });
});

describe("summarizeRules", () => {
    it("meldet eingeschränkte Sonderzeichen", () => {
        const s = summarizeRules(parsePasswordRules("minlength: 8; allowed: lower, upper, digit, [-!$];"));
        expect(s.specialChars).toBe("-!$");
    });
});
