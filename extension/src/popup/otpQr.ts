import jsQR from "jsqr";
import { parseOtpauth } from "../common/otpauth";

// In Originalgröße lesen: Ein QR-Code in einem Screenshot des ganzen Bildschirms ist verkleinert oft nicht mehr lesbar
// (200 Pixel in Full-HD auf 1600 Pixel verkleinert: nicht lesbar). Die Grenze schützt nur vor extrem großen Bildern.
const MAX_DIMENSION = 4096;

// Gültige otpauth-TOTP-URI aus einem Bild mit QR-Code (Inhalt wie bei der Erkennung auf Webseiten geprüft), sonst null
export async function decodeOtpQr(file: Blob): Promise<string> {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const result = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
        return result?.data && parseOtpauth(result.data) ? result.data : null;
    } finally {
        bitmap.close();
    }
}
