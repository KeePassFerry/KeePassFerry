# Tests

Automated tests run on every push to `main` and on every pull request (`.github/workflows/tests.yml`), and again
before every release is packaged (`.github/workflows/release.yml`). A failing test fails the job.
They use only generated keys and disposable test data, never real credentials or databases.

## Extension (Vitest)

`extension/src/tests/`, run with `cd extension && npx vitest run`. Covers form and field detection, saving, TOTP,
password rules, related domains, regression cases from real pages and more. `channelVectors.test.ts` checks the same
channel vectors as the plugin tests below (keys, first message, pairing codes), computed with WebCrypto.

## Plugin and host (`tests/KeePassFerry.Tests`)

Requirements: Windows, .NET Framework 4.8, the plugin built in Release, `KeePass.exe` in `%USERPROFILE%\KeePassDEV`
(as for the plugin build) and, for the interop tests, `extension/node_modules` (`npm ci`).

```
msbuild plugin/KeePassFerry/KeePassFerry.csproj -p:Configuration=Release
dotnet test tests/KeePassFerry.Tests
```

KeePass is only used as a library (configuration, KeePassLib); no KeePass window is opened. The pairing confirmation,
a dialog in KeePass, is passed to `SecureChannel.Accept` as a function, as the plugin does; the plugin has no way to
skip it.

| Area | What is checked |
| --- | --- |
| Cryptography (`FerryCryptoTests`) | HKDF-SHA-256 against RFC 5869 test cases; AES-256-GCM via Windows CNG against the GCM spec test cases 13–16; every modified byte, wrong key, nonce or AAD and truncated input is rejected; nonce layout; P-256 key import/export; shared channel vectors (same values as the Vitest test) |
| Channel (`SecureChannelTests`) | Handshake over a real named pipe: first pairing with the same code on both sides (protocol with and without commit), reconnect without pairing, stable server identity across restarts, changed client key needs pairing again, declined pairing and cooldown, invalid or foreign client signature, wrong commit nonce, malformed hello (version, ID, key and nonce lengths, point not on the curve, not JSON, too large), disconnect and timeout during the handshake; after the handshake: replay, skipped or reordered counters, swapped counter, tampered ciphertext, reflected server message, plaintext and malformed frames |
| Server identity (`FerryIdentityTests`) | Server key stored DPAPI-protected and reloaded, unreadable key replaced, signatures verify, paired browsers stored, renamed and removed, one pairing dialog at a time |
| Framing (`TransportAndFramingTests`) | Plugin pipe and host: length prefix, partial reads, size limit before and after the handshake, negative lengths, truncated messages, clean close; host splits answers over 900 KB into chunks for the browser and they reassemble exactly; host commands are recognised only exactly |
| Passkeys (`PasskeyCryptoTests`) | Attestation object and authenticator data decoded with an independent CBOR reader (RP ID hash, flags, counter, credential ID, COSE key = SPKI); ES256 signatures verified independently for many keys; bound to the RP ID; DER encoding edge cases; private key saved in and reloaded from a disposable `.kdbx` |
| Interop (`ExtensionInteropTests`) | The extension's real channel client (`FerryChannel.ts`, via `extension/scripts/ferry-channel-test.ts` in Node) against the plugin's real server: pairing with the same code, a request and answer, reconnect, tampered message rejected, changed server key rejected by the extension, declined pairing; passkey signatures verified with WebCrypto as a website does (`extension/scripts/passkey-verify.ts`) |

Without Node or `extension/node_modules` the interop tests are reported as not run (inconclusive); in CI
`KPF_REQUIRE_INTEROP=1` makes them fail instead.

## Not covered automatically

These parts need a running KeePass with its window and an opened database, the installed host or a browser. They
are tested by hand before releases that change them:

- JSON-RPC methods of `FerryService` that read or change entries (search, fill, save, passkey create/find over RPC).
  They run on the KeePass UI thread and save through the main window.
- The pairing dialog and other KeePass windows, Windows Hello.
- `NativePipeServer`: the pipe for the current Windows user, its access rules and the check that only the registered
  `KeePassFerryHost.exe` may connect. On a developer machine that pipe belongs to the running KeePass.
- The host as a process between browser and KeePass (stdin/stdout, reconnects, starting KeePass).
- The extension inside Chrome, Edge and Firefox.

For the manual channel and passkey tests against a test database in KeePass, see `extension/scripts/ferry-channel-test.ts`
and `extension/scripts/passkey-test.ts`.
