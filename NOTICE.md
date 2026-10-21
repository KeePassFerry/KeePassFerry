# Notice / Würdigung

KeePassFerry is a fork. It would not exist without the work of the original authors.

## Kee browser extension
The browser extension in [`extension/`](extension/) is based on **Kee** by Kee Vault Ltd and contributors
(<https://github.com/kee-org/browser-addon>), licensed under the **GNU Affero General Public License v3**
(see [`extension/LICENSE`](extension/LICENSE)). The fork point is commit `dd2b26c`.

## KeePassRPC
The KeePass plugin in [`plugin/`](plugin/) is based on **KeePassRPC** by Chris Tomlinson and contributors
(<https://github.com/kee-org/keepassrpc>), licensed under the **GNU General Public License v2**
(see [`plugin/LICENSE`](plugin/LICENSE)). The fork point is commit `17d1728`.
It bundles **Jayrock** (JSON-RPC, MIT licence) as in the original.

## Trademarks
"Kee" and "Kee Vault" are trademarks of Kee Vault Ltd. KeePassFerry is an independent project and is not
affiliated with or endorsed by Kee Vault Ltd or by the KeePass project. "KeePass" refers to
KeePass Password Safe by Dominik Reichl (<https://keepass.info>).

## What changed
KeePassFerry replaces the WebSocket transport with native messaging and a per-user named pipe, replaces the
SRP/AES-CBC session with a new authenticated channel (ECDH P-256, HKDF-SHA-256, AES-256-GCM, pairing code),
and adds one-time codes (TOTP), passkeys (WebAuthn), background unlock via Windows Hello and a redesigned
user interface. Ideas were taken from other open-source password managers (KeePassXC-Browser, KeePassPasskey,
Bitwarden); no code from those projects was copied.

---

KeePassFerry ist ein Fork von **Kee** (Kee Vault Ltd, AGPL v3) und **KeePassRPC** (Chris Tomlinson, GPL v2).
Herzlichen Dank an die ursprünglichen Autoren.
