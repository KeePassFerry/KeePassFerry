// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import EntryAddition from "../popup/components/EntryAddition.vue";
import useStore from "../store";

const STUBS = ["v-tooltip", "v-select", "v-text-field", "v-textarea", "v-btn", "v-checkbox", "v-spacer"];
const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// #54: "Hinzufügen" übersteht ein Schließen des Popups (Entwurf im Bearbeiten-Zustand)
describe("EntryAddition: Entwurf", () => {
    function mount(props: Record<string, unknown>) {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (msg: { keepassferry: string }) =>
            msg.keepassferry === "getEntryExtras"
                ? { fields: [{ name: "PIN", isProtected: false, value: "1" }], attachments: [], notes: "" }
                : null
        );
        const pinia = createPinia();
        setActivePinia(pinia);
        const store = useStore();
        store.saveState = { ...store.saveState, lastActiveAt: new Date() } as any;
        const host = document.createElement("div");
        document.body.appendChild(host);
        const app = createApp(EntryAddition, props);
        app.config.globalProperties.$i18n = (k: string) => k;
        app.use(pinia);
        for (const name of STUBS) app.component(name, { render: () => h("div") });
        return { vm: app.mount(host) as any, store, unmount: () => { app.unmount(); host.remove(); } };
    }

    it("merkt offenes Hinzufügen, Eingaben, Vorgemerktes und Entfernungen", async () => {
        const w = mount({ uuid: "u1", dbFileName: "db.kdbx", title: "T" });
        await wait();
        w.vm.openAdd();
        w.vm.kind = "custom";
        w.vm.name = "Kundennummer";
        w.vm.value = "4711";
        w.vm.staged.push({ key: "s1", type: "field", name: "Frage", sub: "x", isNew: true, value: "Antwort" });
        w.vm.existing.find((r: any) => r.key === "f:PIN").removed = true;
        await wait(300);
        const d = w.store.saveState.additionDraft;
        expect(d.uuid).toBe("u1");
        expect([d.adding, d.kind, d.name, d.value]).toEqual([true, "custom", "Kundennummer", "4711"]);
        expect(d.staged.map((r: any) => r.value)).toEqual(["Antwort"]);
        expect(d.changes).toEqual([{ key: "f:PIN", removed: true, newValue: undefined, newProtect: undefined }]);
        w.unmount();
    });

    it("stellt den Entwurf beim nächsten Öffnen wieder her, nur für denselben Eintrag", async () => {
        const draft = {
            uuid: "u1", adding: true, kind: "custom", name: "Kundennummer", value: "4711", protect: false, imageName: "",
            staged: [{ key: "s1", type: "field", name: "Frage", sub: "x", isNew: true, value: "Antwort" }],
            changes: [{ key: "f:PIN", removed: true }]
        };
        const w = mount({ uuid: "u1", dbFileName: "db.kdbx", title: "T" });
        w.unmount();
        const again = mount({ uuid: "u1", dbFileName: "db.kdbx", title: "T" });
        again.unmount();

        const pinia = createPinia();
        setActivePinia(pinia);
        const store = useStore();
        store.saveState = { ...store.saveState, lastActiveAt: new Date(), additionDraft: draft } as any;
        const host = document.createElement("div");
        const app = createApp(EntryAddition, { uuid: "u1", dbFileName: "db.kdbx", title: "T" });
        app.config.globalProperties.$i18n = (k: string) => k;
        app.use(pinia);
        for (const name of STUBS) app.component(name, { render: () => h("div") });
        const vm = app.mount(host) as any;
        await wait();
        expect([vm.adding, vm.name, vm.value]).toEqual([true, "Kundennummer", "4711"]);
        expect(vm.staged.map((r: any) => r.value)).toEqual(["Antwort"]);
        expect(vm.existing.find((r: any) => r.key === "f:PIN").removed).toBe(true);
        app.unmount();

        // Anderer Eintrag: kein Entwurf
        const other = createApp(EntryAddition, { uuid: "u2", dbFileName: "db.kdbx", title: "T" });
        other.config.globalProperties.$i18n = (k: string) => k;
        other.use(pinia);
        for (const name of STUBS) other.component(name, { render: () => h("div") });
        const vm2 = other.mount(document.createElement("div")) as any;
        await wait();
        expect([vm2.adding, vm2.value, vm2.staged.length]).toEqual([false, "", 0]);
        other.unmount();
    });
});
