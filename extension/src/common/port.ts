import type { AddonMessage } from "./AddonMessage";
import { FerryLog } from "./Logger";

class ContentPortManager {
    private port: chrome.runtime.Port;

    // public mixin = {
    //     methods: {
    //         postMessage: msg => {
    //             this.port.postMessage(msg);
    //         }
    //     }
    // };

    // Pfeilfunktion: bleibt auch als losgelöste Kopie (const pm = Port.postMessage) an diesen Port gebunden
    public postMessage = (msg: AddonMessage) => {
        try {
            this.port.postMessage(msg);
        } catch (e) {
            if (FerryLog && FerryLog.warn) FerryLog.warn("Failed to post a message. If the addon has just auto-updated this is expected. " + (e?.message ?? e) + (this.disconnectReason ? " (disconnected: " + this.disconnectReason + ")" : ""));
        }
    };

    private disconnectReason: string = null;

    public startup(name: string) {
        this.port = chrome.runtime.connect({ name });
        this.port.onDisconnect.addListener(() => {
            this.disconnectReason = chrome.runtime.lastError?.message ?? "by the background";
            if (FerryLog && FerryLog.warn) FerryLog.warn("Port " + name + " disconnected: " + this.disconnectReason);
        });
    }

    public shutdown() {
        this.port = null;
    }

    public get raw(): chrome.runtime.Port {
        return this.port;
    }
}

export const Port = new ContentPortManager();
