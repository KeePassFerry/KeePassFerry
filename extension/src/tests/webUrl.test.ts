import { describe, expect, it } from "vitest";
import { isWebUrl } from "../common/webUrl";

describe("isWebUrl", () => {
    it("accepts http and https in any case", () => {
        expect(isWebUrl("https://example.com/login")).toBe(true);
        expect(isWebUrl("http://127.0.0.1:8080/")).toBe(true);
        expect(isWebUrl("  HTTPS://example.com")).toBe(true);
    });

    it("rejects file paths, commands and empty values", () => {
        expect(isWebUrl("%APPDATA%\\KeeLiveSync\\cache\\shared.kdbx")).toBe(false);
        expect(isWebUrl("C:\\Daten\\shared.kdbx")).toBe(false);
        expect(isWebUrl("cmd://calc.exe")).toBe(false);
        expect(isWebUrl("file:///C:/shared.kdbx")).toBe(false);
        expect(isWebUrl("example.com")).toBe(false);
        expect(isWebUrl("")).toBe(false);
        expect(isWebUrl(null)).toBe(false);
    });
});
