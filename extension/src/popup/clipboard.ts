// Zwischenablage auf Knopfdruck lesen ("Aus Zwischenablage einfügen").
// Die Berechtigung "clipboardRead" ist optional (optional_permissions im Manifest), damit ein Update die Erweiterung
// nicht anhält. Erteilt wird sie in den Einstellungen: Die Abfrage des Browsers würde das Popup schließen.
// Ohne Erlaubnis öffnet readClipboard die Einstellungen an dieser Stelle und liefert "denied".
export type ClipboardContent = { image?: File; text?: string } | "denied" | "empty";

export async function readClipboard(): Promise<ClipboardContent> {
    let granted = false;
    try {
        granted = await chrome.permissions.contains({ permissions: ["clipboardRead"] });
    } catch (e) {
        granted = false;
    }
    if (!granted) {
        chrome.tabs.create({ url: chrome.runtime.getURL("dist/settings/index.html#clipboard") });
        return "denied";
    }

    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const type = item.types.find(t => t.startsWith("image/"));
            if (type) return { image: new File([await item.getType(type)], "image.png", { type }) };
        }
        for (const item of items) {
            if (!item.types.includes("text/plain")) continue;
            const text = (await (await item.getType("text/plain")).text()).trim();
            if (text) return { text };
        }
        return "empty";
    } catch (e) {
        // Ältere Browser oder nur Text in der Zwischenablage
        try {
            const text = (await navigator.clipboard.readText()).trim();
            return text ? { text } : "empty";
        } catch (e2) {
            return "empty";
        }
    }
}
