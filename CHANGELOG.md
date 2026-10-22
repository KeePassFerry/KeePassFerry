# Changelog

## 1.0.4 – 2026-10-22

- Windows setup (`KeePassFerry-Setup.exe`): finds KeePass, installs the plugin into `Plugins\KeePassFerry`, closes
  and restarts KeePass if needed, and offers to open the browser extension's store page for each installed browser.
- KeePass menu "KeePassFerry" with "Options …" and "Check for updates …"; KeePass's own update check now knows
  KeePassFerry.
- The plugin reports its version to the extension. If the plugin is older than the extension (the store only
  updates the extension), the popup shows a notice with "Update now": the plugin downloads the setup from the
  GitHub release and installs it only if the checksum list is signed with the KeePassFerry release key (RSA 3072,
  kept offline), names a newer version than the installed one and matches the downloaded file. Downloads follow
  redirects only via HTTPS to github.com and githubusercontent.com. Releases are published only after signing.
- Welcome page with a download button for the setup and updated installation steps.
- Settings: new icons and colours, consistent with the popup.

## 1.0.3 – 2026-10-22

- New settings section "KeePassFerry": fill one-time codes automatically, detect two-factor setup, passkeys with
  KeePassFerry, show icons in input fields, unlock a locked database immediately (off by default), turn off Edge's
  password saving (previously always on).
- One-time codes are no longer filled into fields for codes sent by SMS, e-mail or WhatsApp (detected from the page
  text); the icon still allows filling the app code on demand.
- Network authentication dialog redesigned; install page uses the new theme.
- No more "What's new" page after updates (the old Kee page advertised Kee Vault).
- Removed the leftover Kee Vault integration, SRP pairing and old Kee pages; the toolbar no longer blinks when
  offering to save (the page notice replaces it).

## 1.0.2 – 2026-10-21

- New popup design: one flat surface, entry rows instead of cards, consistent Tabler icons, compact notices,
  actions in the footer; edit and group selection as separate pages with a fixed save bar; redesigned password
  generator and two-factor setup dialog. Light and dark theme.
- Edit an entry: add a recovery code, two-factor key, note, custom field or image (paste with Ctrl+V); list and
  remove additional fields and attachments; everything is applied with a single "Save".
- Popup: "Fill into page" next to copy for username, password and one-time code.
- Login field detection like Chromium: `autocomplete`, the last text field before the password field, or a single
  login-like field in the first step of multi-step logins. No more field icons on name, IBAN or settings fields;
  no save prompt for forms without a password.
- Locked database: no automatic Windows Hello prompt any more. Login and code fields show a lock icon; clicking it
  or the toolbar icon unlocks and then fills. The toolbar icon shows the same lock.
- One-time codes: split code boxes (one digit per field) are filled, with the validity ring next to them; the code
  of the right account when several accounts share a site; QR codes inside iframes are recognised; live tooltip.
- Field icons stay clear of site buttons (e.g. password reveal) and hide when covered by a dialog or panel.
- Fixed: popup showed old data after editing an entry.
- Store listing in German and English; outdated Kee translations removed.
- Plugin: new methods to add text fields, list and remove fields and attachments (with entry history).

## 1.0.1 – 2026-10-21

- Plugin: the extension from Microsoft Edge Add-ons may connect (ID `ghkhbdnhojpeibdjdlgojfdjhedapmhg`), in
  addition to the unpacked developer build. Install this plugin version before installing the extension from the store.

## 1.0.0 – 2026-10-21

First release of KeePassFerry (fork of Kee 4.1 and KeePassRPC 2.0.2).

- Native messaging and a per-user named pipe instead of a WebSocket port; only the bundled host may connect.
- New secure channel: ECDH P-256, HKDF-SHA-256, AES-256-GCM, replay protection, pairing with a six-digit code
  confirmed in KeePass. Reset pairing in the settings.
- One-time codes (TOTP, RFC 6238; `otpauth://` and KeePass `TimeOtp-*` fields): automatic fill, floating icon with
  validity ring, copy in the popup, setup from QR code or secret into the right existing entry.
- Passkeys (WebAuthn, ES256) stored in KeePassXC-compatible fields, preferably in the existing login entry;
  WebAuthn Signal API (removed passkeys, renamed accounts).
- Background unlock: a login page, an icon click or a field icon triggers only the Windows Hello prompt, brought
  to the foreground with focus.
- Selecting an entry among several matches fills username and password.
- Screenshots pasted with Ctrl+V are compressed and stored as entry attachments.
- No save prompt when the submitted data already exists in KeePass (including multi-step logins).
- Redesigned popup, settings, matching-logins list and dialogs; light and dark theme; German and English texts.
- Optional diagnostic log (no secrets).
