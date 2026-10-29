import { describe, expect, it } from "vitest";
import { LoginCandidate, matchSubmittedLogin, supersedesSubmission } from "../common/submittedLogin";

const entry = (uuid: string, username: string, password: string, dbFileName = "a.kdbx"): LoginCandidate => ({
    uuid,
    dbFileName,
    title: "Eintrag " + uuid,
    username,
    password
});
const form = (username: string, password: string) =>
    [
        username !== null ? { type: "text", value: username } : null,
        password !== null ? { type: "password", value: password } : null
    ].filter(Boolean);

describe("matchSubmittedLogin", () => {
    const max = entry("1", "max@example.com", "alt");

    it("gleicher Benutzer und gleiches Passwort ist bekannt (Groß-/Kleinschreibung beim Benutzer egal)", () => {
        expect(matchSubmittedLogin(form("Max@Example.com", "alt"), [max])).toEqual({ kind: "known" });
    });

    it("gleicher Benutzer mit anderem Passwort ist eine Passwortänderung", () => {
        expect(matchSubmittedLogin(form("max@example.com", "neu"), [max])).toEqual({ kind: "passwordChanged", entry: max });
    });

    it("anderer Benutzer mit gleichem Passwort ist neu (weiteres Konto)", () => {
        expect(matchSubmittedLogin(form("erika@example.com", "alt"), [max])).toEqual({ kind: "new" });
    });

    it("ohne passenden Eintrag ist neu", () => {
        expect(matchSubmittedLogin(form("max@example.com", "neu"), [])).toEqual({ kind: "new" });
    });

    it("mehrere Einträge mit diesem Benutzer: nur der gerade ausgefüllte, sonst nicht raten", () => {
        const zweiter = entry("2", "max@example.com", "anders", "b.kdbx");
        expect(matchSubmittedLogin(form("max@example.com", "neu"), [max, zweiter])).toEqual({ kind: "new" });
        expect(
            matchSubmittedLogin(form("max@example.com", "neu"), [max, zweiter], { uuid: "2", dbFileName: "b.kdbx" })
        ).toEqual({ kind: "passwordChanged", entry: zweiter });
    });

    it("derselbe Eintrag doppelt geliefert zählt einmal", () => {
        expect(matchSubmittedLogin(form("max@example.com", "neu"), [max, { ...max }])).toEqual({
            kind: "passwordChanged",
            entry: max
        });
    });

    it("ohne Benutzerfeld (zweiter Anmeldeschritt) zählt der gerade ausgefüllte Eintrag", () => {
        const erika = entry("3", "erika@example.com", "geheim");
        expect(matchSubmittedLogin(form(null, "neu"), [max, erika], { uuid: "3", dbFileName: "a.kdbx" })).toEqual({
            kind: "passwordChanged",
            entry: erika
        });
        expect(matchSubmittedLogin(form(null, "neu"), [max, erika])).toEqual({ kind: "new" });
        expect(matchSubmittedLogin(form(null, "geheim"), [max, erika], { uuid: "1", dbFileName: "a.kdbx" })).toEqual({
            kind: "known"
        });
    });

    it("nur Benutzername (erster Anmeldeschritt) ist bekannt oder neu, nie eine Passwortänderung", () => {
        expect(matchSubmittedLogin(form("max@example.com", null), [max])).toEqual({ kind: "known" });
        expect(matchSubmittedLogin(form("erika@example.com", null), [max], { uuid: "1", dbFileName: "a.kdbx" })).toEqual({
            kind: "new"
        });
    });

    it("ohne Werte ist neu", () => {
        expect(matchSubmittedLogin([], [max])).toEqual({ kind: "new" });
        expect(matchSubmittedLogin([{ type: "boolean", value: "true" }], [max])).toEqual({ kind: "new" });
    });
});

describe("supersedesSubmission", () => {
    const vorher = { url: "https://konto.example.com/login", username: "max@example.com" };

    it("gleicher Benutzer auf derselben Website erledigt das offene Angebot (auch mit anderer Groß-/Kleinschreibung)", () => {
        expect(supersedesSubmission(vorher, { url: "https://www.example.com/", username: "Max@Example.com" })).toBe(true);
    });

    it("ohne Benutzernamen (Passwortseite einer mehrstufigen Anmeldung) zählt die Website allein", () => {
        expect(supersedesSubmission(vorher, { url: "https://konto.example.com/passwort", username: null })).toBe(true);
        expect(supersedesSubmission({ ...vorher, username: null }, { url: vorher.url, username: "erika@example.com" })).toBe(true);
    });

    it("anderer Benutzer oder andere Website lässt das Angebot stehen", () => {
        expect(supersedesSubmission(vorher, { url: vorher.url, username: "erika@example.com" })).toBe(false);
        expect(supersedesSubmission(vorher, { url: "https://example.org/login", username: "max@example.com" })).toBe(false);
        expect(supersedesSubmission({ url: null, username: "max@example.com" }, vorher)).toBe(false);
    });
});
