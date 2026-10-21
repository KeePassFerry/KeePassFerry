// Schloss für den Zustand "gesperrt", gleich gezeichnet im Feldsymbol und im Symbol der Symbolleiste
export const LOCK_COLOR = "#c2410c";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Weißes Schloss mit Mittelpunkt (cx, cy); h = Gesamthöhe von Bügel bis Unterkante
export function drawLockGlyph(ctx: Ctx, cx: number, cy: number, h: number, holeColor: string = LOCK_COLOR) {
    const bodyW = h * 0.78;
    const bodyH = h * 0.55;
    const bodyTop = cy + h / 2 - bodyH;
    const shackleR = bodyW * 0.32;
    const shackleCy = bodyTop - h * 0.02;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, h * 0.14);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - shackleR, bodyTop + 0.5);
    ctx.lineTo(cx - shackleR, shackleCy);
    ctx.arc(cx, shackleCy, shackleR, Math.PI, 0);
    ctx.lineTo(cx + shackleR, bodyTop + 0.5);
    ctx.stroke();
    const r = h * 0.1;
    const x = cx - bodyW / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, bodyTop);
    ctx.arcTo(x + bodyW, bodyTop, x + bodyW, bodyTop + bodyH, r);
    ctx.arcTo(x + bodyW, bodyTop + bodyH, x, bodyTop + bodyH, r);
    ctx.arcTo(x, bodyTop + bodyH, x, bodyTop, r);
    ctx.arcTo(x, bodyTop, x + bodyW, bodyTop, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = holeColor;
    ctx.beginPath();
    ctx.arc(cx, bodyTop + bodyH * 0.45, Math.max(1, h * 0.08), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
