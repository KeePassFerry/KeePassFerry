import { describe, expect, it } from "vitest";
import { reconcileURLs } from "../popup/reconcileURLs";

// Adressen eines vorhandenen Eintrags, wenn abgeschickte Zugangsdaten in ihn übernommen werden (Passwort geändert)
describe("reconcileURLs", () => {
    it("keeps all addresses when the form was submitted on the entry's website", async () => {
        const urls = ["https://example.com/login", "https://login.example.org/"];
        expect(await reconcileURLs(urls, "https://example.com/account/change-password")).toEqual({ urls, showWarning: false });
    });

    it("keeps the main address when the form was submitted on an additional address", async () => {
        const urls = ["http://127.0.0.1:8081/login.html", "http://localhost:8081/login.html"];
        expect(await reconcileURLs(urls, "http://localhost:8081/passwort-aendern.html")).toEqual({ urls, showWarning: false });
    });

    it("keeps the addresses on an exact match", async () => {
        const urls = ["https://example.com/login"];
        expect(await reconcileURLs(urls, "https://example.com/login")).toEqual({ urls, showWarning: false });
    });

    it("adds the address and warns when the website is not part of the entry", async () => {
        expect(await reconcileURLs(["https://example.com/login"], "https://other.example.net/signin")).toEqual({
            urls: ["https://other.example.net/signin", "https://example.com/login"],
            showWarning: true
        });
    });
});
