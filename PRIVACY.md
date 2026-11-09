# Privacy policy / Datenschutzerklärung

_Last updated / Stand: 2026-11-02_

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
- Optional, only if you enable it: a diagnostic log written by the plugin to your local application data folder. It contains
  events and field properties, never passwords, codes or field contents.

**No tracking.** KeePassFerry contains no analytics, advertising or telemetry. Its own network requests are limited
to the following, and none of them contains passwords or other content of your KeePass database:
- Website icons (favicons) of the page you are on, if you choose to save them with an entry.
- Two-factor setup: a QR code image shown on the current page may be loaded again by the extension to read it; images
  from other addresses than the page are loaded without cookies.
- "Change password": when you expand an entry, the extension may ask that entry's website whether it supports the
  standard address `/.well-known/change-password` (without cookies), to show a button that opens the right page.
  For many websites the address comes from a built-in list instead (Apple's Password Manager Resources) and no
  request is made.

**KeePass plugin: checking passwords for data breaches (optional, off by default).** Only if you turn on "Check
passwords for data breaches", the plugin in KeePass checks your passwords at "Have I Been Pwned"
(`api.pwnedpasswords.com`, k-anonymity model): for each password it computes a SHA-1 checksum locally and sends only
the **first 5 characters** of it; the service answers with all known checksums that start with them, and the
comparison happens on your computer. The password itself, the full checksum, usernames and addresses are never sent.
The result (found or not) is stored in the entry in your KeePass database.

**KeePass plugin: updates.** If KeePass's own update check is enabled, KeePass reads `version.txt` from GitHub to
show whether a newer plugin version exists. The plugin downloads a new version from the GitHub release only when
you start an update yourself (*Update now* or *Check for updates*). These requests contain no personal data beyond
what any web request contains (IP address, program name).

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
  lokalen Anwendungsdaten-Ordner, ohne Passwörter, Codes oder Feldinhalte.
- **Kein Tracking**, keine Werbung, keine Telemetrie. Eigene Netzwerkzugriffe nur für Folgendes, nie mit
  Passwörtern oder anderen Inhalten deiner KeePass-Datenbank: das Website-Symbol (Favicon), wenn du es mit einem
  Eintrag speicherst; bei der Zwei-Faktor-Einrichtung ggf. erneutes Laden des QR-Bilds der aktuellen Seite (Bilder von
  anderen Adressen ohne Cookies); beim Aufklappen eines Eintrags ggf. eine Anfrage an dessen Website, ob sie die
  Standardadresse `/.well-known/change-password` unterstützt (ohne Cookies), für den Knopf „Passwort ändern“. Für viele
  Websites stammt die Adresse stattdessen aus einer mitgelieferten Liste (Apples „Password Manager Resources“), dann
  gibt es keine Anfrage.
- **KeePass-Plugin, Prüfung auf Datenlecks (optional, standardmäßig aus):** Nur wenn du „Passwörter auf Datenlecks
  prüfen“ einschaltest, prüft das Plugin in KeePass deine Passwörter bei „Have I Been Pwned“
  (`api.pwnedpasswords.com`, k-Anonymität): Für jedes Passwort wird lokal eine SHA-1-Prüfsumme berechnet und nur deren
  **erste 5 Zeichen** gesendet; der Dienst antwortet mit allen bekannten Prüfsummen, die so beginnen, verglichen wird
  auf deinem Computer. Das Passwort selbst, die vollständige Prüfsumme, Benutzernamen und Adressen werden nie gesendet.
  Das Ergebnis (gefunden oder nicht) steht im Eintrag in deiner KeePass-Datenbank.
- **KeePass-Plugin, Updates:** Ist die Update-Prüfung von KeePass eingeschaltet, liest KeePass `version.txt` von
  GitHub, um eine neuere Plugin-Version anzuzeigen. Eine neue Version lädt das Plugin nur, wenn du das Update selbst
  startest („Jetzt aktualisieren“ oder „Nach Updates suchen“). Dabei werden keine persönlichen Daten übertragen,
  außer dem, was jede Webanfrage enthält (IP-Adresse, Programmkennung).

Fragen bitte als Issue: <https://github.com/KeePassFerry/KeePassFerry/issues>.
