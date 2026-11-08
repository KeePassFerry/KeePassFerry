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
        version: "1.0.28",
        items: [
            { icon: "sparkles", key: "ferry_news_1_0_28_1" }
        ]
    },
    {
        version: "1.0.27",
        items: [
            { icon: "sparkles", key: "ferry_news_1_0_27_1" }
        ]
    },
    {
        version: "1.0.26",
        items: [
            { icon: "sparkles", key: "ferry_news_1_0_26_1" }
        ]
    },
    {
        version: "1.0.25",
        items: [
            { icon: "text-plus", key: "ferry_news_1_0_25_1" },
            { icon: "sparkles", key: "ferry_news_1_0_25_2" }
        ]
    },
    {
        version: "1.0.24",
        items: [
            { icon: "text-plus", key: "ferry_news_1_0_24_1" },
            { icon: "shield-check", key: "ferry_news_1_0_24_2" }
        ]
    },
    {
        version: "1.0.22",
        items: [
            { icon: "text-plus", key: "ferry_news_1_0_22_1" },
            { icon: "key", key: "ferry_news_1_0_22_2" },
            { icon: "database", key: "ferry_news_1_0_22_3" }
        ]
    },
    {
        version: "1.0.21",
        items: [
            { icon: "text-plus", key: "ferry_news_1_0_21_1" },
            { icon: "key", key: "ferry_news_1_0_21_2" }
        ]
    },
    {
        version: "1.0.20",
        items: [
            { icon: "wand", key: "ferry_news_1_0_20_1" },
            { icon: "clock", key: "ferry_news_1_0_20_2" },
            { icon: "shield-check", key: "ferry_news_1_0_20_3" }
        ]
    },
    {
        version: "1.0.19",
        items: [
            { icon: "key", key: "ferry_news_1_0_19_1" },
            { icon: "database", key: "ferry_news_1_0_19_2" },
            { icon: "lock", key: "ferry_news_1_0_19_3" }
        ]
    },
    {
        version: "1.0.18",
        items: [
            { icon: "clock", key: "ferry_news_1_0_18_1" },
            { icon: "wand", key: "ferry_news_1_0_18_2" },
            { icon: "sparkles", key: "ferry_news_1_0_18_3" }
        ]
    },
    {
        version: "1.0.17",
        items: [
            { icon: "database", key: "ferry_news_1_0_17_1" },
            { icon: "wand", key: "ferry_news_1_0_17_2" },
            { icon: "key", key: "ferry_news_1_0_17_3" }
        ]
    },
    {
        version: "1.0.16",
        items: [
            { icon: "refresh", key: "ferry_news_1_0_16_1" },
            { icon: "key", key: "ferry_news_1_0_16_2" }
        ]
    },
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
