/*
iconTile.ts: Kachel hinter einem Eintragssymbol im dunklen Design. Symbole haben oft einen transparenten Hintergrund: Schwarze
wären auf der dunklen Kachel kaum sichtbar, grüne oder weiße auf einer hellen. Gemessen wird die mittlere Helligkeit der
deckenden Pixel; gewählt wird die Kachel mit dem höheren Kontrast (WCAG). Das Symbol selbst bleibt unverändert.
*/

const DARK_TILE_LUMINANCE = 0.02; // #24272e
const LIGHT_TILE_LUMINANCE = 0.82; // #e8eaed
const SAMPLE_SIZE = 32;

function channel(value: number): number {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function needsLightTile(rgba: ArrayLike<number>): boolean {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + 3 < rgba.length; i += 4) {
        if (rgba[i + 3] < 128) continue;
        sum += 0.2126 * channel(rgba[i]) + 0.7152 * channel(rgba[i + 1]) + 0.0722 * channel(rgba[i + 2]);
        count++;
    }
    if (count === 0) return false;
    const luminance = sum / count;
    const onDark = (luminance + 0.05) / (DARK_TILE_LUMINANCE + 0.05);
    const onLight = (LIGHT_TILE_LUMINANCE + 0.05) / (luminance + 0.05);
    return onLight > onDark;
}

const cache = new Map<string, Promise<boolean>>();

export function iconNeedsLightTile(dataUrl: string): Promise<boolean> {
    if (!dataUrl) return Promise.resolve(false);
    let result = cache.get(dataUrl);
    if (!result) {
        result = new Promise<boolean>(resolve => {
            const image = new Image();
            image.onerror = () => resolve(false);
            image.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = canvas.height = SAMPLE_SIZE;
                    const context = canvas.getContext("2d", { willReadFrequently: true });
                    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                    resolve(needsLightTile(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
                } catch (e) {
                    resolve(false);
                }
            };
            image.src = dataUrl;
        });
        cache.set(dataUrl, result);
    }
    return result;
}
