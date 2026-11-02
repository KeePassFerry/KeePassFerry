/*
whatsNew.ts: Neuerungen je Version für die Ansicht "Neuigkeiten und Tipps" im Popup (neueste Version aufgeklappt,
frühere zugeklappt) und den einmaligen Hinweis nach einem Update.
Pro Release 2–5 Punkte in Alltagssprache (Texte in _locales, Schlüssel ferry_news_<version>_<n>_title/_text);
die vollständige Liste steht im CHANGELOG. Ohne Eintrag für die installierte Version erscheint kein Hinweis.
*/

export type NewsIcon = "shield-check" | "wand" | "key" | "sparkles" | "trash" | "lock" | "text-plus" | "refresh" | "shield-lock" | "fingerprint" | "clock" | "database";

export interface NewsItem {
    icon: NewsIcon;
    // Schlüssel ohne _title/_text
    key: string;
}

// Neueste Version zuerst
export const WHATS_NEW: { version: string; items: NewsItem[] }[] = [
    {
        version: "1.0.15",
        items: [
            { icon: "shield-check", key: "ferry_news_1_0_15_1" },
            { icon: "clock", key: "ferry_news_1_0_15_4" },
            { icon: "wand", key: "ferry_news_1_0_15_2" },
            { icon: "database", key: "ferry_news_1_0_15_5" },
            { icon: "key", key: "ferry_news_1_0_15_3" }
        ]
    },
    {
        version: "1.0.14",
        items: [
            { icon: "trash", key: "ferry_news_1_0_14_1" },
            { icon: "fingerprint", key: "ferry_news_1_0_14_2" },
            { icon: "lock", key: "ferry_news_1_0_14_3" }
        ]
    },
    {
        version: "1.0.13",
        items: [
            { icon: "text-plus", key: "ferry_news_1_0_13_1" },
            { icon: "refresh", key: "ferry_news_1_0_13_2" },
            { icon: "shield-lock", key: "ferry_news_1_0_13_3" }
        ]
    }
];

export const NEWS_SEEN_KEY = "ferryNewsSeen";

export function currentVersion(): string {
    return chrome.runtime.getManifest().version;
}

export function newsFor(version: string): NewsItem[] {
    return WHATS_NEW.find(v => v.version === version)?.items ?? null;
}

// Neuigkeiten der installierten Version, solange sie noch nicht angesehen oder ausgeblendet wurden
export async function unseenNews(): Promise<{ version: string; items: NewsItem[] }> {
    const version = currentVersion();
    const items = newsFor(version);
    if (!items?.length) return null;
    try {
        const r = await chrome.storage.local.get(NEWS_SEEN_KEY);
        if (r?.[NEWS_SEEN_KEY] === version) return null;
    } catch (e) {
        return null;
    }
    return { version, items };
}

export async function markNewsSeen() {
    try {
        await chrome.storage.local.set({ [NEWS_SEEN_KEY]: currentVersion() });
    } catch (e) {
        // ohne Merken
    }
}
