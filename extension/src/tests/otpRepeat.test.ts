import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetAutoFill, isRepeatedAutoFill, rememberAutoFill } from "../background/otpRepeat";

// Seite sendet bei 6 Ziffern selbst ab und lädt nach "ungültig" neu: derselbe Code nicht noch einmal von selbst
describe("otpRepeat", () => {
    afterEach(() => {
        vi.useRealTimers();
        forgetAutoFill(1);
        forgetAutoFill(2);
    });

    it("erkennt denselben Code im selben Tab und auf derselben Domain", async () => {
        await rememberAutoFill(1, "mailferry.de", "123456");
        expect(await isRepeatedAutoFill(1, "mailferry.de", "123456")).toBe(true);
    });

    it("lässt einen neuen Code, eine andere Domain und einen anderen Tab durch", async () => {
        await rememberAutoFill(1, "mailferry.de", "123456");
        expect(await isRepeatedAutoFill(1, "mailferry.de", "654321")).toBe(false);
        expect(await isRepeatedAutoFill(1, "example.com", "123456")).toBe(false);
        expect(await isRepeatedAutoFill(2, "mailferry.de", "123456")).toBe(false);
    });

    it("gilt nur kurz (ein Code ist höchstens einen Zeitschritt gültig)", async () => {
        vi.useFakeTimers();
        await rememberAutoFill(1, "mailferry.de", "123456");
        vi.advanceTimersByTime(91 * 1000);
        expect(await isRepeatedAutoFill(1, "mailferry.de", "123456")).toBe(false);
    });

    it("vergisst den Tab beim Schließen", async () => {
        await rememberAutoFill(1, "mailferry.de", "123456");
        forgetAutoFill(1);
        expect(await isRepeatedAutoFill(1, "mailferry.de", "123456")).toBe(false);
    });
});
