// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import EntryAddition from "../popup/components/EntryAddition.vue";
import { requestExtraEdit } from "../popup/extras";

// Sprung aus der Vorschau des aufgeklappten Eintrags (Stift) ins Bearbeiten-Fenster
describe("EntryAddition: Sprung aus der Vorschau", () => {
    function mountWith(extras: unknown) {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (msg: { keepassferry: string }) =>
            msg.keepassferry === "getEntryExtras" ? extras : null
        );
        Element.prototype.scrollIntoView = vi.fn();
        return mount(EntryAddition, {
            props: { uuid: "u1", dbFileName: "db.kdbx", title: "Titel" },
            global: {
                config: { globalProperties: { $i18n: (k: string) => k } as any },
                stubs: { "v-tooltip": true, "v-select": true, "v-text-field": true, "v-textarea": true, "v-btn": true, "v-checkbox": true, "v-spacer": true }
            }
        });
    }

    it("hebt die Zeile des Bildes hervor", async () => {
        requestExtraEdit("u1", "a:bild.jpg");
        const w = mountWith({ fields: [], attachments: [{ name: "bild.jpg", size: 1000 }], notes: "" });
        await flushPromises();
        const row = w.find('[data-key="a:bild.jpg"]');
        expect(row.exists()).toBe(true);
        expect(row.classes()).toContain("highlight");
    });

    it("hebt auch nach erneutem Aufbau des Fensters hervor", async () => {
        requestExtraEdit("u1", "a:bild.jpg");
        const extras = { fields: [], attachments: [{ name: "bild.jpg", size: 1000 }], notes: "" };
        mountWith(extras).unmount();
        await flushPromises();
        const w = mountWith(extras);
        await flushPromises();
        expect(w.find('[data-key="a:bild.jpg"]').classes()).toContain("highlight");
    });

    it("öffnet bei Notizen gleich das Bearbeiten", async () => {
        requestExtraEdit("u1", "notes");
        const w = mountWith({ fields: [], attachments: [], notes: "Text" });
        await flushPromises();
        expect(w.find(".ferry-add-form").exists()).toBe(true);
    });
});
