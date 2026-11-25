// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shieldFromPage } from "../page/pageShield";

// #53: Klicks und Fokus in unseren Elementen kommen bei der Seite nicht an (Dialoge der Seite schließen sonst)
function pageListeners() {
    const seen: string[] = [];
    for (const t of ["pointerdown", "mousedown", "focusin", "focusout", "click"]) {
        document.addEventListener(t, () => seen.push(t));
        document.addEventListener(t, () => seen.push("capture " + t), true);
        window.addEventListener(t, () => seen.push("window " + t));
    }
    return seen;
}

const fire = (el: Element, type: string) => {
    const e = new Event(type, { bubbles: true, composed: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
};

describe("shieldFromPage", () => {
    it("Feldsymbol: Zeiger und Fokus abgefangen, mousedown ohne Fokuswechsel, click frei", () => {
        document.body.innerHTML = "";
        const seen = pageListeners();
        const host = document.createElement("keepassferry-field-icons");
        host.attachShadow({ mode: "closed" });
        document.documentElement.appendChild(host);
        shieldFromPage(host, true);

        expect(fire(host, "mousedown").defaultPrevented).toBe(true);
        fire(host, "pointerdown");
        fire(host, "focusin");
        fire(host, "click");
        expect(seen).toEqual(["capture click", "click", "window click"]);
    });

    it("Panel: Fokus abgefangen, Standardaktion bleibt (dort wird getippt)", () => {
        document.body.innerHTML = "";
        const seen = pageListeners();
        const panel = document.createElement("div");
        document.body.appendChild(panel);
        shieldFromPage(panel, false);

        expect(fire(panel, "mousedown").defaultPrevented).toBe(false);
        fire(panel, "focusout");
        expect(seen).toEqual([]);
    });

    it("Elemente der Seite bleiben unberührt", () => {
        document.body.innerHTML = "<button id='seite'>x</button>";
        const seen = pageListeners();
        const own = document.getElementById("seite");
        expect(fire(own, "mousedown").defaultPrevented).toBe(false);
        expect(seen).toEqual(["capture mousedown", "mousedown", "window mousedown"]);
    });
});
