// Name des Browsers für Texte und den Kopplungsnamen in KeePass; null, wenn er sich nicht sicher erkennen lässt
// (dann eine allgemeine Formulierung). Chromium-Ableger melden sich über userAgentData.brands, ältere über den User-Agent.
export function browserName(): string | null {
    const nav = navigator as any;
    const brands: string[] = (nav.userAgentData?.brands ?? []).map((b: { brand: string }) => b.brand);
    const ua = navigator.userAgent ?? "";
    if (brands.includes("Microsoft Edge") || / Edg\//.test(ua)) return "Edge";
    if (brands.includes("Opera") || / OPR\//.test(ua)) return "Opera";
    if (brands.includes("Brave") || nav.brave) return "Brave";
    if (brands.includes("Vivaldi") || / Vivaldi\//.test(ua)) return "Vivaldi";
    if (/ Firefox\//.test(ua)) return "Firefox";
    if (brands.includes("Google Chrome")) return "Chrome";
    return null;
}
