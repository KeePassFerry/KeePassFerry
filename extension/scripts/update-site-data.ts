// Holt Passwortregeln und Passwort-ändern-Adressen aus Apples "Password Manager Resources" (MIT-Lizenz,
// https://github.com/apple/password-manager-resources) von einem festen Commit und schreibt sie kompakt nach
// src/common/siteData/appleQuirks.json. Neuer Stand: Commit unten anpassen, Skript ausführen, Diff prüfen.
// Aufruf: npx esno scripts/update-site-data.ts [<commit>]
import fs from "fs";
import path from "path";

const COMMIT = process.argv[2] ?? "ab0a64ee50eaa78a4ea7c86a291594860f26d18f";
const BASE = `https://raw.githubusercontent.com/apple/password-manager-resources/${COMMIT}/quirks/`;
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../src/common/siteData/appleQuirks.json");

async function load(name: string): Promise<any> {
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(name + ": HTTP " + res.status);
    return res.json();
}

function sorted<T>(o: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
    const rules = await load("password-rules.json");
    const urls = await load("change-password-URLs.json");

    const passwordRules: Record<string, string> = {};
    for (const [domain, v] of Object.entries<any>(rules)) {
        const r = typeof v?.["password-rules"] === "string" ? v["password-rules"].trim() : "";
        if (r) passwordRules[domain.toLowerCase()] = r;
    }
    const changePasswordUrls: Record<string, string> = {};
    for (const [domain, url] of Object.entries<any>(urls)) {
        // Nur https-Adressen auf derselben Domain oder einer Subdomain davon
        if (typeof url !== "string" || !url.startsWith("https://")) continue;
        const host = new URL(url).hostname.toLowerCase();
        const d = domain.toLowerCase();
        if (host !== d && !host.endsWith("." + d)) continue;
        changePasswordUrls[d] = url;
    }

    const data = {
        source: "https://github.com/apple/password-manager-resources",
        commit: COMMIT,
        license: "MIT, Copyright (c) Apple Inc.",
        passwordRules: sorted(passwordRules),
        changePasswordUrls: sorted(changePasswordUrls)
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
    console.log(
        `Passwortregeln: ${Object.keys(passwordRules).length}, Passwort-ändern-Adressen: ${Object.keys(changePasswordUrls).length}` +
            ` (verworfen: ${Object.keys(urls).length - Object.keys(changePasswordUrls).length})`
    );
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
