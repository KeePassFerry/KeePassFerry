import { utils } from "./utils";
import { FerryLog } from "./Logger";

export class FerryURL {
    private constructor(
        private _domain: string,
        private _url: URL,
        private _isIPAddress: boolean
    ) {}

    public get domain(): string {
        return this._domain;
    }
    public get url(): URL {
        return this._url;
    }
    public get isIPAddress(): boolean {
        return this._isIPAddress;
    }
    // Name der Website für Vergleiche ("gleiche Seite?"). Ohne registrierbare Domain zählt der Hostname selbst:
    // IP-Adressen, "localhost" und Geräte im Heimnetz ohne Endung (z. B. http://nas/) sind sonst namenlos, und
    // Hinweise wie "Passwort aktualisieren?" erschienen dort nie
    public get domainOrIPAddress(): string {
        return this._domain || this._url.hostname || "";
    }

    public get domainWithPort(): string {
        if (!this._domain) return "";
        if (this._url.port) return this._domain + ":" + this._url.port;
        return this._domain;
    }

    public static fromString(urlStr: string) {
        if (
            !urlStr.startsWith("https://") &&
            !urlStr.startsWith("http://") &&
            !urlStr.startsWith("file://")
        ) {
            urlStr = "https://" + urlStr;
        }
        try {
            const url = new URL(urlStr);
            const isIPAddress = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/.test(
                url.hostname
            );
            const domain = isIPAddress ? null : utils.psl.getDomain(url.hostname);
            return new FerryURL(domain, url, isIPAddress);
        } catch (e) {
            FerryLog.warn("Error processing URL: " + e);
        }
        return null;
    }
}
