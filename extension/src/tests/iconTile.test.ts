import { describe, expect, it } from "vitest";
import { needsLightTile } from "../common/iconTile";

function pixels(...list: number[][]): number[] {
    return list.flat();
}
const repeat = (pixel: number[], n: number) => Array.from({ length: n }, () => pixel);

describe("needsLightTile", () => {
    it("wählt für schwarze Symbole die helle Kachel", () => {
        expect(needsLightTile(pixels(...repeat([0, 0, 0, 255], 8)))).toBe(true);
    });

    it("wählt für weiße Symbole die dunkle Kachel", () => {
        expect(needsLightTile(pixels(...repeat([255, 255, 255, 255], 8)))).toBe(false);
    });

    it("wählt für das grüne Kleinanzeigen-Logo die dunkle Kachel", () => {
        expect(needsLightTile(pixels(...repeat([134, 184, 23, 255], 8)))).toBe(false);
    });

    it("wählt für den gelben Schlüssel die dunkle Kachel", () => {
        expect(needsLightTile(pixels(...repeat([234, 179, 8, 255], 8)))).toBe(false);
    });

    it("wählt für dunkelblaue Symbole die helle Kachel", () => {
        expect(needsLightTile(pixels(...repeat([18, 57, 95, 255], 8)))).toBe(true);
    });

    it("zählt transparente Pixel nicht mit", () => {
        const blackOnTransparent = pixels(...repeat([255, 255, 255, 0], 50), ...repeat([0, 0, 0, 255], 5));
        expect(needsLightTile(blackOnTransparent)).toBe(true);
    });

    it("bleibt bei ganz transparenten Bildern dunkel", () => {
        expect(needsLightTile(pixels(...repeat([0, 0, 0, 0], 8)))).toBe(false);
        expect(needsLightTile([])).toBe(false);
    });
});
