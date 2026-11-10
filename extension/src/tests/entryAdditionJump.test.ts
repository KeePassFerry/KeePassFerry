// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import EntryAddition from "../popup/components/EntryAddition.vue";
import { requestExtraEdit } from "../popup/extras";

const STUBS = ["v-tooltip", "v-select", "v-text-field", "v-textarea", "v-btn", "v-checkbox", "v-spacer"];
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

// Sprung aus der Vorschau des aufgeklappten Eintrags (Stift) ins Bearbeiten-Fenster
describe("EntryAddition: Sprung aus der Vorschau", () => {
    function mountWith(extras: unknown) {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (msg: { keepassferry: string }) =>
            msg.keepassferry === "getEntryExtras" ? extras : null
        );
        Element.prototype.scrollIntoView = vi.fn();
        // Ohne Testbibliothek: Komponente in ein eigenes Element einhängen, Vuetify-Bausteine als leere Platzhalter
        const host = document.createElement("div");
        document.body.appendChild(host);
        const app = createApp(EntryAddition, { uuid: "u1", dbFileName: "db.kdbx", title: "Titel" });
        app.config.globalProperties.$i18n = (k: string) => k;
        for (const name of STUBS) app.component(name, { render: () => h("div") });
        app.mount(host);
        return {
            find: (selector: string) => host.querySelector(selector),
            unmount: () => {
                app.unmount();
                host.remove();
            }
        };
    }

    it("hebt die Zeile des Bildes hervor", async () => {
        requestExtraEdit("u1", "a:bild.jpg");
        const w = mountWith({ fields: [], attachments: [{ name: "bild.jpg", size: 1000 }], notes: "" });
        await flushPromises();
        const row = w.find('[data-key="a:bild.jpg"]');
        expect(row).not.toBeNull();
        expect(row.classList.contains("highlight")).toBe(true);
    });

    it("hebt auch nach erneutem Aufbau des Fensters hervor", async () => {
        requestExtraEdit("u1", "a:bild.jpg");
        const extras = { fields: [], attachments: [{ name: "bild.jpg", size: 1000 }], notes: "" };
        mountWith(extras).unmount();
        await flushPromises();
        const w = mountWith(extras);
        await flushPromises();
        expect(w.find('[data-key="a:bild.jpg"]').classList.contains("highlight")).toBe(true);
    });

    it("öffnet bei Notizen gleich das Bearbeiten", async () => {
        requestExtraEdit("u1", "notes");
        const w = mountWith({ fields: [], attachments: [], notes: "Text" });
        await flushPromises();
        expect(w.find(".ferry-add-form")).not.toBeNull();
    });
});
