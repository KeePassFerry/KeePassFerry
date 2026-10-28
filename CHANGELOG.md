# Changelog

## 1.0.10 – 2026-10-28

- Context menu: right-clicking into any input field lists the matching entries; for each entry the username,
  password, one-time code or any custom field can be inserted into exactly that field (values are fetched from
  KeePass only on click). Works on pages without a detected login form too, e.g. security questions after login.
- Context menu is updated as soon as a page reports its matches (also after saving the database), no reload needed.
- Password generator opened by right-clicking into a field: new "Insert" button fills the password into that field.
- Custom fields: protection ("Protected") can be switched on or off when editing a field in the popup (requires the
  plugin of this version). New custom fields are unprotected by default; recovery codes stay protected.
- Uninstaller: closes a running KeePass (after the confirmation, KeePass asks about unsaved changes) and the
  connection helper started by the browser, so the plugin files are removed without a restart.

## 1.0.9 – 2026-10-27

- Setup: the uninstall entry in Windows now points to the plugin folder instead of the KeePass folder. Third-party
  uninstallers (e.g. HiBit, Revo) offered the whole KeePass folder as leftovers after uninstalling KeePassFerry.
- Results list: entries with a passkey or a one-time code (OTP) are marked with a small icon.
- Passkey dialog: entry title and username are shown in full, notes such as "has a passkey" below them.
- Popup: up to 30 entries for the current site.

## 1.0.8 – 2026-10-24

- Related domains: an entry for one domain of a provider is also offered on its other domains, e.g. outlook.com on
  login.live.com (Microsoft, Google, Apple, Amazon, eBay, PayPal, Ubiquiti, Proton, Atlassian, X and others). Such
  matches come after direct ones and are marked "Related domain: …". Multi-page sign-ins keep the entry chosen on
  the first page across these domains (e.g. login.microsoftonline.com → login.live.com), also for one-time codes.
- Network sign-in window redesigned: site in the header, entries as cards, "Enter manually" button.
- Plugin update from the browser no longer blocks the connection: the plugin answers at once and runs download,
  signature check and setup in KeePass, which comes to the front so the Windows prompt is visible; update steps are
  written to the diagnostic log. For plugins before 1.0.8 the button opens the release page instead.
- Windows notifications show the actual notice and open the popup when clicked.
- Edit window: username and password can no longer be removed, removing other detected fields is only marked until
  "Save"; fixed the edit window changing the entry shown in the results list.
- Settings: missing texts for the website search field.

## 1.0.7 – 2026-10-24

- Notes, custom fields (e.g. recovery codes) and attachments of an entry are shown in the expanded entry and in the
  edit window; the list marks entries with notes or attachments. A click on the text opens a preview (images, notes,
  protected values only on request); images, PDF, text and notes can be opened with the default Windows app (via the
  plugin: encrypted, read-only temporary copy that is deleted after two minutes, on lock and on exit).
- Edit window: notes and custom fields can be edited and removed, pasted images can be named and renamed; all changes
  are applied with "Save". Removing additionally detected fields is only marked until "Save" (undo possible);
  username and password can no longer be removed. Saving only additions no longer leaves the popup in edit mode.
- Paste from the clipboard by button instead of a global Ctrl+V; the optional clipboard permission is granted in the
  settings. Editing an entry keeps its URLs and fields and no longer shows the "different website" warning.
- Saving: the same username rule as for filling (no more "full name" as username), the site name as entry title.
- Matched logins list: width from the longest entry, full text as tooltip.
- One-time codes: no filling into hidden fields (e.g. inside a collapsed section), the same code is never filled in
  automatically twice on the same page (pages that submit by themselves and reload no longer loop), code fields
  that appear later (expanded section, dialog) are found, and the field icon is also shown for code inputs placed
  over drawn digit boxes. A found but unsaved two-factor key is offered again when the popup is opened.
- Tooltips on all icon buttons, missing texts in the settings added.
- The extension needs plugin 1.0.7 (new functions for attachments and notes); older plugins get the update notice.

## 1.0.6 – 2026-10-22

- Google Chrome: the plugin accepts the KeePassFerry extension from the Chrome Web Store; the setup offers to open
  its store page for Chrome as well.
- Extension manifest uses paths without a leading `./` (required by the Chrome Web Store).

## 1.0.5 – 2026-10-22

- KeePass shows KeePassFerry everywhere instead of Kee: new options window (save behaviour, paired browsers with
  "Remove pairing", version and update check), entry/group/database tabs and dialogs in German and English with
  KeePassFerry icons. The group tab shares a group with the browser; sharing the top group means the whole database.
  Generated password backups are stored in "KeePassFerry – generated passwords".
- Removed the unreachable Kee sign-in (SRP), Kee welcome and new-database dialogs and locations; connections are
  only accepted over the paired, encrypted channel. Plugin settings use their own `KeePassFerry.*` keys.
- KeePass's own update check verifies the signature of `version.txt` (release key).
- Setup: starts KeePass again after installing (also for one-click updates); uninstaller in the plugin folder with
  the KeePassFerry icon.
- Extension: unused Kee files, styles and texts removed, one permission less (`unlimitedStorage`), smaller package
  (no source maps); unit tests run again.

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
