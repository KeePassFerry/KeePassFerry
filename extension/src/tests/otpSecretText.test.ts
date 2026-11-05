// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findSecretText } from "../page/OtpFields";

describe("Schlüssel als Text auf Einrichtungsseiten", () => {
    it("erkennt den Schlüssel neben dem Einrichtungsbegriff (groß, in Gruppen)", () => {
        expect(findSecretText("Set up your authenticator app. Setup key: JBSW Y3DP EHPK 3PXP")).toBe("JBSWY3DPEHPK3PXP");
    });

    it("erkennt kleingeschriebene Schlüssel in Gruppen (Google)", () => {
        expect(findSecretText("Can't scan it? Enter this key: jbsw y3dp ehpk 3pxp")).toBe("JBSWY3DPEHPK3PXP");
    });

    it("nimmt kein kleingeschriebenes Wort ohne Gruppen (SourceForge, Issue #19)", () => {
        expect(findSecretText("I like it more than the 2FA flow of others. Related: keepass2developerextensions")).toBeNull();
    });

    it("nimmt keinen Schlüssel weit weg vom Einrichtungsbegriff", () => {
        const far = "2FA is great. " + "Lorem ipsum dolor sit amet. ".repeat(40) + "JBSW Y3DP EHPK 3PXP";
        expect(findSecretText(far)).toBeNull();
    });
});
