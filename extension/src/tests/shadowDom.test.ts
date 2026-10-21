// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { findInputsInOpenShadowRoots, findOpenShadowRoots, isHostedInForm } from "../page/shadowDom";

function addHost(parent: Node, mode: ShadowRootMode, innerHTML: string) {
    const host = document.createElement("div");
    parent.appendChild(host);
    const shadowRoot = host.attachShadow({ mode });
    shadowRoot.innerHTML = innerHTML;
    return { host, shadowRoot };
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("findInputsInOpenShadowRoots", () => {
    it("finds nothing when there are no shadow roots", () => {
        document.body.innerHTML = "<form><input type='text'></form>";
        expect(findInputsInOpenShadowRoots(document)).toEqual([]);
    });

    it("finds a password field in an open shadow root inside a form", () => {
        document.body.innerHTML = "<form><input id='username' type='email'></form>";
        const { shadowRoot } = addHost(
            document.querySelector("form"),
            "open",
            "<input id='password' type='password'>"
        );

        const inputs = findInputsInOpenShadowRoots(document);

        expect(inputs).toEqual([shadowRoot.getElementById("password")]);
        expect(inputs[0].form).toBeNull();
    });

    it("finds fields in nested open shadow roots", () => {
        const outer = addHost(document.body, "open", "<input id='outer'>");
        const inner = addHost(outer.shadowRoot, "open", "<input id='inner' type='password'>");

        const ids = findInputsInOpenShadowRoots(document).map(input => input.id);

        expect(ids).toEqual(["outer", "inner"]);
        expect(findOpenShadowRoots(document)).toEqual([outer.shadowRoot, inner.shadowRoot]);
    });

    it("ignores closed shadow roots", () => {
        addHost(document.body, "closed", "<input type='password'>");
        expect(findInputsInOpenShadowRoots(document)).toEqual([]);
    });

    it("includes the shadow root of the starting element itself", () => {
        const { host, shadowRoot } = addHost(document.body, "open", "<input type='password'>");
        expect(findOpenShadowRoots(host)).toEqual([shadowRoot]);
    });
});

describe("isHostedInForm", () => {
    it("is true when the outermost shadow host is inside a form", () => {
        document.body.innerHTML = "<form></form>";
        const outer = addHost(document.querySelector("form"), "open", "");
        const inner = addHost(outer.shadowRoot, "open", "<input type='password'>");

        expect(isHostedInForm(inner.shadowRoot.querySelector("input"))).toBe(true);
    });

    it("is false when the shadow host is outside any form", () => {
        const { shadowRoot } = addHost(document.body, "open", "<form><input></form>");
        expect(isHostedInForm(shadowRoot.querySelector("input"))).toBe(false);
    });

    it("is false for fields that are not in a shadow root", () => {
        document.body.innerHTML = "<form><input></form>";
        expect(isHostedInForm(document.querySelector("input"))).toBe(false);
    });
});
