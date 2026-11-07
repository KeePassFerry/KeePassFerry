import { FerryURL } from "./FerryURL";
import { sameSite } from "./relatedDomains";

/*
submittedLogin.ts: Abgeschickte Anmeldedaten mit den Einträgen der Seite vergleichen.
- "known": ein Eintrag hat denselben Benutzernamen und dasselbe Passwort (kein Hinweis)
- "passwordChanged": genau ein Eintrag hat denselben Benutzernamen, aber ein anderes Passwort (Hinweis "aktualisieren?").
  Ohne Benutzernamen im Formular (z. B. zweiter Schritt einer mehrstufigen Anmeldung) zählt der gerade ausgefüllte Eintrag.
- "new": sonst (Hinweis "speichern?")
Anderer Benutzername bei gleichem Passwort zählt bewusst als neu: meist ein weiteres Konto mit demselben Passwort.
*/

export interface LoginCandidate {
    uuid: string;
    dbFileName: string;
    title: string;
    username: string;
    password: string;
}

export type SubmittedLoginMatch =
    | { kind: "known" }
    | { kind: "passwordChanged"; entry: LoginCandidate }
    | { kind: "new" };

// Benutzername und Passwort wie beim Speichern: erstes ausgefülltes Passwortfeld, erstes ausgefülltes anderes Feld
export function submittedCredentials(fields: { type: string; value: string }[]): { username: string; password: string } {
    // Manche Seiten (z. B. Banken) ersetzen das Passwort vor dem Absenden durch Sternchen: dann zählt es nicht
    const password = fields.find(f => f.type === "password" && f.value && !isMasked(f.value))?.value ?? null;
    const username = fields.find(f => f.type !== "password" && f.type !== "boolean" && f.value)?.value ?? null;
    return { username, password };
}

export function isMasked(value: string): boolean {
    return /^[*•●∙·]+$/.test(value);
}

function sameUsername(a: string, b: string): boolean {
    return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

// Getippter Benutzername passt zum Eintrag: gleich (ohne Groß-/Kleinschreibung) oder, ohne "@" getippt, gleich dem Teil
// vor dem "@" im Eintrag (Google: "max" für "max@gmail.com")
export function usernameMatches(typed: string, entryUsername: string): boolean {
    const t = (typed ?? "").trim().toLowerCase();
    const e = (entryUsername ?? "").trim().toLowerCase();
    if (!t || !e) return false;
    if (t === e) return true;
    return !t.includes("@") && e.includes("@") && e.slice(0, e.indexOf("@")) === t;
}

// Erledigt eine neue Anmeldung ein noch offenes Angebot (z. B. für ein vertipptes Passwort)? Ja auf derselben Website
// mit demselben Benutzer; fehlt der Benutzername auf einer Seite (mehrstufige Anmeldung), zählt die Website allein
export function supersedesSubmission(
    previous: { url: string; username: string },
    current: { url: string; username: string }
): boolean {
    const domain = (url: string) => FerryURL.fromString(url ?? "")?.domainOrIPAddress;
    if (!sameSite(domain(previous.url), domain(current.url))) return false;
    return !previous.username || !current.username || sameUsername(previous.username, current.username);
}

export function matchSubmittedLogin(
    fields: { type: string; value: string }[],
    entries: LoginCandidate[],
    lastFilled?: { uuid: string; dbFileName: string }
): SubmittedLoginMatch {
    const { username, password } = submittedCredentials(fields ?? []);
    if (!password && !username) return { kind: "new" };
    const known = entries.some(e => (!username || usernameMatches(username, e.username)) && (!password || e.password === password));
    if (known) return { kind: "known" };
    if (!password) return { kind: "new" };

    const isLastFilled = (e: LoginCandidate) => !!lastFilled && e.uuid === lastFilled.uuid && e.dbFileName === lastFilled.dbFileName;
    if (!username) {
        const filled = entries.find(isLastFilled);
        return filled ? { kind: "passwordChanged", entry: filled } : { kind: "new" };
    }
    // Derselbe Eintrag kann mehrfach geliefert werden (z. B. über mehrere Adressen): einmal zählen
    const sameUser: LoginCandidate[] = [];
    for (const e of entries) {
        if (!usernameMatches(username, e.username)) continue;
        if (!sameUser.some(s => s.uuid === e.uuid && s.dbFileName === e.dbFileName)) sameUser.push(e);
    }
    if (sameUser.length === 1) return { kind: "passwordChanged", entry: sameUser[0] };
    // Mehrere Einträge mit diesem Benutzernamen: nur den gerade ausgefüllten nehmen, sonst nicht raten
    const filled = sameUser.find(isLastFilled);
    return filled ? { kind: "passwordChanged", entry: filled } : { kind: "new" };
}
