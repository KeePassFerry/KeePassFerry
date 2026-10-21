# Changelog

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
