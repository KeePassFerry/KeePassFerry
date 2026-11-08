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
It bundles **Jayrock** (JSON-RPC, LGPL v3 or later) as in the original.

## Password Manager Resources (Apple)
The password rules, change-password addresses and groups of domains sharing one login in
[`extension/src/common/siteData/appleQuirks.json`](extension/src/common/siteData/appleQuirks.json) are taken from
**Password Manager Resources** (<https://github.com/apple/password-manager-resources>), licensed under the
**MIT License**:

> Copyright 2020 - 2026 Apple Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation
> the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
> to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of
> the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
> THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
> IN THE SOFTWARE.

The data is updated with `extension/scripts/update-site-data.ts` from a fixed commit of that repository.

## Public Suffix List (Mozilla)
[`extension/src/common/siteData/public_suffix_list.dat`](extension/src/common/siteData/public_suffix_list.dat) is the
**Public Suffix List** (<https://publicsuffix.org>), included unchanged and licensed under the
**Mozilla Public License 2.0** (<https://mozilla.org/MPL/2.0/>). It is parsed with **publicsuffixlist.js** by
Raymond Hill (Apache License 2.0, via npm). The list is updated with `extension/scripts/update-public-suffix-list.ts`.

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
