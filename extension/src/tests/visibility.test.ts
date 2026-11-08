import { beforeAll, describe, expect, test } from "vitest";
import { isOffPage } from "../page/visibility";

// Tests laufen ohne Browser: Seite nicht gescrollt
beforeAll(() => {
    (globalThis as any).window ??= { scrollX: 0, scrollY: 0 };
});

// Element mit festem Rahmen (getBoundingClientRect), Seite nicht gescrollt
function at(left: number, top: number, width: number, height: number): Element {
    return {
        getBoundingClientRect: () =>
            ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect
    } as unknown as Element;
}

describe("isOffPage", () => {
    test("left: -9999px (Zalando) gilt als außerhalb", () => {
        expect(isOffPage(at(-9997, -9740, 24, 44))).toBe(true);
    });
    test("nur nach links verschoben gilt als außerhalb", () => {
        expect(isOffPage(at(-9999, 200, 300, 44))).toBe(true);
    });
    test("sichtbares Feld ist nicht außerhalb", () => {
        expect(isOffPage(at(748, 207, 416, 44))).toBe(false);
    });
    test("weiter unten (scrollbar) ist nicht außerhalb", () => {
        expect(isOffPage(at(100, 5000, 300, 44))).toBe(false);
    });
    test("teilweise links angeschnitten ist nicht außerhalb", () => {
        expect(isOffPage(at(-100, 200, 300, 44))).toBe(false);
    });
});
