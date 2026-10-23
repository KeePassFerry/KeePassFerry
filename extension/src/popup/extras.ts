// Anhänge und Werte eigener Felder eines Eintrags: erst auf Klick laden (Vorschau, Speichern unter, Auge)
const MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    pdf: "application/pdf",
    txt: "text/plain"
};

function extensionOf(name: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(name ?? "");
    return m ? m[1].toLowerCase() : "";
}

export function mimeFor(name: string): string {
    return MIME[extensionOf(name)] ?? "application/octet-stream";
}

export function isImageName(name: string): boolean {
    return mimeFor(name).startsWith("image/");
}

export function blobFromBase64(base64: string, type: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
}

// null: nicht gefunden oder Plugin vor 1.0.7 (kennt GetEntryAttachment nicht)
export async function loadAttachment(uuid: string, dbFileName: string, name: string): Promise<Blob> {
    const base64: string = await chrome.runtime
        .sendMessage({ keepassferry: "getEntryAttachment", uuid, dbFileName, name })
        .catch(() => null);
    return base64 ? blobFromBase64(base64, mimeFor(name)) : null;
}

export async function loadFieldValue(uuid: string, dbFileName: string, name: string): Promise<string> {
    return chrome.runtime.sendMessage({ keepassferry: "getEntryFieldValue", uuid, dbFileName, name }).catch(() => null);
}

// "Speichern unter": Download über einen Link, der Browser fragt nach dem Ort (bzw. nutzt den Download-Ordner)
export function saveBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "anhang";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
}
