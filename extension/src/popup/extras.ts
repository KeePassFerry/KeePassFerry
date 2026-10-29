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

// Bilder, PDF und Text öffnet das Plugin im Standardprogramm (andere Typen könnte Windows ausführen)
export function canOpenExternally(name: string): boolean {
    return mimeFor(name) !== "application/octet-stream";
}

// Über KeePass im Standardprogramm von Windows öffnen; false bei Plugin vor 1.0.7 oder Fehler
export async function openAttachmentExternally(uuid: string, dbFileName: string, name: string): Promise<boolean> {
    return !!(await chrome.runtime
        .sendMessage({ keepassferry: "openEntryAttachmentExternally", uuid, dbFileName, name })
        .catch(() => false));
}

// Notizen als Textdatei im Standard-Editor; Dateiname "<Titel> – Notizen"
export async function openNotesExternally(uuid: string, dbFileName: string, title: string): Promise<boolean> {
    const fileName = title ? chrome.i18n.getMessage("ferry_notes_file_name", [title]) : chrome.i18n.getMessage("ferry_extras_notes");
    return !!(await chrome.runtime
        .sendMessage({ keepassferry: "openEntryNotesExternally", uuid, dbFileName, fileName })
        .catch(() => false));
}

export async function loadFieldValue(uuid: string, dbFileName: string, name: string): Promise<string> {
    return chrome.runtime.sendMessage({ keepassferry: "getEntryFieldValue", uuid, dbFileName, name }).catch(() => null);
}

// Stift in der Vorschau des aufgeklappten Eintrags: das Bearbeiten-Fenster öffnet diesen Zusatz gleich zum Bearbeiten.
// key wie in EntryAddition ("notes" bzw. "f:<Feldname>"); gilt nur innerhalb des geöffneten Popups.
// Verfällt nach kurzer Zeit, damit ein späteres normales Bearbeiten nicht unerwartet ein Feld öffnet.
// Nach dem ersten Lesen bleibt der Wunsch noch kurz gültig, falls das Bearbeiten-Fenster neu aufgebaut wird.
let pendingExtraEdit: { uuid: string; key: string; at: number; takenAt?: number } = null;
const PENDING_EDIT_MS = 10000;
const REMOUNT_GRACE_MS = 3000;

export function requestExtraEdit(uuid: string, key: string) {
    pendingExtraEdit = { uuid, key, at: Date.now() };
}

export function takeExtraEdit(uuid: string): string {
    const p = pendingExtraEdit;
    const now = Date.now();
    if (!p || p.uuid !== uuid || now - p.at > PENDING_EDIT_MS || (p.takenAt && now - p.takenAt > REMOUNT_GRACE_MS)) {
        pendingExtraEdit = null;
        return null;
    }
    p.takenAt ??= now;
    return p.key;
}

// Kontextmenü "„…“ zu Eintrag hinzufügen": das Bearbeiten-Fenster öffnet "Hinzufügen" mit diesem Text als Inhalt.
// Gleiche Gültigkeitsregeln wie oben; gilt nur innerhalb des geöffneten Popups.
let pendingAddition: { uuid: string; text: string; at: number; takenAt?: number } = null;

export function requestAddition(uuid: string, text: string) {
    pendingAddition = { uuid, text, at: Date.now() };
}

export function takeAddition(uuid: string): string {
    const p = pendingAddition;
    const now = Date.now();
    if (!p || p.uuid !== uuid || now - p.at > PENDING_EDIT_MS || (p.takenAt && now - p.takenAt > REMOUNT_GRACE_MS)) {
        pendingAddition = null;
        return null;
    }
    p.takenAt ??= now;
    return p.text;
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
