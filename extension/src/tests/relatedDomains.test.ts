import { describe, expect, it } from "vitest";
import { hostInDomains, relatedDomains, sameSite } from "../common/relatedDomains";

describe("sameSite", () => {
    it("Folgeseite einer mehrstufigen Microsoft-Anmeldung gilt als dieselbe Website", () => {
        expect(sameSite("microsoftonline.com", "live.com")).toBe(true);
        expect(sameSite("example.com", "example.com")).toBe(true);
        expect(sameSite("live.com", "google.com")).toBe(false);
        expect(sameSite("example.com", "example.org")).toBe(false);
        expect(sameSite(null, "live.com")).toBe(false);
    });
});
import { KeeURL } from "../common/KeeURL";

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

describe("Liste zugehöriger Domains", () => {
    // Jede Domain muss selbst eine registrierbare Domain sein (keine öffentliche Endung wie "net.cn", kein Tippfehler):
    // sonst würde ein Eintrag auf beliebigen fremden Seiten unter dieser Endung angeboten
    it("enthält nur registrierbare Domains", () => {
        const all = new Set<string>();
        for (const probe of ["live.com", "google.com", "apple.com", "amazon.de", "ebay.de", "paypal.com", "facebook.com",
            "proton.me", "ui.com", "atlassian.com", "x.com", "disney.com", "stackoverflow.com", "docusign.com",
            "autodesk.com", "alibaba.com", "airbnb.de", "yandex.ru"]) {
            const group = [probe, ...relatedDomains(probe)];
            expect(group.length).toBeGreaterThan(1);
            for (const d of group) all.add(d);
        }
        for (const d of all) expect(KeeURL.fromString("https://login." + d + "/")?.domainOrIPAddress, d).toBe(d);
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
