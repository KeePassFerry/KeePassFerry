import { describe, expect, it } from "vitest";
import { httpsEntryOnHttpPage } from "../common/insecurePage";

describe("httpsEntryOnHttpPage", () => {
    it("blockiert https-Eintrag auf http-Seite", () => {
        expect(httpsEntryOnHttpPage("http://bank.example/login", ["https://bank.example/"])).toBe(true);
    });
    it("erlaubt https-Seite", () => {
        expect(httpsEntryOnHttpPage("https://bank.example/login", ["https://bank.example/"])).toBe(false);
    });
    it("erlaubt Eintrag, der auch für http gespeichert ist", () => {
        expect(httpsEntryOnHttpPage("http://router.local/", ["https://router.local/", "http://router.local/"])).toBe(false);
    });
    it("erlaubt Eintrag ohne Schema oder ohne URL", () => {
        expect(httpsEntryOnHttpPage("http://router.local/", ["router.local"])).toBe(false);
        expect(httpsEntryOnHttpPage("http://router.local/", [])).toBe(false);
    });
});
