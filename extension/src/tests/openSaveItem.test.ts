import { describe, expect, it, vi } from "vitest";

vi.mock("../background/commands", () => ({ commandManager: { scheduleContextMenuUpdate: vi.fn() } }));

// Symbol in der Leiste bleibt hervorgehoben, solange etwas zu speichern ist (#54): weggeklickte Zugangsdaten, ein
// gefundener Zwei-Faktor-Schlüssel, ein begonnener neuer Eintrag (je Tab) oder ein angefangenes Bearbeiten
describe("hasOpenSaveItem", () => {
    async function fake(opts: {
        submitted?: boolean;
        pendingCreateTab?: number;
        lastActiveMsAgo?: number;
        savedMsAgo?: number;
        savedResult?: string;
    }) {
        const { ferry: instance } = await import("../background/KF");
        const now = Date.now();
        return {
            persistentTabStates: new Map(opts.submitted ? [[7, { items: [{ itemType: "submittedData" }] }]] : []),
            tabStates: new Map(),
            store: {
                state: {
                    saveState: {
                        pendingCreate: opts.pendingCreateTab != null ? { kind: "otp", tabId: opts.pendingCreateTab } : null,
                        lastActiveAt: opts.lastActiveMsAgo != null ? new Date(now - opts.lastActiveMsAgo) : null
                    },
                    saveEntryResult: opts.savedMsAgo != null
                        ? { result: opts.savedResult ?? "updated", receivedAt: new Date(now - opts.savedMsAgo) }
                        : { result: null, receivedAt: new Date(0) }
                }
            },
            hasOpenSaveItem: instance.hasOpenSaveItem,
            editInProgress: instance.editInProgress
        } as any;
    }

    it("weggeklickte Zugangsdaten im Tab", async () => {
        const f = await fake({ submitted: true });
        expect(f.hasOpenSaveItem(7)).toBe(true);
        expect(f.hasOpenSaveItem(8)).toBe(false);
    });

    it("begonnener neuer Eintrag nur im eigenen Tab und solange er aktiv ist", async () => {
        expect((await fake({ pendingCreateTab: 7, lastActiveMsAgo: 1000 })).hasOpenSaveItem(7)).toBe(true);
        expect((await fake({ pendingCreateTab: 7, lastActiveMsAgo: 1000 })).hasOpenSaveItem(8)).toBe(false);
        expect((await fake({ pendingCreateTab: 7 })).hasOpenSaveItem(7)).toBe(false);
    });

    it("angefangenes Bearbeiten: in jedem Tab, bis gespeichert, abgebrochen oder älter als eine Stunde", async () => {
        expect((await fake({ lastActiveMsAgo: 60_000 })).hasOpenSaveItem(3)).toBe(true);
        expect((await fake({ lastActiveMsAgo: 2 * 3_600_000 })).hasOpenSaveItem(3)).toBe(false);
        expect((await fake({ lastActiveMsAgo: 60_000, savedMsAgo: 1000 })).hasOpenSaveItem(3)).toBe(false);
        expect((await fake({ lastActiveMsAgo: 60_000, savedMsAgo: 1000, savedResult: "error" })).hasOpenSaveItem(3)).toBe(true);
        // Älteres Speichern zählt nicht für ein neueres Bearbeiten
        expect((await fake({ lastActiveMsAgo: 1000, savedMsAgo: 60_000 })).hasOpenSaveItem(3)).toBe(true);
    });

    it("nichts offen", async () => {
        expect((await fake({})).hasOpenSaveItem(7)).toBe(false);
    });
});
