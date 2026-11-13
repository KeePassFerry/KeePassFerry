import { describe, expect, it } from "vitest";
import { FerryURL } from "../common/FerryURL";
import { sameSite } from "../common/relatedDomains";
import { supersedesSubmission } from "../common/submittedLogin";

const site = (url: string) => FerryURL.fromString(url)?.domainOrIPAddress;

describe("FerryURL.domainOrIPAddress", () => {
    it("uses the registrable domain for normal websites", () => {
        expect(site("https://login.example.com/path?x=1")).toBe("example.com");
        expect(site("https://www.example.co.uk/")).toBe("example.co.uk");
        expect(site("http://router.lan/")).toBe("router.lan");
    });

    it("uses the address itself for IP addresses", () => {
        expect(site("http://127.0.0.1:8081/login.html")).toBe("127.0.0.1");
        expect(site("http://[::1]:8081/login.html")).toBe("[::1]");
    });

    // Ohne Namen galt keine Seite als "dieselbe Website": Speichern- und Aktualisieren-Hinweise erschienen nie
    it("uses the host name for hosts without a registrable domain", () => {
        expect(site("http://localhost:8081/konto.html")).toBe("localhost");
        expect(site("http://nas/login")).toBe("nas");
    });

    it("has no site name for local files", () => {
        expect(site("file:///C:/temp/login.html")).toBe("");
    });
});

describe("same website on hosts without a registrable domain", () => {
    it("treats two pages of localhost as the same site, but not localhost and 127.0.0.1", () => {
        expect(sameSite(site("http://localhost:8081/passwort-aendern.html"), site("http://localhost:8081/konto.html"))).toBe(true);
        expect(sameSite(site("http://localhost:8081/"), site("http://127.0.0.1:8081/"))).toBe(false);
        expect(sameSite(site("http://nas/"), site("http://localhost/"))).toBe(false);
    });

    it("lets a new login of the same user on localhost replace an older offer", () => {
        expect(
            supersedesSubmission(
                { url: "http://localhost:8081/login.html", username: "demo@spielwiese.test" },
                { url: "http://localhost:8081/login.html", username: "demo@spielwiese.test" }
            )
        ).toBe(true);
    });
});
