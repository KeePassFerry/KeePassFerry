import { describe, expect, it } from "vitest";
import { hostInDomains, relatedDomains } from "../common/relatedDomains";

describe("relatedDomains", () => {
    it("findet die anderen Domains der Gruppe", () => {
        const r = relatedDomains("live.com");
        expect(r).toContain("outlook.com");
        expect(r).toContain("microsoftonline.com");
        expect(r).not.toContain("live.com");
    });

    it("kennt Länder-Shops und ignoriert Groß-/Kleinschreibung", () => {
        expect(relatedDomains("Amazon.DE")).toContain("amazon.com");
        expect(relatedDomains("amazon.co.uk")).toContain("amazon.de");
    });

    it("liefert nichts für Domains ohne Gruppe", () => {
        expect(relatedDomains("example.com")).toEqual([]);
        expect(relatedDomains("")).toEqual([]);
        expect(relatedDomains(null)).toEqual([]);
    });

    it("mischt keine Anbieter", () => {
        expect(relatedDomains("google.com")).not.toContain("outlook.com");
        expect(relatedDomains("apple.com")).toEqual(["icloud.com"]);
    });
});

describe("hostInDomains", () => {
    it("erkennt Domain und Subdomains, aber keine ähnlich klingenden Domains", () => {
        expect(hostInDomains("outlook.com", ["outlook.com"])).toBe("outlook.com");
        expect(hostInDomains("login.live.com", ["outlook.com", "live.com"])).toBe("live.com");
        expect(hostInDomains("evil-live.com", ["live.com"])).toBeNull();
        expect(hostInDomains("live.com.evil.net", ["live.com"])).toBeNull();
    });
});
