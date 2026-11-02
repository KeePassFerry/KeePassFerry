import { describe, expect, it, vi } from "vitest";

vi.mock("../background/KF", () => ({ ferry: {} }));
vi.mock("../background/ferryDiag", () => ({ diag: vi.fn() }));
vi.mock("../common/ConfigManager", () => ({ configManager: { current: {} } }));

import { relatedOriginListed, rpIdAllowed, rpIdPermitted } from "../background/passkeys";

function mockFetch(body: any, { status = 200, contentType = "application/json", url = "" } = {}) {
    const fn = vi.fn(async () => ({
        status,
        ok: status >= 200 && status < 300,
        url,
        headers: new Headers({ "content-type": contentType }),
        json: async () => body
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
}

describe("Related Origins: Abruf nach Standard", () => {
    const origins = { origins: ["https://login.shop.de"] };
    it("ohne Cookies und Referrer, Umleitungen werden gefolgt", async () => {
        const fn = mockFetch(origins, { url: "https://www.r1.example/.well-known/webauthn" });
        expect(await rpIdPermitted("https://login.shop.de/", "r1.example")).toBe(true);
        const init = (fn.mock.calls[0] as any[])[1];
        expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow" });
    });
    it("Content-Type mit charset ist ok, anderer Typ nicht", async () => {
        mockFetch(origins, { contentType: "application/json; charset=utf-8" });
        expect(await rpIdPermitted("https://login.shop.de/", "r2.example")).toBe(true);
        mockFetch(origins, { contentType: "text/json" });
        expect(await rpIdPermitted("https://login.shop.de/", "r3.example")).toBe(false);
    });
    it("Umleitung auf http oder Status ungleich 200 wird abgelehnt", async () => {
        mockFetch(origins, { url: "http://r4.example/.well-known/webauthn" });
        expect(await rpIdPermitted("https://login.shop.de/", "r4.example")).toBe(false);
        mockFetch(origins, { status: 204 });
        expect(await rpIdPermitted("https://login.shop.de/", "r5.example")).toBe(false);
    });
    it("Seite ohne HTTPS fragt gar nicht erst", async () => {
        const fn = mockFetch(origins);
        expect(await rpIdPermitted("http://login.shop.de/", "r6.example")).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
});

// Inhalt von https://auth.gmx.net/.well-known/webauthn (Stand 02.11.2026)
const GMX = ["https://www.gmx.net", "https://auth.gmx.net", "https://account.gmx.net", "https://passkey-admin.gmx.net"];

describe("Passkey RP-ID", () => {
    it("GMX: auth.gmx.net ist für passkey-admin.gmx.net keine eigene RP-ID", () => {
        expect(rpIdAllowed("https://passkey-admin.gmx.net/?emailAddress=x", "auth.gmx.net")).toBe(false);
        expect(rpIdAllowed("https://passkey-admin.gmx.net/", "gmx.net")).toBe(true);
    });
    it("Related Origins: aufgeführte Herkunft erlaubt", () => {
        expect(relatedOriginListed(GMX, "https://passkey-admin.gmx.net")).toBe(true);
        expect(relatedOriginListed(GMX, "https://www.gmx.net")).toBe(true);
    });
    it("Related Origins: nicht aufgeführt, anderes Schema oder Port", () => {
        expect(relatedOriginListed(GMX, "https://evil.gmx.net")).toBe(false);
        expect(relatedOriginListed(GMX, "http://passkey-admin.gmx.net")).toBe(false);
        expect(relatedOriginListed(GMX, "https://passkey-admin.gmx.net:8443")).toBe(false);
        expect(relatedOriginListed(null, "https://passkey-admin.gmx.net")).toBe(false);
    });
    it("Related Origins: höchstens 5 verschiedene Domain-Namen", () => {
        const list = ["a", "b", "c", "d", "e"].map(l => "https://" + l + ".example").concat("https://f.example", "https://www.a.example");
        expect(relatedOriginListed(list, "https://e.example")).toBe(true);
        expect(relatedOriginListed(list, "https://f.example")).toBe(false);
        expect(relatedOriginListed(list, "https://www.a.example")).toBe(true);
        expect(relatedOriginListed(["https://a.de", "https://a.com"], "https://a.com")).toBe(true);
    });
});
