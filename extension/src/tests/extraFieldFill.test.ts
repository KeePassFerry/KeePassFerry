// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../common/ConfigManager", () => ({ configManager: { current: { ferryShowFieldIcons: false, autoFillFieldsWithExistingValue: false } } }));
vi.mock("../page/ferryDiagPage", () => ({ pageDiag: () => undefined }));

import { FormFilling } from "../page/formFilling";
import { FormUtils } from "../page/formsUtils";
import { FerryFieldIcon } from "../page/ferryFieldIcon";
import { Field } from "../common/model/Field";
import { Locator } from "../common/model/Locator";

const logger = { debug: () => undefined, warn: () => undefined, info: () => undefined } as any;

beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 20 });
    (globalThis as any).$STR = (key: string) => key;
});

const stored = (value: string, id: string) => new Field({ type: "text", value, name: id, locators: [new Locator({ id, name: "", type: "text" })] });

function pageFields(html: string) {
    document.body.innerHTML = `<form>${html}</form>`;
    return new FormUtils(logger).getFormFields(document.forms[0], false, 50).otherFields;
}

// Wie beim Ausfüllen: die Text-Felder des Eintrags in die Textfelder des Formulars
function fill(formFields: any[], dataFields: Field[]) {
    const self = {
        Logger: logger,
        formUtils: new FormUtils(logger),
        matchResult: {},
        calculateFieldMatchScore: (FormFilling.prototype as any).calculateFieldMatchScore,
        fillMatchedFields: (FormFilling.prototype as any).fillMatchedFields,
        getFormFieldCurrentValue: (FormFilling.prototype as any).getFormFieldCurrentValue,
        // Das Original löst UIEvents aus, die jsdom hier ablehnt; geprüft wird nur, welches Feld den Wert bekommt
        fillASingleField: (el: HTMLInputElement, _type: string, value: string) => (el.value = value)
    };
    (FormFilling.prototype as any).fillManyFormFields.call(self, formFields, dataFields, -1, { punishWrongIDAndName: false }, false);
}

const valueOf = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe("Zusatzfelder beim Ausfüllen", () => {
    it("trägt ein Zusatzfeld in sein eigenes Eingabefeld ein", () => {
        const fields = pageFields("<input id=\"user\" autocomplete=\"username\"><input id=\"pin\">");
        fill(fields, [stored("max", "user"), stored("1234", "pin")]);
        expect(valueOf("user")).toBe("max");
        expect(valueOf("pin")).toBe("1234");
    });

    it("trägt es nicht in ein fremdes Feld desselben Typs ein", () => {
        const fields = pageFields("<input id=\"user\" autocomplete=\"username\"><input id=\"suche\">");
        fill(fields, [stored("max", "user"), stored("1234", "pin")]);
        expect(valueOf("user")).toBe("max");
        expect(valueOf("suche")).toBe("");
    });

    it("füllt den Benutzernamen weiter auch ohne passende Kennung", () => {
        const fields = pageFields("<input id=\"anderer-name\">");
        fill(fields, [stored("max", "user")]);
        expect(valueOf("anderer-name")).toBe("max");
    });
});

describe("Symbol an gespeicherten Zusatzfeldern", () => {
    const entry = { fields: [stored("max", "user"), new Field({ type: "password", value: "x", locators: [new Locator({ id: "pw", type: "password" })] }), stored("1234", "pin")] } as any;

    function iconFor(html: string) {
        const fields = pageFields(html);
        const icon = new FerryFieldIcon({} as any, 0, new FormUtils(logger), () => undefined) as any;
        icon.addFieldIconToFields([], fields, [entry]);
        return (id: string) => icon.hasStoredExtra(fields.find((f: any) => f.field.locators[0].id === id));
    }

    it("zeigt es am Eingabefeld mit derselben Kennung", () => {
        expect(iconFor("<input id=\"pin\">")("pin")).toBe(true);
    });

    it("zeigt es nicht an anderen Feldern und nicht am Benutzernamen", () => {
        const has = iconFor("<input id=\"suche\"><input id=\"user\">");
        expect(has("suche")).toBe(false);
        expect(has("user")).toBe(false);
    });
});
