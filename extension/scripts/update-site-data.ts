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

    // Zusammengehörige Domains laut Public Suffix List; öffentliche Endungen wie "co.uk" fallen weg.
    // "shared" als Gruppe, nur mit registrierbaren Domains: Hosts wie kcls.overdrive.com sind Mandanten einer Plattform,
    // über deren Domain würden sich fremde Konten mischen.
    // "from"/"to" als Einweg-Eintrag (Einträge von "from" werden auf "to" angeboten, nicht umgekehrt); Hosts wie
    // id.atlassian.com werden zur registrierbaren Domain.
    publicSuffixList.parse(fs.readFileSync(PSL, "utf8"), punycode.toASCII);
    let dropped = 0;
    const domains = (list: string[] = []): string[] => {
        const result = new Set<string>();
        for (const d of list) {
            const domain = publicSuffixList.getDomain(String(d).toLowerCase());
            if (domain) result.add(domain);
            else dropped++;
        }
        return [...result].sort();
    };
    const groups: string[][] = [];
    const oneWay: { from: string[]; to: string[] }[] = [];
    for (const e of shared) {
        if (e.shared) {
            const group = [...new Set<string>(e.shared.map((d: unknown) => String(d).toLowerCase()))].filter(d => {
                const ok = publicSuffixList.getDomain(d) === d;
                if (!ok) dropped++;
                return ok;
            });
            if (group.length > 1) groups.push(group.sort());
        } else {
            const to = domains(e.to);
            const from = domains(e.from).filter(d => !to.includes(d));
            if (from.length > 0 && to.length > 0) oneWay.push({ from, to });
        }
    }
    groups.sort((a, b) => a[0].localeCompare(b[0]));
    oneWay.sort((a, b) => a.from[0].localeCompare(b.from[0]));

    const data = {
        source: "https://github.com/" + REPO,
        commit,
        license: "MIT, Copyright (c) Apple Inc.",
        passwordRules: sorted(passwordRules),
        changePasswordUrls: sorted(changePasswordUrls),
        sharedCredentials: groups,
        oneWayCredentials: oneWay
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
    console.log(
        `Commit ${commit}: Passwortregeln ${Object.keys(passwordRules).length}, Passwort-ändern-Adressen ` +
            `${Object.keys(changePasswordUrls).length} (verworfen: ${Object.keys(urls).length - Object.keys(changePasswordUrls).length}), ` +
            `Domain-Gruppen ${groups.length}, Einweg-Einträge ${oneWay.length} (verworfene Domains: ${dropped})`
    );
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
