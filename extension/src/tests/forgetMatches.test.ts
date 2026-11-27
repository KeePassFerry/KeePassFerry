import { describe, expect, it, vi } from "vitest";

vi.mock("../background/commands", () => ({ commandManager: { scheduleContextMenuUpdate: vi.fn() } }));

import { Action } from "../common/Action";
import { FrameState } from "../common/FrameState";
import { TabState } from "../common/TabState";

// #56: KeePass gesperrt oder getrennt -> geholte Einträge (mit Passwörtern) im Hintergrund und in allen Tabs verwerfen
describe("forgetMatchedEntries", () => {
    it("leert die Einträge aller Frames und schickt jedem Frame aller Tabs ForgetMatches", async () => {
        const { ferry: instance } = await import("../background/KF");
        // Nur die Methode, mit eigenen Tab-Zuständen
        const ferry = { tabStates: new Map<number, TabState>(), forgetMatchedEntries: instance.forgetMatchedEntries };
        const posted: { tab: number; frame: number; action: string }[] = [];
        for (const tabId of [1, 2]) {
            const ts = new TabState();
            for (const frameId of [0, 3]) {
                const fs = new FrameState();
                fs.entries = [{ uuid: "a" } as any];
                fs.urlEntries = [{ uuid: "b" } as any];
                ts.frames.set(frameId, fs);
                ts.framePorts.set(frameId, { postMessage: (m: any) => posted.push({ tab: tabId, frame: frameId, action: m.action }) } as any);
            }
            ferry.tabStates.set(tabId, ts);
        }

        ferry.forgetMatchedEntries();

        for (const ts of ferry.tabStates.values()) {
            for (const fs of ts.frames.values()) {
                expect(fs.entries).toEqual([]);
                expect(fs.urlEntries).toEqual([]);
            }
        }
        expect(posted).toHaveLength(4);
        expect(posted.every(p => p.action === Action.ForgetMatches)).toBe(true);
    });
});
