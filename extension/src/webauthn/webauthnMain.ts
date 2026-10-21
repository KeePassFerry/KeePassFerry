/*
webauthnMain.ts läuft in der Seitenwelt (MAIN) und übernimmt navigator.credentials.create/get für Passkeys.
Anfragen gehen per window.postMessage an die Brücke im Inhaltsskript (page.ts → PasskeyBridge), die die
Herkunft prüft (über die vom Browser gemeldete Frame-URL), den Dialog zeigt und das KeePass-Plugin fragt.
"Anderes Gerät verwenden", nicht unterstützte Optionen oder eine fehlende Brücke → Aufruf geht unverändert an
den Browser (Windows Hello, Sicherheitsschlüssel, KeePassPasskey).
Bedingte Anfragen (mediation: "conditional", Passkey-Vorschläge im Benutzerfeld) gehen vorerst immer an den Browser.
*/

(() => {
    const w = window as any;
    if (w.__keepassferryWebAuthn || !navigator.credentials || !w.PublicKeyCredential) return;
    w.__keepassferryWebAuthn = true;

    const CHANNEL = "keepassferry-webauthn";
    const credentials = navigator.credentials;
    const nativeCreate = credentials.create.bind(credentials);
    const nativeGet = credentials.get.bind(credentials);

    let bridgeReady = false;
    const readyWaiters: (() => void)[] = [];
    let nextId = 1;
    const pending = new Map<number, (msg: any) => void>();

    window.addEventListener("message", ev => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.channel !== CHANNEL || d.dir !== "toPage") return;
        if (d.type === "ready") {
            bridgeReady = true;
            readyWaiters.splice(0).forEach(f => f());
            return;
        }
        const cb = pending.get(d.id);
        if (cb) {
            pending.delete(d.id);
            cb(d);
        }
    });

    function waitForBridge(ms: number): Promise<boolean> {
        if (bridgeReady) return Promise.resolve(true);
        window.postMessage({ channel: CHANNEL, dir: "toBridge", type: "ping" }, window.location.origin);
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(false), ms);
            readyWaiters.push(() => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    }

    function ask(kind: string, payload: any, signal?: AbortSignal): Promise<any> {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, resolve);
            if (signal) {
                if (signal.aborted) {
                    pending.delete(id);
                    reject(new DOMException("The operation was aborted.", "AbortError"));
                    return;
                }
                signal.addEventListener("abort", () => {
                    if (!pending.has(id)) return;
                    pending.delete(id);
                    window.postMessage({ channel: CHANNEL, dir: "toBridge", type: "abort", id }, window.location.origin);
                    reject(new DOMException("The operation was aborted.", "AbortError"));
                });
            }
            window.postMessage({ channel: CHANNEL, dir: "toBridge", type: "request", id, kind, payload }, window.location.origin);
        });
    }

    function toBytes(src: BufferSource): Uint8Array {
        if (src instanceof ArrayBuffer) return new Uint8Array(src);
        return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    }

    function b64url(src: BufferSource): string {
        const bytes = toBytes(src);
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    }

    function fromB64url(text: string): ArrayBuffer {
        const t = text.replace(/-/g, "+").replace(/_/g, "/");
        const s = atob(t + "===".slice((t.length + 3) % 4));
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out.buffer;
    }

    function define(obj: any, props: Record<string, any>) {
        for (const [k, v] of Object.entries(props)) Object.defineProperty(obj, k, { value: v, enumerable: true });
        return obj;
    }

    function makeCredential(r: any, response: any, json: any) {
        const cred = Object.create(w.PublicKeyCredential.prototype);
        return define(cred, {
            id: r.credentialId,
            rawId: fromB64url(r.credentialId),
            type: "public-key",
            authenticatorAttachment: "platform",
            response,
            getClientExtensionResults: () => ({ credProps: { rk: true } }),
            toJSON: () => json
        });
    }

    function attestationCredential(r: any) {
        const response = Object.create(w.AuthenticatorAttestationResponse.prototype);
        define(response, {
            clientDataJSON: fromB64url(r.clientDataJSON),
            attestationObject: fromB64url(r.attestationObject),
            getTransports: () => ["internal", "hybrid"],
            getAuthenticatorData: () => fromB64url(r.authenticatorData),
            getPublicKey: () => fromB64url(r.publicKey),
            getPublicKeyAlgorithm: () => -7
        });
        return makeCredential(r, response, {
            id: r.credentialId,
            rawId: r.credentialId,
            type: "public-key",
            authenticatorAttachment: "platform",
            clientExtensionResults: { credProps: { rk: true } },
            response: {
                clientDataJSON: r.clientDataJSON,
                attestationObject: r.attestationObject,
                authenticatorData: r.authenticatorData,
                publicKey: r.publicKey,
                publicKeyAlgorithm: -7,
                transports: ["internal", "hybrid"]
            }
        });
    }

    function assertionCredential(r: any) {
        const response = Object.create(w.AuthenticatorAssertionResponse.prototype);
        define(response, {
            clientDataJSON: fromB64url(r.clientDataJSON),
            authenticatorData: fromB64url(r.authenticatorData),
            signature: fromB64url(r.signature),
            userHandle: r.userHandle ? fromB64url(r.userHandle) : null
        });
        return makeCredential(r, response, {
            id: r.credentialId,
            rawId: r.credentialId,
            type: "public-key",
            authenticatorAttachment: "platform",
            clientExtensionResults: {},
            response: {
                clientDataJSON: r.clientDataJSON,
                authenticatorData: r.authenticatorData,
                signature: r.signature,
                userHandle: r.userHandle ?? null
            }
        });
    }

    function notAllowed() {
        return new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
    }

    credentials.create = async function (options?: CredentialCreationOptions): Promise<Credential | null> {
        const pk = options?.publicKey;
        if (!pk) return nativeCreate(options);
        try {
            if (!(pk.pubKeyCredParams ?? []).some(p => p.type === "public-key" && p.alg === -7)) return nativeCreate(options);
            if (pk.authenticatorSelection?.authenticatorAttachment === "cross-platform") return nativeCreate(options);
            if (!(await waitForBridge(1500))) return nativeCreate(options);
            const res = await ask("create", {
                rp: { id: pk.rp?.id ?? null, name: pk.rp?.name ?? "" },
                user: { id: b64url(pk.user.id), name: pk.user.name ?? "", displayName: pk.user.displayName ?? "" },
                challenge: b64url(pk.challenge),
                excludeCredentials: (pk.excludeCredentials ?? []).map(c => b64url(c.id))
            }, options.signal);
            if (res.result === "ok") return attestationCredential(res.credential);
            if (res.result === "excluded") throw new DOMException("The authenticator already contains a credential for this account.", "InvalidStateError");
            if (res.result === "cancel") throw notAllowed();
            if (res.result === "security") throw new DOMException("The relying party ID is not allowed for this origin.", "SecurityError");
            return nativeCreate(options);
        } catch (e) {
            if (e instanceof DOMException) throw e;
            return nativeCreate(options);
        }
    };

    // Signal API: Meldung an KeePassFerry (ohne auf eine Antwort zu warten) und unverändert an den Browser,
    // damit auch Windows/andere Passwortmanager sie erhalten. Ohne Browser-Unterstützung Prüfung wie im Standard.
    const PKC = w.PublicKeyCredential;
    const isB64url = (s: any) => typeof s === "string" && /^[A-Za-z0-9_-]*$/.test(s);
    const wrapSignal = (method: string, kind: string, check: (o: any) => boolean, pick: (o: any) => any) => {
        const native = typeof PKC[method] === "function" ? PKC[method].bind(PKC) : null;
        Object.defineProperty(PKC, method, {
            configurable: true,
            writable: true,
            value: async function (options: any) {
                if (!options || !check(options)) {
                    if (native) return native(options);
                    throw new TypeError("Invalid " + method + " options.");
                }
                const payload = { rpId: String(options.rpId), ...pick(options) };
                waitForBridge(1500).then(ok => {
                    if (ok) window.postMessage({ channel: CHANNEL, dir: "toBridge", type: "signal", kind, payload }, window.location.origin);
                });
                if (native) return native(options);
                return undefined;
            }
        });
    };
    wrapSignal("signalUnknownCredential", "unknown",
        o => typeof o.rpId === "string" && isB64url(o.credentialId),
        o => ({ credentialId: o.credentialId }));
    wrapSignal("signalAllAcceptedCredentials", "allAccepted",
        o => typeof o.rpId === "string" && isB64url(o.userId) && Array.isArray(o.allAcceptedCredentialIds) && o.allAcceptedCredentialIds.every(isB64url),
        o => ({ userId: o.userId, allAcceptedCredentialIds: o.allAcceptedCredentialIds.slice(0, 1000) }));
    wrapSignal("signalCurrentUserDetails", "userDetails",
        o => typeof o.rpId === "string" && isB64url(o.userId) && typeof o.name === "string",
        o => ({ userId: o.userId, name: String(o.name).slice(0, 256), displayName: String(o.displayName ?? "").slice(0, 256) }));

    credentials.get = async function (options?: CredentialRequestOptions): Promise<Credential | null> {
        const pk = options?.publicKey;
        if (!pk || (options as any).mediation === "conditional") return nativeGet(options);
        try {
            if (!(await waitForBridge(1500))) return nativeGet(options);
            const res = await ask("get", {
                rpId: pk.rpId ?? null,
                challenge: b64url(pk.challenge),
                allowCredentials: (pk.allowCredentials ?? []).map(c => b64url(c.id))
            }, options.signal);
            if (res.result === "ok") return assertionCredential(res.credential);
            if (res.result === "cancel") throw notAllowed();
            if (res.result === "security") throw new DOMException("The relying party ID is not allowed for this origin.", "SecurityError");
            return nativeGet(options);
        } catch (e) {
            if (e instanceof DOMException) throw e;
            return nativeGet(options);
        }
    };
})();
