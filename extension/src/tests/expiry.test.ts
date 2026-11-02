import { describe, expect, it } from "vitest";
import { addPreset, defaultExpiryChoice, expiryState, nearestPreset, newExpiryTime } from "../common/expiry";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("expiryState", () => {
    it("ohne Ablaufdatum nichts", () => {
        expect(expiryState(null, 7, NOW)).toBeNull();
        expect(expiryState("kaputt", 7, NOW)).toBeNull();
    });
    it("abgelaufen", () => {
        expect(expiryState("2026-11-02T11:16:54Z", 7, NOW)?.kind).toBe("expired");
    });
    it("innerhalb der Vorwarnzeit mit aufgerundeten Tagen", () => {
        const s = expiryState(new Date(NOW + 4.5 * DAY).toISOString(), 7, NOW);
        expect(s?.kind).toBe("soon");
        expect(s?.daysLeft).toBe(5);
    });
    it("außerhalb der Vorwarnzeit nichts", () => {
        expect(expiryState(new Date(NOW + 8 * DAY).toISOString(), 7, NOW)).toBeNull();
        expect(expiryState(new Date(NOW + 1 * DAY).toISOString(), 0, NOW)).toBeNull();
    });
});

describe("Gültig bis", () => {
    it("nächstliegende Vorgabe", () => {
        expect(nearestPreset(90)).toBe("m3");
        expect(nearestPreset(365)).toBe("y1");
        expect(nearestPreset(10)).toBe("w1");
        expect(nearestPreset(0)).toBe("m3");
    });
    it("Monate kalendarisch", () => {
        const d = addPreset(new Date(2026, 10, 2, 11, 0, 0), "m3");
        expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 1, 2]);
    });
    it("Vorauswahl", () => {
        expect(defaultExpiryChoice(false, null, 0, NOW)).toBe("never");
        expect(defaultExpiryChoice(true, null, 0, NOW)).toBe("keep");
        expect(defaultExpiryChoice(true, new Date(NOW + DAY).toISOString(), 30, NOW)).toBe("keep");
        expect(defaultExpiryChoice(true, "2026-11-01T00:00:00Z", 30, NOW)).toBe("m1");
    });
    it("Wert für das Plugin", () => {
        expect(newExpiryTime("keep", true)).toBeUndefined();
        expect(newExpiryTime("never", false)).toBeUndefined();
        expect(newExpiryTime("never", true)).toBe("never");
        expect(newExpiryTime("w1", false, new Date(NOW))).toBe("2026-11-09T12:00:00Z");
    });
});
