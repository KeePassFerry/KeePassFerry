// Website-Symbol eines Tabs als PNG (Base64 ohne Präfix) für KeePass, ohne Popup; null, wenn es nicht geht
const MAX_SIZE = 64;

function scaled(width: number, height: number) {
    const factor = Math.min(1, MAX_SIZE / Math.max(width, height, 1));
    return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

async function viaImageElement(url: string): Promise<string> {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("favicon not loadable"));
        img.src = url;
    });
    const size = scaled(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d").drawImage(img, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/png").substring("data:image/png;base64,".length);
}

// Service Worker (Chrome): kein Image-Element; SVG kann createImageBitmap dort nicht lesen
async function viaImageBitmap(url: string): Promise<string> {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const size = scaled(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const png = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export async function tabFaviconPng(favIconUrl: string): Promise<string> {
    if (!favIconUrl) return null;
    try {
        if (typeof Image === "function" && typeof document !== "undefined") return await viaImageElement(favIconUrl);
        return await viaImageBitmap(favIconUrl);
    } catch (e) {
        return null;
    }
}
