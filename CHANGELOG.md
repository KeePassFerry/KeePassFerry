# Changelog

English · [Deutsch](#deutsch)

## Unreleased

- Password generator: on websites with known password rules (e.g. 5–8 characters, only certain special characters)
  the profile "Suitable for <site>" is preselected and generates a password the website accepts; the rules are shown
  as small chips. Rules from Apple's Password Manager Resources (MIT licence, bundled, no network access).
- "Change password on the website": a key button at an expanded entry opens the website's change-password page
  (from Apple's list, otherwise the standard address /.well-known/change-password if the website supports it).
- Check passwords for data breaches (Security, optional, off by default): when turned on, KeePass checks all
  passwords at "Have I Been Pwned" in the background, new and changed ones right away, the others again every 30 days
  and everything once more after turning the check back on; only the first 5 characters of a checksum (SHA-1) are
  sent, never the password. The result is written to the same field and format as the KeePass plugin "HIBP Offline
  Check" (both understand each other). Affected entries show a red warning with a "Change password" button; the
  settings show progress, the time of the last check and connection problems. No Windows notifications. With the
  check turned off, KeePassFerry shows no warnings. Requires the plugin of this version.
- News and tips in the popup (✨ in the footer): what's new in this version, earlier versions to expand and tips for
  what is still missing (e.g. Windows Hello, breach check). After an update a notice appears once.
- Faster popup on sites with many related domains (e.g. Amazon's country sites): the plugin no longer re-reads each
  entry's settings for every searched address (search over 18 Amazon domains: about 1.2 s → 80 ms).
- Two-factor setup: a QR code in a collapsed part of the page (e.g. Amazon before choosing "Authenticator app") is
  no longer detected; it is detected as soon as it becomes visible. The "Two-factor key found" notice appears once
  per page and key, and a key found on a page is discarded when the page is reloaded or left (many sites create a
  new key each time, so the popup no longer offers an outdated key). A key found on the current page survives a
  restart of the extension's background.
- Settings: the sections are in the same order as in the navigation.
- Removed the option "Unlock a locked database immediately" (issue #11): it asked for Windows Hello as soon as a
  page contained a login form, also on sites where you are already signed in (hidden login forms). A locked database
  is unlocked by clicking the lock icon in the field or the toolbar icon, as before.
- The group for backups of generated passwords is now created as "Generated passwords" (before: "KeePassFerry –
  generated passwords"; issue #12). Existing groups keep their name; they can be renamed freely in KeePass.
- Entries with an expiry date in KeePass ("Expires", issue #10): new setting "Expired entries" (Finding entries).
  "Remind me to change the password" (default) keeps filling them in and shows a notice on the page right after
  filling in and in the popup, before the date (advance warning adjustable, default 7 days) and after it, with a link
  to the site's change-password page; "Later" hides it for that entry until the next day. "Hide" no
  longer suggests, fills in or finds expired entries; the advance warning then says that the entry will be hidden.
  When saving or updating an entry, "Expires" offers a new period (1 week to 1 year, or never), like the presets in
  KeePass. Entries without an expiry date are not affected. Requires the plugin of this version.
- Two-factor keys: when KeePassFerry saves a new key into an entry that still has KeePass's own `TimeOtp-*` fields,
  these are removed (the old state stays in the entry history). Before, the entry ended up with two different keys,
  and KeePass's {TIMEOTP} / Ctrl+T used the old one. Requires the plugin of this version.

## 1.0.14 – 2026-11-01

- "Edit entry" window: new "Delete entry" button. After a confirmation the entry is moved to the KeePass recycle bin
  (never deleted permanently; it can be restored in KeePass). If the recycle bin is turned off in the database,
  nothing is deleted and the extension asks you to delete the entry in KeePass. Requires the plugin of this version.
- Passkeys: registering a passkey on GitHub failed ("Passkey registration failed"). The passkey object returned to the
  page now has writable properties like a native one, so pages that adjust it (e.g. GitHub's webauthn-json) work.
- Right-click menu of an entry: the items are now simply "Username", "Password" and "One-time code" (without "Insert").
- Security hardening (thanks to the review in issue #9):
  - Once the extension is paired with a KeePass, it no longer connects to a different, unknown KeePass; to switch,
    reset the pairing in the settings. A new KeePass is only remembered after the pairing with verification code.
  - Logins saved for https are no longer filled or submitted automatically on an unencrypted http page of the same
    site (choosing the entry manually still works).
  - One-click update: the downloaded setup is locked against changes and its checksum is verified again on disk
    right before it is started.
  - Pipe: messages before the encrypted channel is established are limited to 64 KB, an unfinished handshake is
    closed after 5 minutes, and at most 16 connections are accepted at the same time.
  - The developer extension ID is no longer allowed by default (only with `KeePassFerry.AllowDevExtension` set to
    true in KeePass.config.xml, for loading the extension unpacked).
  - Pairing: the verification code now also depends on a secret random value that the extension commits to (by
    hash) before KeePass answers and reveals only afterwards. Someone in between can no longer search for values that
    make both sides show the same code. Existing pairings are not affected; a new pairing requires the plugin of this
    version (an older plugin is asked to update first).
  - Two-factor setup from a QR image: images from other origins than the page are loaded without cookies.
  - Release build: third-party GitHub Actions pinned to commit SHAs, Inno Setup to a fixed version.
  - Filling the browser's own sign-in dialogs (HTTP basic authentication, proxy) is now off by default, because such
    dialogs can also be triggered by embedded third-party content. Turn it on in the settings under "Network
    authentication" if you need it (e.g. for a router or NAS).
  - Removed an unused Kee leftover script.

## 1.0.13 – 2026-11-01

- Right-click on selected text → "Add "…" to entry": opens the familiar "Edit entry" window with "Add" expanded and
  the selection (complete, including line breaks) as content; choose recovery code, two-factor key, note or custom
  field there. The entry last used in the tab is opened directly; otherwise choose an entry from the matches of the
  page, search all entries, or create a new entry for the page (it is only created in KeePass on "Save"; "Cancel"
  leaves nothing behind). The selected text is kept when switching the kind. If the database is locked, this
  deliberate click asks for the unlock first.
  A new entry can be placed in any group (preselected: the group used last, otherwise the database root).
- "Add" in the edit window: kinds sorted alphabetically, "Custom field" preselected.
- Group tree ("Where?" and the group of a new entry) redesigned: one line per group, collapsible, the chosen group
  marked; only the top level and the path to the chosen group start expanded.
- Changed password: if the login details just entered belong to an existing entry (same username) but the password
  differs, the notice "New password detected" offers to update that entry instead of saving a second one; "Update …"
  opens it with the new password prefilled (the old one is kept in the entry history). Only offered once no login form
  is visible any more (a failed login, e.g. a typo, is not offered) and while the database is unlocked; a different
  username with the same password still counts as another account. A later successful login with the saved password
  withdraws an earlier offer for a mistyped one.
- Two-factor notice on the page: the button now reads "Save …" like the login notice, so both buttons fit in one line.
- "Save …" and "Update …" in the page notice open the dialog directly even if an entry was saved in the popup less than
  two minutes earlier (until now only the main view with "You recently saved an entry" appeared).
- Sites that replace the password in the field with asterisks right after sending it (e.g. some banks) no longer
  trigger "New password detected". On such sites a really changed password cannot be detected either; update the
  entry yourself.
- Multi-step login: the entry carried over from the username page is now remembered together with its database, so a
  changed password on the password page is offered as "New password detected" instead of "Save login".
- Saving login details: a further login attempt on the same page is recognised again (e.g. after "wrong password"
  without the page reloading); before, only the first, mistyped attempt was offered for saving.
- The "Save login" notice only appears on pages of the website where the details were entered, no longer on other
  websites opened later in the same tab.
- Editing an entry with the pencil right after logging in keeps the entry's title (it was replaced by the page title),
  and editing no longer changes the group preselected for new entries.
- Removed: the extra Windows notification for the first save offers and the 90-second pause of save notices after
  editing an entry.
- Security: the extension's scripts inside web pages (including third-party frames) no longer receive the full
  internal state. Passwords in the save and edit window, generated passwords, search results, notifications and the
  database tree with all entries stay in the background, the popup and the extension's own panels; pages only get the
  connection state and the names of the open databases.
- "Two-factor key found" notice no longer appears when the key on the page is already stored in a matching entry:
  the extension compares the entry's current code with a code it computes locally from the found key (the key is
  never sent to KeePass); the code is then filled in as usual. Only checked while the database is unlocked; a key
  found while it is locked or before KeePass is connected (e.g. right after the browser starts) is checked as soon as
  the database is available, and the notice then disappears.

## 1.0.12 – 2026-10-28

- Right-click menu no longer asks KeePass to unlock a locked database: while locked it does not query KeePass at all
  (since 1.0.11 every page load or tab switch triggered the unlock prompt). Once the database has been unlocked, e.g.
  by clicking the toolbar icon, the menu is rebuilt with the matching entries.

## 1.0.11 – 2026-10-28

- Right-click menu also lists the matching entries on pages without any login form (e.g. a page with only a search
  field); it is rebuilt on every page load in the active tab.
- Extension: shows "New version for KeePass available" with "Update now" when the plugin is older than the version
  recommended for this extension (not just when it is no longer compatible). No network request is needed for this.
- Update from KeePass: after the restart a Windows notification reports the result (version old → new, click opens
  the changes), without blocking the unlock prompt; a failed update is reported as well.
- Browser registration (native messaging host) is checked again when a database is opened and every 15 minutes and
  repaired if something removed it, e.g. a cleanup tool.

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

---

# Deutsch

## Unveröffentlicht

- Passwort-Generator: Auf Websites mit bekannten Passwortregeln (z. B. 5–8 Zeichen, nur bestimmte Sonderzeichen) ist
  das Profil „Passend für <Website>“ vorausgewählt und erzeugt ein Passwort, das die Website annimmt; die Regeln stehen
  als kleine Chips darunter. Regeln aus Apples „Password Manager Resources“ (MIT-Lizenz, mitgeliefert, kein Netzzugriff).
- „Passwort auf der Website ändern“: Ein Schlüssel-Knopf am aufgeklappten Eintrag öffnet die Seite zum Ändern des
  Passworts (aus Apples Liste, sonst die Standardadresse /.well-known/change-password, wenn die Website sie unterstützt).
- Passwörter auf Datenlecks prüfen (Sicherheit, optional, standardmäßig aus): Eingeschaltet prüft KeePass im
  Hintergrund alle Passwörter bei „Have I Been Pwned“, neue und geänderte sofort, die übrigen alle 30 Tage erneut und
  nach dem Wiedereinschalten alles noch einmal; gesendet werden nur die ersten 5 Zeichen einer Prüfsumme (SHA-1), nie
  das Passwort. Ergebnis im selben Feld und Format wie beim KeePass-Plugin „HIBP Offline Check“ (beide verstehen sich).
  Betroffene Einträge zeigen eine rote Warnung mit dem Knopf „Passwort ändern“; die Einstellungen zeigen Fortschritt,
  Zeitpunkt der letzten Prüfung und Verbindungsprobleme. Keine Meldungen in Windows. Bei ausgeschalteter Prüfung zeigt
  KeePassFerry keine Warnungen. Erfordert das Plugin dieser Version.
- Neuigkeiten und Tipps im Popup (✨ in der Fußleiste): Neuerungen der Version, frühere Versionen zum Aufklappen und
  Tipps für das, was noch fehlt (z. B. Windows Hello, Prüfung auf Datenlecks). Nach einem Update einmal ein Hinweis.
- Schnelleres Popup auf Websites mit vielen zugehörigen Domains (z. B. Amazons Länderseiten): Das Plugin liest die
  Einstellungen eines Eintrags nicht mehr für jede gesuchte Adresse neu ein (Suche über 18 Amazon-Domains: etwa 1,2 s →
  80 ms).
- Zwei-Faktor-Einrichtung: Ein QR-Code in einem zugeklappten Teil der Seite (z. B. bei Amazon, bevor
  „Authentifizierungs-App“ gewählt ist) wird nicht mehr erkannt, sondern erst, sobald er sichtbar ist. Der Hinweis
  „Zwei-Faktor-Schlüssel gefunden“ erscheint einmal je Seite und Schlüssel; ein gefundener Schlüssel wird beim Neuladen
  oder Verlassen der Seite verworfen (viele Websites erzeugen dann einen neuen, das Popup bietet so keinen veralteten
  mehr an). Ein Fund auf der aktuellen Seite übersteht einen Neustart des Hintergrunds der Erweiterung.
- Einstellungen: Die Abschnitte stehen in derselben Reihenfolge wie in der Navigation.
- Option „Bei gesperrter Datenbank sofort entsperren“ entfernt (Issue #11): Sie fragte nach Windows Hello, sobald eine
  Seite ein Anmeldeformular enthielt, auch auf Websites, bei denen man längst angemeldet ist (versteckte Formulare).
  Entsperrt wird wie bisher per Klick auf das Schloss-Symbol im Feld oder auf das Erweiterungssymbol.
- Die Gruppe für Sicherungen generierter Passwörter heißt bei neuen Datenbanken „Generierte Passwörter“ (bisher
  „KeePassFerry – generierte Passwörter“; Issue #12). Bestehende Gruppen behalten ihren Namen und lassen sich in
  KeePass beliebig umbenennen.
- Einträge mit Ablaufdatum in KeePass („Gültig bis“, Issue #10): neue Einstellung „Abgelaufene Einträge“ (Einträge
  finden). „An Passwortwechsel erinnern“ (Standard) füllt weiter aus und zeigt direkt nach dem Ausfüllen auf der Seite
  und im Popup einen Hinweis, vor dem Datum (Vorwarnung einstellbar, Standard 7 Tage) und danach, mit Link zur
  Änderungsseite der Website; „Später“ blendet ihn für diesen Eintrag bis zum nächsten Tag aus. „Ausblenden“
  schlägt abgelaufene Einträge nicht mehr vor, füllt sie nicht aus und findet sie nicht; die Vorwarnung
  sagt dann, dass der Eintrag danach ausgeblendet wird. Beim Speichern oder Aktualisieren bietet „Gültig bis“ einen
  neuen Zeitraum (1 Woche bis 1 Jahr oder kein Ablauf), wie die Vorgaben in KeePass. Einträge ohne Ablaufdatum sind
  nicht betroffen. Erfordert das Plugin dieser Version.
- Zwei-Faktor-Schlüssel: Speichert KeePassFerry einen neuen Schlüssel in einen Eintrag, der noch KeePass-eigene
  `TimeOtp-*`-Felder hat, werden diese entfernt (der alte Stand bleibt in der Chronik). Bisher standen danach zwei
  verschiedene Schlüssel im Eintrag, und KeePass' {TIMEOTP} bzw. Strg+T nahm den alten. Erfordert das Plugin dieser
  Version.

## 1.0.14 – 2026-11-01

- Fenster „Eintrag bearbeiten“: neuer Knopf „Eintrag löschen“. Nach einer Rückfrage wandert der Eintrag in den
  Papierkorb von KeePass (nie endgültig gelöscht, in KeePass wiederherstellbar). Ist der Papierkorb in der Datenbank
  ausgeschaltet, wird nichts gelöscht und die Erweiterung bittet, den Eintrag in KeePass zu löschen. Erfordert das
  Plugin dieser Version.
- Passkeys: Das Registrieren eines Passkeys bei GitHub schlug fehl („Passkey registration failed“). Das an die Seite
  zurückgegebene Passkey-Objekt hat jetzt wie ein echtes änderbare Eigenschaften; Seiten, die es anpassen (z. B.
  GitHubs webauthn-json), funktionieren.
- Rechtsklick-Menü eines Eintrags: Die Punkte heißen jetzt einfach „Benutzername“, „Passwort“ und „Einmalcode“ (ohne
  „einfügen“).
- Mehr Sicherheit (Dank an die Prüfung in Issue #9):
  - Ist die Erweiterung mit einem KeePass gekoppelt, verbindet sie sich mit keinem anderen, unbekannten KeePass mehr;
    zum Wechseln die Kopplung in den Einstellungen zurücksetzen. Ein neues KeePass wird erst nach der Kopplung mit
    Prüfcode gemerkt.
  - Für https gespeicherte Anmeldungen werden auf einer unverschlüsselten http-Seite derselben Website nicht mehr
    automatisch ausgefüllt oder abgeschickt (manuell auswählen geht weiterhin).
  - Update mit einem Klick: Das heruntergeladene Setup wird gegen Änderungen gesperrt und direkt vor dem Start auf der
    Platte erneut geprüft.
  - Pipe: Nachrichten vor dem Aufbau des verschlüsselten Kanals sind auf 64 KB begrenzt, ein unfertiger Handshake wird
    nach 5 Minuten getrennt, höchstens 16 Verbindungen gleichzeitig.
  - Die Entwicklungs-ID der Erweiterung ist nicht mehr standardmäßig zugelassen (nur mit
    `KeePassFerry.AllowDevExtension` = true in KeePass.config.xml, für die entpackt geladene Erweiterung).
  - Kopplung: Der Prüfcode hängt jetzt auch von einer geheimen Zufallszahl ab, auf die sich die Erweiterung (per Hash)
    festlegt, bevor KeePass antwortet, und die sie erst danach verrät. Wer sich dazwischenschaltet, kann so nicht mehr
    nach Werten suchen, die auf beiden Seiten denselben Code ergeben. Bestehende Kopplungen sind nicht betroffen; eine
    neue Kopplung braucht das Plugin dieser Version (ein älteres wird um ein Update gebeten).
  - Zwei-Faktor-Einrichtung aus einem QR-Bild: Bilder von anderen Adressen als der Seite werden ohne Cookies geladen.
  - Release-Build: fremde GitHub Actions auf Commit-SHAs festgelegt, Inno Setup auf eine feste Version.
  - Ausfüllen der Anmeldefenster des Browsers (HTTP-Basic-Auth, Proxy) ist jetzt standardmäßig aus, weil solche
    Fenster auch von eingebetteten fremden Inhalten ausgelöst werden können. Bei Bedarf (z. B. Router, NAS) in den
    Einstellungen unter „Netzwerkanmeldung“ einschalten.
  - Ungenutztes Kee-Skript entfernt.

## 1.0.13 – 2026-11-01

- Rechtsklick auf markierten Text → „„…“ zu Eintrag hinzufügen“: öffnet das bekannte Fenster „Eintrag bearbeiten“ mit
  aufgeklapptem „Hinzufügen“ und der Markierung (vollständig, mit Zeilenumbrüchen) als Inhalt; dort Wiederherstellungscode,
  Zwei-Faktor-Schlüssel, Notiz oder eigenes Feld wählen. Der zuletzt im Tab benutzte Eintrag öffnet sich direkt; sonst
  einen Eintrag aus den Treffern der Seite wählen, alle Einträge durchsuchen oder einen neuen Eintrag für die Seite
  anlegen (er entsteht in KeePass erst beim „Speichern“; „Abbrechen“ hinterlässt nichts). Der markierte Text bleibt beim
  Wechsel der Art erhalten. Bei gesperrter Datenbank fragt dieser bewusste Klick zuerst nach dem Entsperren.
  Ein neuer Eintrag kann in jede Gruppe (vorausgewählt: die zuletzt benutzte, sonst die oberste der Datenbank).
- „Hinzufügen“ im Bearbeiten-Fenster: Arten alphabetisch sortiert, „Eigenes Feld“ vorausgewählt.
- Gruppenbaum („Wohin?“ und Gruppe eines neuen Eintrags) neu gestaltet: eine Zeile je Gruppe, aufklappbar, die gewählte
  Gruppe markiert; anfangs nur die oberste Ebene und der Weg zur gewählten Gruppe aufgeklappt.
- Geändertes Passwort: Gehören die gerade eingegebenen Anmeldedaten zu einem vorhandenen Eintrag (gleicher
  Benutzername), aber das Passwort ist anders, bietet der Hinweis „Neues Passwort erkannt“ an, diesen Eintrag zu
  aktualisieren statt einen zweiten zu speichern; „Aktualisieren …“ öffnet ihn mit dem neuen Passwort (das alte bleibt in
  der Chronik des Eintrags). Nur, wenn kein Anmeldeformular mehr sichtbar ist (eine fehlgeschlagene Anmeldung, z. B.
  Tippfehler, wird nicht angeboten) und die Datenbank entsperrt ist; ein anderer Benutzername mit gleichem Passwort gilt
  weiter als anderes Konto. Eine spätere erfolgreiche Anmeldung mit dem gespeicherten Passwort zieht ein früheres Angebot
  für ein vertipptes zurück.
- Zwei-Faktor-Hinweis auf der Seite: Der Knopf heißt jetzt wie beim Anmelde-Hinweis „Speichern …“, beide Knöpfe passen
  in eine Zeile.
- „Speichern …“ und „Aktualisieren …“ im Seitenhinweis öffnen den Dialog direkt, auch wenn weniger als zwei Minuten zuvor
  im Popup ein Eintrag gespeichert wurde (bisher erschien nur die Hauptansicht mit „Du hast kürzlich einen Eintrag
  gespeichert“).
- Websites, die das Passwort im Feld gleich nach dem Absenden durch Sternchen ersetzen (z. B. manche Banken), lösen
  kein „Neues Passwort erkannt“ mehr aus. Auf solchen Seiten lässt sich auch ein wirklich geändertes Passwort nicht
  erkennen; dann den Eintrag selbst aktualisieren.
- Mehrstufige Anmeldung: Der von der Benutzernamen-Seite übernommene Eintrag wird samt Datenbank gemerkt, ein
  geändertes Passwort auf der Passwort-Seite erscheint so als „Neues Passwort erkannt“ statt „Anmeldung speichern“.
- Anmeldedaten speichern: Ein weiterer Anmeldeversuch auf derselben Seite wird wieder erkannt (z. B. nach „falsches
  Passwort“ ohne Neuladen); bisher wurde nur der erste, vertippte Versuch zum Speichern angeboten.
- Der Hinweis „Anmeldung speichern“ erscheint nur auf Seiten der Website, auf der die Daten eingegeben wurden, nicht
  mehr auf später im selben Tab geöffneten anderen Websites.
- Bearbeiten eines Eintrags mit dem Stift direkt nach der Anmeldung behält den Titel des Eintrags (er wurde durch den
  Seitentitel ersetzt), und Bearbeiten ändert nicht mehr die für neue Einträge vorausgewählte Gruppe.
- Entfernt: die zusätzliche Windows-Benachrichtigung bei den ersten Speicherangeboten und die 90-Sekunden-Pause der
  Speicherhinweise nach dem Bearbeiten eines Eintrags.
- Sicherheit: Die Skripte der Erweiterung in Webseiten (auch in fremden Frames) erhalten nicht mehr den vollständigen
  internen Zustand. Passwörter im Speichern- und Bearbeiten-Fenster, erzeugte Passwörter, Suchergebnisse,
  Benachrichtigungen und der Datenbankbaum mit allen Einträgen bleiben im Hintergrund, im Popup und in den eigenen
  Fenstern der Erweiterung; Seiten erhalten nur den Verbindungsstatus und die Namen der geöffneten Datenbanken.
- Der Hinweis „Zwei-Faktor-Schlüssel gefunden“ erscheint nicht mehr, wenn der Schlüssel der Seite schon in einem
  passenden Eintrag steht: Die Erweiterung vergleicht den aktuellen Code des Eintrags mit einem Code, den sie lokal aus
  dem gefundenen Schlüssel berechnet (der Schlüssel geht nie an KeePass); der Code wird dann wie gewohnt ausgefüllt.
  Geprüft nur bei entsperrter Datenbank; ein Schlüssel, der bei gesperrter Datenbank oder vor dem Verbinden mit KeePass
  gefunden wird (z. B. direkt nach dem Browserstart), wird geprüft, sobald die Datenbank verfügbar ist, und der Hinweis
  verschwindet dann.

## 1.0.12 – 2026-10-28

- Das Rechtsklick-Menü bittet KeePass nicht mehr, eine gesperrte Datenbank zu entsperren: Solange sie gesperrt ist,
  fragt es KeePass gar nicht (seit 1.0.11 löste jedes Laden einer Seite oder jeder Tabwechsel die Entsperrabfrage aus).
  Nach dem Entsperren, z. B. per Klick auf das Symbol, wird das Menü mit den passenden Einträgen neu aufgebaut.

## 1.0.11 – 2026-10-28

- Das Rechtsklick-Menü zeigt die passenden Einträge auch auf Seiten ohne Anmeldeformular (z. B. eine Seite mit nur
  einem Suchfeld); es wird bei jedem Laden einer Seite im aktiven Tab neu aufgebaut.
- Erweiterung: zeigt „Neue Version für KeePass verfügbar“ mit „Jetzt aktualisieren“, wenn das Plugin älter ist als die
  für diese Erweiterung empfohlene Version (nicht erst, wenn es nicht mehr passt). Dafür ist keine Netzabfrage nötig.
- Update aus KeePass: Nach dem Neustart meldet eine Windows-Benachrichtigung das Ergebnis (Version alt → neu, Klick
  öffnet die Änderungen), ohne die Entsperrabfrage zu blockieren; auch ein fehlgeschlagenes Update wird gemeldet.
- Die Registrierung im Browser (Native-Messaging-Host) wird beim Öffnen einer Datenbank und alle 15 Minuten geprüft und
  repariert, falls sie z. B. ein Aufräumprogramm entfernt hat.

## 1.0.10 – 2026-10-28

- Kontextmenü: Ein Rechtsklick in ein beliebiges Eingabefeld zeigt die passenden Einträge; je Eintrag lassen sich
  Benutzername, Passwort, Einmalcode oder jedes eigene Feld genau in dieses Feld einsetzen (die Werte kommen erst beim
  Klick aus KeePass). Funktioniert auch auf Seiten ohne erkanntes Anmeldeformular, z. B. bei Sicherheitsfragen nach der
  Anmeldung.
- Das Kontextmenü wird aktualisiert, sobald eine Seite ihre Treffer meldet (auch nach dem Speichern der Datenbank),
  ohne Neuladen.
- Per Rechtsklick in ein Feld geöffneter Passwort-Generator: neuer Knopf „Einsetzen“ trägt das Passwort in dieses Feld
  ein.
- Eigene Felder: Der Schutz („Geschützt“) lässt sich beim Bearbeiten eines Felds im Popup ein- und ausschalten
  (erfordert das Plugin dieser Version). Neue eigene Felder sind standardmäßig ungeschützt; Wiederherstellungscodes
  bleiben geschützt.
- Deinstallation: beendet ein laufendes KeePass (nach der Rückfrage fragt KeePass nach ungespeicherten Änderungen) und
  den vom Browser gestarteten Verbindungshelfer, so werden die Plugin-Dateien ohne Neustart entfernt.

## 1.0.9 – 2026-10-27

- Setup: Der Deinstallationseintrag in Windows zeigt jetzt auf den Plugin-Ordner statt auf den KeePass-Ordner. Fremde
  Deinstallationsprogramme (z. B. HiBit, Revo) boten nach dem Entfernen von KeePassFerry den ganzen KeePass-Ordner als
  Reste an.
- Trefferliste: Einträge mit Passkey oder Einmalcode (OTP) tragen ein kleines Symbol.
- Passkey-Dialog: Titel und Benutzername des Eintrags erscheinen vollständig, Hinweise wie „hat einen Passkey“ darunter.
- Popup: bis zu 30 Einträge für die aktuelle Website.

## 1.0.8 – 2026-10-24

- Zugehörige Domains: Ein Eintrag für eine Domain eines Anbieters wird auch auf dessen anderen Domains angeboten, z. B.
  outlook.com auf login.live.com (Microsoft, Google, Apple, Amazon, eBay, PayPal, Ubiquiti, Proton, Atlassian, X und
  andere). Solche Treffer stehen nach den direkten und tragen „Zugehörige Domain: …“. Mehrseitige Anmeldungen behalten
  den auf der ersten Seite gewählten Eintrag über diese Domains hinweg (z. B. login.microsoftonline.com →
  login.live.com), auch für Einmalcodes.
- Fenster für die Netzwerkanmeldung neu gestaltet: Website in der Kopfzeile, Einträge als Karten, Knopf „Selbst
  eingeben“.
- Plugin-Update aus dem Browser blockiert die Verbindung nicht mehr: Das Plugin antwortet sofort und erledigt Download,
  Signaturprüfung und Setup in KeePass, das dafür nach vorne kommt, damit die Windows-Abfrage sichtbar ist; die Schritte
  stehen im Diagnoseprotokoll. Bei Plugins vor 1.0.8 öffnet der Knopf stattdessen die Release-Seite.
- Windows-Benachrichtigungen zeigen den eigentlichen Hinweis und öffnen beim Klick das Popup.
- Bearbeiten-Fenster: Benutzername und Passwort lassen sich nicht mehr entfernen, das Entfernen anderer erkannter Felder
  wird bis zum „Speichern“ nur vorgemerkt; behoben, dass das Bearbeiten-Fenster den in der Trefferliste gezeigten
  Eintrag änderte.
- Einstellungen: fehlende Texte für das Suchfeld der Websites.

## 1.0.7 – 2026-10-24

- Notizen, eigene Felder (z. B. Wiederherstellungscodes) und Anhänge eines Eintrags erscheinen im aufgeklappten Eintrag
  und im Bearbeiten-Fenster; die Liste markiert Einträge mit Notizen oder Anhängen. Ein Klick auf den Text öffnet eine
  Vorschau (Bilder, Notizen, geschützte Werte nur auf Wunsch); Bilder, PDF, Text und Notizen lassen sich mit dem
  Standardprogramm von Windows öffnen (über das Plugin: verschlüsselte, schreibgeschützte temporäre Kopie, die nach zwei
  Minuten, beim Sperren und beim Beenden gelöscht wird).
- Bearbeiten-Fenster: Notizen und eigene Felder lassen sich bearbeiten und entfernen, eingefügte Bilder benennen und
  umbenennen; alle Änderungen gelten mit „Speichern“. Das Entfernen zusätzlich erkannter Felder wird bis zum
  „Speichern“ nur vorgemerkt (rückgängig möglich); Benutzername und Passwort lassen sich nicht mehr entfernen. Speichern
  nur von Ergänzungen lässt das Popup nicht mehr im Bearbeiten-Modus.
- Einfügen aus der Zwischenablage per Knopf statt globalem Strg+V; die optionale Berechtigung für die Zwischenablage
  wird in den Einstellungen erteilt. Bearbeiten eines Eintrags behält dessen Adressen und Felder und zeigt nicht mehr
  die Warnung „andere Website“.
- Speichern: dieselbe Regel für den Benutzernamen wie beim Ausfüllen (kein „vollständiger Name“ mehr als Benutzername),
  der Name der Website als Titel des Eintrags.
- Liste der passenden Anmeldungen: Breite nach dem längsten Eintrag, vollständiger Text als Tooltip.
- Einmalcodes: kein Ausfüllen in versteckte Felder (z. B. in einem zugeklappten Bereich), derselbe Code wird auf einer
  Seite nie zweimal automatisch ausgefüllt (Seiten, die selbst absenden und neu laden, laufen nicht mehr im Kreis),
  später erscheinende Codefelder (aufgeklappter Bereich, Dialog) werden gefunden, und das Feldsymbol erscheint auch bei
  Codefeldern über gezeichneten Ziffernkästchen. Ein gefundener, aber nicht gespeicherter Zwei-Faktor-Schlüssel wird
  beim Öffnen des Popups erneut angeboten.
- Tooltips an allen Symbolknöpfen, fehlende Texte in den Einstellungen ergänzt.
- Die Erweiterung braucht Plugin 1.0.7 (neue Funktionen für Anhänge und Notizen); ältere Plugins bekommen den
  Update-Hinweis.

## 1.0.6 – 2026-10-22

- Google Chrome: Das Plugin akzeptiert die KeePassFerry-Erweiterung aus dem Chrome Web Store; das Setup bietet an, auch
  ihre Store-Seite für Chrome zu öffnen.
- Das Manifest der Erweiterung nutzt Pfade ohne führendes `./` (vom Chrome Web Store verlangt).

## 1.0.5 – 2026-10-22

- KeePass zeigt überall KeePassFerry statt Kee: neues Optionen-Fenster (Speicherverhalten, gekoppelte Browser mit
  „Kopplung entfernen“, Version und Update-Prüfung), Reiter für Eintrag, Gruppe und Datenbank sowie Dialoge auf Deutsch
  und Englisch mit KeePassFerry-Symbolen. Der Gruppen-Reiter gibt eine Gruppe für den Browser frei; die oberste Gruppe
  freizugeben bedeutet die ganze Datenbank. Sicherungen erzeugter Passwörter landen in „KeePassFerry – erzeugte
  Passwörter“.
- Die nicht erreichbare Kee-Anmeldung (SRP), Kee-Willkommens- und Neue-Datenbank-Dialoge und -Orte entfernt;
  Verbindungen werden nur über den gekoppelten, verschlüsselten Kanal angenommen. Plugin-Einstellungen nutzen eigene
  Schlüssel `KeePassFerry.*`.
- Die eigene Update-Prüfung von KeePass prüft die Signatur von `version.txt` (Release-Schlüssel).
- Setup: startet KeePass nach der Installation wieder (auch bei Updates mit einem Klick); Deinstallationsprogramm im
  Plugin-Ordner mit KeePassFerry-Symbol.
- Erweiterung: ungenutzte Kee-Dateien, Stile und Texte entfernt, eine Berechtigung weniger (`unlimitedStorage`),
  kleineres Paket (ohne Source-Maps); die Unit-Tests laufen wieder.

## 1.0.4 – 2026-10-22

- Windows-Setup (`KeePassFerry-Setup.exe`): findet KeePass, installiert das Plugin nach `Plugins\KeePassFerry`, beendet
  und startet KeePass bei Bedarf neu und bietet an, für jeden installierten Browser die Store-Seite der Erweiterung zu
  öffnen.
- KeePass-Menü „KeePassFerry“ mit „Optionen …“ und „Nach Updates suchen …“; die eigene Update-Prüfung von KeePass kennt
  jetzt KeePassFerry.
- Das Plugin meldet der Erweiterung seine Version. Ist das Plugin älter als die Erweiterung (der Store aktualisiert nur
  die Erweiterung), zeigt das Popup einen Hinweis mit „Jetzt aktualisieren“: Das Plugin lädt das Setup aus dem
  GitHub-Release und installiert es nur, wenn die Prüfsummenliste mit dem KeePassFerry-Release-Schlüssel signiert ist
  (RSA 3072, offline aufbewahrt), eine neuere als die installierte Version nennt und zur geladenen Datei passt. Downloads
  folgen Weiterleitungen nur über HTTPS zu github.com und githubusercontent.com. Releases werden erst nach dem Signieren
  veröffentlicht.
- Willkommensseite mit Download-Knopf für das Setup und aktualisierten Installationsschritten.
- Einstellungen: neue Symbole und Farben, passend zum Popup.

## 1.0.3 – 2026-10-22

- Neuer Einstellungsabschnitt „KeePassFerry“: Einmalcodes automatisch ausfüllen, Zwei-Faktor-Einrichtung erkennen,
  Passkeys mit KeePassFerry, Symbole in Eingabefeldern, gesperrte Datenbank sofort entsperren (standardmäßig aus),
  Passwortspeicherung von Edge ausschalten (bisher immer an).
- Einmalcodes werden nicht mehr in Felder für Codes per SMS, E-Mail oder WhatsApp ausgefüllt (erkannt am Seitentext);
  über das Symbol lässt sich der App-Code weiterhin auf Wunsch eintragen.
- Dialog für die Netzwerkanmeldung neu gestaltet; die Installationsseite nutzt das neue Design.
- Keine „Was ist neu“-Seite mehr nach Updates (die alte Kee-Seite warb für Kee Vault).
- Übrig gebliebene Kee-Vault-Anbindung, SRP-Kopplung und alte Kee-Seiten entfernt; die Symbolleiste blinkt beim
  Speicherangebot nicht mehr (der Seitenhinweis ersetzt das).

## 1.0.2 – 2026-10-21

- Neues Popup-Design: eine flache Fläche, Eintragszeilen statt Karten, einheitliche Tabler-Symbole, kompakte Hinweise,
  Aktionen in der Fußleiste; Bearbeiten und Gruppenwahl als eigene Seiten mit fester Speichern-Leiste; neu gestalteter
  Passwort-Generator und Dialog für die Zwei-Faktor-Einrichtung. Helles und dunkles Design.
- Eintrag bearbeiten: Wiederherstellungscode, Zwei-Faktor-Schlüssel, Notiz, eigenes Feld oder Bild (Einfügen mit
  Strg+V) hinzufügen; zusätzliche Felder und Anhänge auflisten und entfernen; alles gilt mit einem einzigen „Speichern“.
- Popup: „In Seite eintragen“ neben Kopieren für Benutzername, Passwort und Einmalcode.
- Erkennung der Anmeldefelder wie in Chromium: `autocomplete`, das letzte Textfeld vor dem Passwortfeld oder ein
  einzelnes anmeldeartiges Feld im ersten Schritt mehrstufiger Anmeldungen. Keine Feldsymbole mehr in Namens-, IBAN-
  oder Einstellungsfeldern; kein Speicherangebot für Formulare ohne Passwort.
- Gesperrte Datenbank: keine automatische Windows-Hello-Abfrage mehr. Anmelde- und Codefelder zeigen ein
  Schloss-Symbol; ein Klick darauf oder auf das Symbol in der Symbolleiste entsperrt und füllt dann aus. Das Symbol in
  der Symbolleiste zeigt dasselbe Schloss.
- Einmalcodes: geteilte Codekästchen (eine Ziffer je Feld) werden ausgefüllt, mit dem Gültigkeitsring daneben; der Code
  des richtigen Kontos, wenn sich mehrere Konten eine Website teilen; QR-Codes in iframes werden erkannt; Tooltip mit
  laufender Zeit.
- Feldsymbole halten Abstand zu Knöpfen der Website (z. B. Passwort anzeigen) und verschwinden, wenn ein Dialog oder
  eine Leiste sie verdeckt.
- Behoben: Das Popup zeigte nach dem Bearbeiten eines Eintrags alte Daten.
- Store-Eintrag auf Deutsch und Englisch; veraltete Kee-Übersetzungen entfernt.
- Plugin: neue Funktionen zum Hinzufügen von Textfeldern, Auflisten und Entfernen von Feldern und Anhängen (mit
  Chronik des Eintrags).

## 1.0.1 – 2026-10-21

- Plugin: Die Erweiterung aus Microsoft Edge Add-ons darf sich verbinden (ID `ghkhbdnhojpeibdjdlgojfdjhedapmhg`),
  zusätzlich zur entpackten Entwicklungsfassung. Diese Plugin-Version vor der Erweiterung aus dem Store installieren.

## 1.0.0 – 2026-10-21

Erste Version von KeePassFerry (Fork von Kee 4.1 und KeePassRPC 2.0.2).

- Native Messaging und eine Named Pipe je Benutzer statt eines WebSocket-Ports; nur der mitgelieferte Host darf sich
  verbinden.
- Neuer sicherer Kanal: ECDH P-256, HKDF-SHA-256, AES-256-GCM, Schutz gegen Wiedereinspielen, Kopplung mit einem
  sechsstelligen Code, der in KeePass bestätigt wird. Kopplung in den Einstellungen zurücksetzen.
- Einmalcodes (TOTP, RFC 6238; `otpauth://` und KeePass-Felder `TimeOtp-*`): automatisches Ausfüllen, schwebendes
  Symbol mit Gültigkeitsring, Kopieren im Popup, Einrichtung aus QR-Code oder Schlüssel in den richtigen vorhandenen
  Eintrag.
- Passkeys (WebAuthn, ES256) in KeePassXC-kompatiblen Feldern gespeichert, bevorzugt im vorhandenen Anmeldeeintrag;
  WebAuthn Signal API (entfernte Passkeys, umbenannte Konten).
- Entsperren im Hintergrund: Eine Anmeldeseite, ein Klick auf das Symbol oder ein Feldsymbol löst nur die
  Windows-Hello-Abfrage aus, im Vordergrund und mit Fokus.
- Die Auswahl eines Eintrags unter mehreren Treffern füllt Benutzername und Passwort aus.
- Mit Strg+V eingefügte Bildschirmfotos werden komprimiert und als Anhang des Eintrags gespeichert.
- Kein Speicherangebot, wenn die abgeschickten Daten schon in KeePass stehen (auch bei mehrstufigen Anmeldungen).
- Popup, Einstellungen, Liste der passenden Anmeldungen und Dialoge neu gestaltet; helles und dunkles Design; Texte auf
  Deutsch und Englisch.
- Optionales Diagnoseprotokoll (ohne Geheimnisse).
