// Zwischenablage auf Knopfdruck lesen ("Aus Zwischenablage einfügen").
// Die Berechtigung "clipboardRead" ist optional (optional_permissions im Manifest): Der Browser fragt beim ersten Mal
// nach, ein Update der Erweiterung wird dadurch nicht angehalten. Ohne Zustimmung liefert die Funktion "denied".
// Muss direkt aus dem Klick heraus aufgerufen werden (chrome.permissions.request verlangt eine Nutzeraktion).
export type ClipboardContent = { image?: File; text?: string } | "denied" | "empty";

export async function readClipboard(): Promise<ClipboardContent> {
    let granted = false;
    try {
        granted = await chrome.permissions.request({ permissions: ["clipboardRead"] });
    } catch (e) {
        granted = false;
    }
    if (!granted) return "denied";

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
