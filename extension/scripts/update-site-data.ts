// Holt Passwortregeln, Passwort-ändern-Adressen und Gruppen zusammengehöriger Domains aus Apples "Password Manager
// Resources" (MIT-Lizenz, https://github.com/apple/password-manager-resources) und schreibt sie kompakt nach
// src/common/siteData/appleQuirks.json. Ohne Angabe wird der neueste Commit von main verwendet und vermerkt.
// Aufruf: npx esno scripts/update-site-data.ts [<commit>]   (danach Diff prüfen)
import fs from "fs";
import path from "path";
import punycode from "punycode/punycode.js";
import publicSuffixList from "@gorhill/publicsuffixlist";

const REPO = "apple/password-manager-resources";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = path.resolve(HERE, "../src/common/siteData/appleQuirks.json");
const PSL = path.resolve(HERE, "../src/common/siteData/public_suffix_list.dat");

async function latestCommit(): Promise<string> {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) throw new Error("Neuester Commit: HTTP " + res.status);
    const sha = (await res.json())?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("Neuester Commit: keine gültige SHA");
    return sha;
}

async function load(commit: string, name: string): Promise<any> {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/quirks/${name}`);
    if (!res.ok) throw new Error(name + ": HTTP " + res.status);
    return res.json();
}

function sorted<T>(o: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
    const commit = process.argv[2] ?? (await latestCommit());
    const rules = await load(commit, "password-rules.json");
    const urls = await load(commit, "change-password-URLs.json");
    const shared = [
        ...(await load(commit, "shared-credentials.json")),
        ...(await load(commit, "shared-credentials-historical.json"))
    ];

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

    // Zusammengehörige Domains: "shared" als Gruppe, "from"/"to" (umgezogene Domains) ebenfalls als Gruppe.
    // Nur registrierbare Domains laut Public Suffix List (keine Endungen wie "co.uk", keine Subdomains)
    publicSuffixList.parse(fs.readFileSync(PSL, "utf8"), punycode.toASCII);
    let dropped = 0;
    const groups: string[][] = [];
    for (const e of shared) {
        const raw: string[] = [...(e.shared ?? []), ...(e.from ?? []), ...(e.to ?? [])];
        const group = [...new Set(raw.map(d => String(d).toLowerCase()))].filter(d => {
            const ok = publicSuffixList.getDomain(d) === d;
            if (!ok) dropped++;
            return ok;
        });
        if (group.length > 1) groups.push(group.sort());
    }
    groups.sort((a, b) => a[0].localeCompare(b[0]));

    const data = {
        source: "https://github.com/" + REPO,
        commit,
        license: "MIT, Copyright (c) Apple Inc.",
        passwordRules: sorted(passwordRules),
        changePasswordUrls: sorted(changePasswordUrls),
        sharedCredentials: groups
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
    console.log(
        `Commit ${commit}: Passwortregeln ${Object.keys(passwordRules).length}, Passwort-ändern-Adressen ` +
            `${Object.keys(changePasswordUrls).length} (verworfen: ${Object.keys(urls).length - Object.keys(changePasswordUrls).length}), ` +
            `Domain-Gruppen ${groups.length} (verworfene Domains: ${dropped})`
    );
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
