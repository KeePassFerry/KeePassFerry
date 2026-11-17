import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeSessionManager } from "../background/NativeSession";

// Gestoppte Erstkopplung (abgelehnt / gesperrt): kein Host-Start und kein Timer, bis "Erneut verbinden"
describe("NativeSessionManager pairing stop", () => {
    let connectNative: ReturnType<typeof vi.fn>;

    const newPort = () => ({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() }
    });

    const newManager = () =>
        new NativeSessionManager({
            onOpening: () => true,
            onOpen: vi.fn(),
            onClose: vi.fn(),
            onMessage: vi.fn(),
            onProblem: vi.fn(),
            onPairingCode: vi.fn(),
            clientFeatures: () => []
        } as any);

    beforeEach(() => {
        vi.useFakeTimers();
        // Service-Worker-Global für setTimeout
        (globalThis as any).self = globalThis;
        connectNative = vi.fn(() => newPort());
        (chrome.runtime as any).connectNative = connectNative;
        (chrome.storage.session.get as any).mockResolvedValue({});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not reconnect on its own while the pairing is stopped", () => {
        const m = newManager();
        (m as any).connectHost();
        expect(connectNative).toHaveBeenCalledTimes(1);

        (m as any).setPairingStopped("unlock", 0);
        m.closeSession();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(10 * 60 * 1000);
        expect(connectNative).toHaveBeenCalledTimes(1);
    });

    it("connects again on retryPairing", () => {
        const m = newManager();
        (m as any).setPairingStopped("denied", Date.now() + 120000);
        m.retryPairing();
        expect(connectNative).toHaveBeenCalledTimes(1);
    });

    it("keeps the stop across a service worker restart", async () => {
        (chrome.storage.session.get as any).mockResolvedValue({ ferryPairingStopped: { reason: "unlock", retryAt: 0 } });
        const m = newManager();
        m.startup();
        await vi.runAllTimersAsync();
        expect(connectNative).not.toHaveBeenCalled();
        expect((await m.status()).pairingStopped).toBe("unlock");
    });
});
