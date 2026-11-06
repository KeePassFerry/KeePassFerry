import { describe, expect, it } from "vitest";
import { parseOtpauth } from "../common/otpauth";

describe("parseOtpauth", () => {
    it("liest Aussteller und Konto aus einem gültigen Link", () => {
        expect(parseOtpauth("otpauth://totp/GitHub:max?secret=JBSWY3DPEHPK3PXP&issuer=GitHub")).toEqual({ issuer: "GitHub", account: "max" });
    });

    it("lehnt Links ohne gültigen Schlüssel ab", () => {
        expect(parseOtpauth("otpauth://totp/GitHub:max")).toBeNull();
        expect(parseOtpauth("otpauth://totp/GitHub:max?secret=KURZ")).toBeNull();
        expect(parseOtpauth("otpauth://totp/GitHub:max?secret=JBSWY3DPEHPK3PX1")).toBeNull();
    });

    it("lehnt andere QR-Inhalte ab", () => {
        expect(parseOtpauth("https://example.com/?secret=JBSWY3DPEHPK3PXP")).toBeNull();
        expect(parseOtpauth("otpauth://hotp/GitHub:max?secret=JBSWY3DPEHPK3PXP&counter=1")).toBeNull();
    });
});
