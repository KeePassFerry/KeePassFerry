import { vi } from "vitest";

// Minimale Nachbildung der Browser-API für Unit-Tests (Module greifen beim Laden auf chrome.* zu)
const listeners = () => ({ addListener: vi.fn(), removeListener: vi.fn(), hasListener: vi.fn(() => false) });
const storageArea = () => ({
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
});

globalThis.jest = vi;
globalThis.chrome = {
    runtime: {
        id: "test id",
        getURL: path => "chrome-extension://test/" + path.replace(/^\//, ""),
        sendMessage: vi.fn(),
        connect: vi.fn(() => ({ postMessage: vi.fn(), onMessage: listeners(), onDisconnect: listeners(), disconnect: vi.fn() })),
        onMessage: listeners(),
        onConnect: listeners()
    },
    storage: {
        local: storageArea(),
        sync: storageArea(),
        session: storageArea(),
        onChanged: listeners()
    },
    i18n: {
        getMessage: key => key,
        getUILanguage: () => "de"
    }
};
