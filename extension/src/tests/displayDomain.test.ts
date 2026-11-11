import { describe, expect, it, vi } from "vitest";

const config = { ferryUnicodeDomains: false };
vi.mock("../common/ConfigManager", () => ({ configManager: { current: config } }));

const { displayDomains, displayUrl } = await import("../common/displayDomain");

describe("Internationale Domains anzeigen (#33)", () => {
    it("lässt Punycode stehen, solange die Option aus ist", () => {
        config.ferryUnicodeDomains = false;
        expect(displayDomains("xn--e1afmkfd.xn--p1ai")).toBe("xn--e1afmkfd.xn--p1ai");
    });

    it("zeigt Unicode, wenn die Option an ist", () => {
        config.ferryUnicodeDomains = true;
        expect(displayDomains("xn--e1afmkfd.xn--p1ai")).toBe("пример.рф");
        expect(displayDomains("Login – www.xn--e1afmkfd.xn--p1ai")).toBe("Login – www.пример.рф");
    });

    it("ändert normale Adressen und Titel nicht", () => {
        config.ferryUnicodeDomains = true;
        expect(displayDomains("github.com")).toBe("github.com");
        expect(displayDomains("GitHub")).toBe("GitHub");
    });
});

describe("Adresse im Tooltip des Knopfs Website (#33)", () => {
    it("zeigt Domain und Pfad ohne https://", () => {
        config.ferryUnicodeDomains = false;
        expect(displayUrl("https://example.com/")).toBe("example.com");
        expect(displayUrl("https://example.com/login/konto")).toBe("example.com/login/konto");
        expect(displayUrl("https://xn--e1afmkfd.xn--p1ai/login/konto")).toBe("xn--e1afmkfd.xn--p1ai/login/konto");
    });

    it("zeigt http:// und den Port, weil beides die Ausnahme ist", () => {
        config.ferryUnicodeDomains = false;
        expect(displayUrl("http://192.168.1.1:8080/admin")).toBe("http://192.168.1.1:8080/admin");
    });

    it("deutet Parameter nur an", () => {
        config.ferryUnicodeDomains = false;
        expect(displayUrl("https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=13&ct=1571289396&rver=7.0.6737.0")).toBe("login.live.com/login.srf?…");
        expect(displayUrl("https://example.com/app#/konto")).toBe("example.com/app#…");
    });

    it("kürzt lange Pfade, die Domain nie", () => {
        config.ferryUnicodeDomains = false;
        const shown = displayUrl("https://sehr-lange-subdomain.beispiel-mit-langem-namen.example.com/" + "a".repeat(200));
        expect(shown.startsWith("sehr-lange-subdomain.beispiel-mit-langem-namen.example.com/")).toBe(true);
        expect(shown.endsWith("…")).toBe(true);
        expect(shown.length).toBe("sehr-lange-subdomain.beispiel-mit-langem-namen.example.com".length + 61);
    });

    it("zeigt bei eingeschalteter Option Domain und Pfad lesbar, ohne Punycode", () => {
        config.ferryUnicodeDomains = true;
        expect(displayUrl("https://xn--e1afmkfd.xn--p1ai/login/konto")).toBe("пример.рф/login/konto");
        expect(displayUrl("https://xn--e1afmkfd.xn--p1ai/%D0%B2%D1%85%D0%BE%D0%B4")).toBe("пример.рф/вход");
    });

    it("kommt mit Adressen ohne Schema und leeren Werten zurecht", () => {
        config.ferryUnicodeDomains = false;
        expect(displayUrl("")).toBe("");
        expect(displayUrl("example.com/login")).toBe("example.com/login");
    });
});
