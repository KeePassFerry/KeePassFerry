// true für Adressen, die eine Website sind. KeePass-Einträge können auch Dateipfade oder cmd://-Befehle enthalten.
export function isWebUrl(url: string): boolean {
    return /^https?:\/\//i.test((url ?? "").trim());
}
