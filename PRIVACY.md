# Privacy policy / Datenschutzerklärung

_Last updated / Stand: 2026-10-21_

## English

KeePassFerry is a browser extension that connects your browser to **KeePass Password Safe running on your own
computer**. It does not have servers and does not send any data to the KeePassFerry authors or to third parties.

**What the extension processes, locally only**
- The address and the form fields of the page you visit, to find matching entries in your KeePass database and
  to fill in logins, one-time codes and passkeys.
- Data you submit in login forms, to offer saving it to KeePass. It is kept in memory for the open tab only.
- Screenshots you paste on purpose, to store them as an attachment in a KeePass entry you choose.
- To recognise a two-factor setup, a visible part of the current page may be captured and decoded locally
  (QR code). The image is not stored or transmitted.

**Where the data goes**
- Only to the KeePassFerry plugin inside your local KeePass, through the browser's native messaging and a named
  pipe that only your Windows user account can open. The connection is end-to-end encrypted and paired with a
  verification code that you confirm in KeePass.
- Your passwords, one-time-code secrets and passkey private keys stay in your KeePass database.

**What is stored by the extension**
- Settings, a pairing key (as a non-exportable browser key) and the public key of your KeePass, in the
  browser's local extension storage.
- Optional, only if you enable it: a diagnostic log written by the plugin to your Documents folder. It contains
  events and field properties, never passwords, codes or field contents.

**No tracking.** KeePassFerry contains no analytics, advertising or telemetry and makes no network requests of
its own, except loading website icons (favicons) of the page you are on if you choose to save them with an entry.

Questions: please open an issue at <https://github.com/KeePassFerry/KeePassFerry/issues>.

## Deutsch

KeePassFerry ist eine Browser-Erweiterung, die deinen Browser mit **KeePass Password Safe auf deinem eigenen
Computer** verbindet. Es gibt keine Server; es werden keine Daten an die Entwickler oder an Dritte übertragen.

- **Verarbeitet (nur lokal):** Adresse und Formularfelder der besuchten Seite (zum Finden und Ausfüllen),
  abgeschickte Anmeldedaten (nur im Speicher des Tabs, zum Angebot „In KeePass speichern“), absichtlich
  eingefügte Screenshots (als Anhang eines gewählten Eintrags), bei der Einrichtung von Zwei-Faktor-Codes ggf.
  ein Bildausschnitt der Seite zum lokalen Lesen eines QR-Codes (wird weder gespeichert noch übertragen).
- **Weitergabe:** ausschließlich an das KeePassFerry-Plugin in deinem lokalen KeePass, über Native Messaging und
  eine nur für dein Windows-Konto zugängliche Named Pipe, Ende-zu-Ende-verschlüsselt und per Prüfcode gekoppelt.
  Passwörter, OTP-Schlüssel und private Passkey-Schlüssel bleiben in deiner KeePass-Datenbank.
- **Gespeichert in der Erweiterung:** Einstellungen, ein nicht exportierbarer Kopplungsschlüssel und der
  öffentliche Schlüssel deines KeePass. Optional (nur wenn eingeschaltet) ein Diagnoseprotokoll im
  Dokumente-Ordner, ohne Passwörter, Codes oder Feldinhalte.
- **Kein Tracking**, keine Werbung, keine Telemetrie. Eigene Netzwerkzugriffe nur zum Laden des Website-Symbols
  (Favicon), wenn du es mit einem Eintrag speicherst.

Fragen bitte als Issue: <https://github.com/KeePassFerry/KeePassFerry/issues>.
