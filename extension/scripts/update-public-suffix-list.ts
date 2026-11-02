// Holt die Public Suffix List von Mozilla (https://publicsuffix.org, MPL-2.0) und speichert sie unverändert nach
// src/common/siteData/public_suffix_list.dat. KeePassFerry erkennt damit, welche Adressen zur selben Website gehören
// (login.amazon.co.uk ↔ amazon.co.uk, aber max.github.io ≠ anna.github.io).
// Neuer Stand: Skript ausführen, Diff prüfen, committen. Aufruf: npx esno scripts/update-public-suffix-list.ts
import fs from "fs";
import path from "path";

// Laut publicsuffix.org nur von dieser Adresse laden
const SOURCE = "https://publicsuffix.org/list/public_suffix_list.dat";
const OUT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
    "../src/common/siteData/public_suffix_list.dat"
);

async function main() {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = (await res.text()).replace(/\r\n/g, "\n");
    // Plausibilität: beide Abschnitte vorhanden und genug Regeln (sonst lieber den alten Stand behalten)
    const rules = text.split("\n").filter(l => l.trim() && !l.startsWith("//")).length;
    if (!text.includes("===BEGIN ICANN DOMAINS===") || !text.includes("===BEGIN PRIVATE DOMAINS===") || rules < 5000) {
        throw new Error(`Liste sieht unvollständig aus (${rules} Regeln) – nichts geschrieben`);
    }
    const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text.endsWith("\n") ? text : text + "\n");
    const version = (text.match(/^\/\/ VERSION: (.+)$/m) ?? [])[1] ?? "unbekannt";
    const oldRules = old ? old.split("\n").filter(l => l.trim() && !l.startsWith("//")).length : 0;
    console.log(`Public Suffix List ${version}: ${rules} Regeln (vorher ${oldRules})${old === text ? " – unverändert" : ""}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
