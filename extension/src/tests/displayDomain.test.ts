import { describe, expect, it, vi } from "vitest";

const config = { ferryUnicodeDomains: false };
vi.mock("../common/ConfigManager", () => ({ configManager: { current: config } }));

const { displayDomains, punycodeHint } = await import("../common/displayDomain");

describe("Internationale Domains anzeigen (#33)", () => {
    it("lässt Punycode stehen, solange die Option aus ist", () => {
        config.ferryUnicodeDomains = false;
        expect(displayDomains("xn--e1afmkfd.xn--p1ai")).toBe("xn--e1afmkfd.xn--p1ai");
        expect(punycodeHint("xn--e1afmkfd.xn--p1ai")).toBe("");
    });

    it("zeigt Unicode und nennt die echte Schreibweise, wenn die Option an ist", () => {
        config.ferryUnicodeDomains = true;
        expect(displayDomains("xn--e1afmkfd.xn--p1ai")).toBe("пример.рф");
        expect(displayDomains("Login – www.xn--e1afmkfd.xn--p1ai")).toBe("Login – www.пример.рф");
        expect(punycodeHint("xn--e1afmkfd.xn--p1ai")).toBe("xn--e1afmkfd.xn--p1ai");
    });

    it("ändert normale Adressen und Titel nicht", () => {
        config.ferryUnicodeDomains = true;
        expect(displayDomains("github.com")).toBe("github.com");
        expect(punycodeHint("GitHub")).toBe("");
    });
});
