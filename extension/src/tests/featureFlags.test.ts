import { describe, expect, it } from "vitest";
import { pluginIsOutdated, pluginVersionAtLeast } from "../common/FeatureFlags";

const f = (v: string) => (v ? ["KPRPC_FEATURE_VERSION_1_6", "KEEPASSFERRY_VERSION_" + v] : ["KPRPC_FEATURE_VERSION_1_6"]);

describe("pluginVersionAtLeast", () => {
    it("vergleicht Versionsnummern numerisch", () => {
        expect(pluginVersionAtLeast(f("1.0.8"), "1.0.8")).toBe(true);
        expect(pluginVersionAtLeast(f("1.0.10"), "1.0.8")).toBe(true);
        expect(pluginVersionAtLeast(f("1.1"), "1.0.8")).toBe(true);
        expect(pluginVersionAtLeast(f("1.0.7"), "1.0.8")).toBe(false);
        expect(pluginVersionAtLeast(f("0.9.9"), "1.0.8")).toBe(false);
    });

    it("Plugin ohne Versionsangabe (vor 1.0.4) gilt als zu alt", () => {
        expect(pluginVersionAtLeast(f(null), "1.0.4")).toBe(false);
        expect(pluginIsOutdated(f(null))).toBe(true);
    });
});
