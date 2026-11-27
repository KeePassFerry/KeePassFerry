# Trying a test build

English · [Deutsch](#deutsch)

Every change on `main` that passes the automated tests is published as a **test build**:
[Releases → "Test build (main)"](https://github.com/KeePassFerry/KeePassFerry/releases/tag/testing).
Use it to check a fix before the next release. It is **not signed and not reviewed by the browser stores**, so only
install it if you were asked to test something, and keep a backup of your database.

| File | What it is |
|---|---|
| [KeePassFerry-Testbuild-Plugin.zip](https://github.com/KeePassFerry/KeePassFerry/releases/download/testing/KeePassFerry-Testbuild-Plugin.zip) | KeePass plugin (folder `KeePassFerry`) |
| [KeePassFerry-Testbuild-Chrome-Edge.zip](https://github.com/KeePassFerry/KeePassFerry/releases/download/testing/KeePassFerry-Testbuild-Chrome-Edge.zip) | Extension for Edge and Chrome |
| [KeePassFerry-Testbuild-Firefox.zip](https://github.com/KeePassFerry/KeePassFerry/releases/download/testing/KeePassFerry-Testbuild-Firefox.zip) | Extension for Firefox |

KeePassFerry must already be installed the normal way (setup from the [latest release](https://github.com/KeePassFerry/KeePassFerry/releases/latest)).
Plugin and extension of a test build belong together: install both.

## Plugin

1. Download the plugin zip. Right-click it → Properties → tick **Unblock** → OK (otherwise KeePass refuses to load it).
2. Close KeePass.
3. Copy the files from the `KeePassFerry` folder in the zip into `<KeePass folder>\Plugins\KeePassFerry` and replace
   the existing ones (for KeePass in `C:\Program Files …` Windows asks for administrator rights).
4. Start KeePass.

## Extension in Edge or Chrome

1. Extract the zip into a folder you keep (the browser loads the extension from there).
2. Open `edge://extensions` or `chrome://extensions`, turn on **Developer mode** and **turn off** the KeePassFerry
   extension from the store (both at the same time get in each other's way).
3. Click **Load unpacked** and choose the extracted folder.
4. The unpacked extension has its own ID. Allow it in KeePass: **Tools → KeePassFerry → Options … → Addresses and
   browsers → "Allow the test version of the extension"** → OK.
5. Pair it like the first time: confirm the verification code in KeePass.

## Extension in Firefox

1. Extract the zip.
2. Open `about:addons` and disable KeePassFerry from addons.mozilla.org.
3. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose `manifest.json` in the
   extracted folder. Firefox removes it again when it is closed.
4. Pair it if asked: confirm the verification code in KeePass.

## Back to the release

- Edge/Chrome: remove the unpacked extension, turn the store extension on again and untick "Allow the test version"
  in the KeePassFerry options.
- Firefox: restart Firefox and enable the store extension again.
- Plugin: run `KeePassFerry-Setup.exe` from the [latest release](https://github.com/KeePassFerry/KeePassFerry/releases/latest)
  (a test build has the same version number as the last release, so the update check does not offer it).

## Reporting

Please reply in the issue you are testing. If something does not work, turn on the diagnostic log (extension settings →
Advanced), reproduce it and attach the log (button "Open log folder"). It contains no passwords or other values.

---

<a id="deutsch"></a>
# Testversion ausprobieren

Jede Änderung auf `main`, die die automatischen Tests besteht, erscheint als **Testversion**:
[Releases → „Test build (main)“](https://github.com/KeePassFerry/KeePassFerry/releases/tag/testing).
Damit lässt sich eine Korrektur vor dem nächsten Release prüfen. Sie ist **nicht signiert und nicht von den
Browser-Stores geprüft**: nur installieren, wenn du um einen Test gebeten wurdest, und vorher die Datenbank sichern.

| Datei | Inhalt |
|---|---|
| [KeePassFerry-Testbuild-Plugin.zip](https://github.com/KeePassFerry/KeePassFerry/releases/download/testing/KeePassFerry-Testbuild-Plugin.zip) | KeePass-Plugin (Ordner `KeePassFerry`) |
| [KeePassFerry-Testbuild-Chrome-Edge.zip](https://github.com/KeePassFerry/KeePassFerry/releases/download/testing/KeePassFerry-Testbuild-Chrome-Edge.zip) | Erweiterung für Edge und Chrome |
| [KeePassFerry-Testbuild-Firefox.zip](https://github.com/KeePassFerry/KeePassFerry/releases/download/testing/KeePassFerry-Testbuild-Firefox.zip) | Erweiterung für Firefox |

KeePassFerry muss schon normal installiert sein (Setup aus dem [aktuellen Release](https://github.com/KeePassFerry/KeePassFerry/releases/latest)).
Plugin und Erweiterung einer Testversion gehören zusammen: beide installieren.

## Plugin

1. Plugin-Zip herunterladen. Rechtsklick → Eigenschaften → **Zulassen** ankreuzen → OK (sonst lädt KeePass es nicht).
2. KeePass schließen.
3. Die Dateien aus dem Ordner `KeePassFerry` im Zip nach `<KeePass-Ordner>\Plugins\KeePassFerry` kopieren und die
   vorhandenen ersetzen (bei KeePass unter `C:\Program Files …` fragt Windows nach Administratorrechten).
4. KeePass starten.

## Erweiterung in Edge oder Chrome

1. Zip in einen Ordner entpacken, der bleibt (der Browser lädt die Erweiterung von dort).
2. `edge://extensions` bzw. `chrome://extensions` öffnen, **Entwicklermodus** einschalten und die KeePassFerry-Erweiterung
   aus dem Store **ausschalten** (beide gleichzeitig kommen sich in die Quere).
3. **Entpackte Erweiterung laden** und den entpackten Ordner wählen.
4. Die entpackte Erweiterung hat eine eigene ID. In KeePass zulassen: **Extras → KeePassFerry → Optionen … → Adressen
   und Browser → „Testversion der Erweiterung zulassen“** → OK.
5. Koppeln wie beim ersten Mal: Prüfcode in KeePass bestätigen.

## Erweiterung in Firefox

1. Zip entpacken.
2. `about:addons` öffnen und KeePassFerry von addons.mozilla.org deaktivieren.
3. `about:debugging#/runtime/this-firefox` öffnen, **Temporäres Add-on laden …** klicken und `manifest.json` im
   entpackten Ordner wählen. Beim Schließen von Firefox ist es wieder weg.
4. Falls nötig koppeln: Prüfcode in KeePass bestätigen.

## Zurück zum Release

- Edge/Chrome: entpackte Erweiterung entfernen, Store-Erweiterung wieder einschalten und in den KeePassFerry-Optionen
  „Testversion der Erweiterung zulassen“ abhaken.
- Firefox: Firefox neu starten und die Store-Erweiterung wieder aktivieren.
- Plugin: `KeePassFerry-Setup.exe` aus dem [aktuellen Release](https://github.com/KeePassFerry/KeePassFerry/releases/latest)
  ausführen (eine Testversion trägt dieselbe Versionsnummer wie das letzte Release, deshalb bietet die Update-Prüfung
  es nicht an).

## Rückmeldung

Bitte im Issue antworten, um das es geht. Klappt etwas nicht: Diagnoseprotokoll einschalten (Einstellungen der
Erweiterung → Erweitert), den Fehler nachstellen und das Protokoll anhängen (Knopf „Protokollordner öffnen“). Es enthält
keine Passwörter oder anderen Werte.
