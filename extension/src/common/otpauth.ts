// Prüft eine otpauth-URI (nur TOTP mit Base32-Secret) und liest Aussteller und Konto aus
export function parseOtpauth(uri: string): { issuer: string; account: string } {
    if (!/^otpauth:\/\/totp\//i.test(uri)) return null;
    try {
        const u = new URL(uri);
        const secret = (u.searchParams.get("secret") ?? "").replace(/\s/g, "");
        if (secret.length < 16 || !/^[A-Z2-7]+=*$/i.test(secret)) return null;
        const label = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
        let issuer = u.searchParams.get("issuer") ?? "";
        let account = label;
        const colon = label.indexOf(":");
        if (colon >= 0) {
            if (!issuer) issuer = label.slice(0, colon);
            account = label.slice(colon + 1);
        } else if (issuer && label === issuer) {
            // Nur Aussteller im Label (z. B. aus einem Schlüssel als Text): kein Kontoname bekannt
            account = "";
        }
        return { issuer: issuer.trim(), account: account.trim() };
    } catch (e) {
        return null;
    }
}
