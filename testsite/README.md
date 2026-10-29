# Spielwiese für KeePassFerry

Eine kleine Test-Website, die nur auf diesem Rechner läuft: Anmelden, Registrieren, Passwort ändern, mehrstufige
Anmeldung und Zwei-Faktor (TOTP) einrichten und abfragen – ohne echte Konten und ohne Internet. Konten, Passwörter und
Zwei-Faktor-Schlüssel liegen nur im Browser (localStorage); die Übersicht zeigt sie samt aktuellem Code an.

## Starten

```
node testsite/server.mjs
```

Dann im Browser **http://127.0.0.1:8080/** öffnen. Wichtig: `127.0.0.1`, nicht `localhost` – für `localhost`
ermittelt die Erweiterung keine Domain und ignoriert zum Beispiel Zwei-Faktor-Schlüssel.

Ohne Node.js geht es auch mit Python: `py -m http.server 8080 --bind 127.0.0.1 --directory testsite/public`

In KeePass einen Testeintrag mit der Adresse `http://127.0.0.1:8080/` anlegen oder ihn über den Speichern-Hinweis
entstehen lassen. Beispielkonto beim ersten Besuch: `demo@spielwiese.test` / `Start-Passwort1`.

## Was sich damit prüfen lässt

| Szenario | So geht's | Erwartet |
| --- | --- | --- |
| Neue Zugangsdaten | Registrieren oder mit einem Konto anmelden, das noch nicht in KeePass steht | „Zugangsdaten in KeePass speichern?“ |
| Passwort woanders geändert | In der Übersicht „Passwort woanders ändern“, dann mit dem neuen Passwort anmelden | „Neues Passwort erkannt“; „In KeePass aktualisieren …“ öffnet den vorhandenen Eintrag mit neuem Passwort |
| Vertippt | Mit falschem Passwort anmelden (das Formular erscheint wieder) | kein Aktualisieren-Hinweis |
| Passwort im Kundenkonto ändern | Kundenkonto → Passwort ändern | Aktualisieren-Hinweis für den vorhandenen Eintrag |
| Anmeldung ohne Neuladen | „Anmelden ohne Neuladen“ | Hinweise erscheinen, sobald das Formular verschwunden ist |
| Zwei Schritte | „Anmelden in zwei Schritten“ (Passwortseite ohne Benutzerfeld) | wie bei der klassischen Anmeldung |
| Zwei-Faktor einrichten | Kundenkonto → Zwei-Faktor als Link, Text, QR-Bild oder QR-SVG | „Zwei-Faktor-Schlüssel gefunden“; nach dem Speichern trägt die Erweiterung den Bestätigungscode ein |
| Schlüssel schon gespeichert | Einrichtungsseite nach dem Speichern neu laden | kein Hinweis mehr, Code wird eingetragen |
| Code bei der Anmeldung | Konto mit aktivem Zwei-Faktor abmelden und wieder anmelden | Code wird auf der Code-Seite eingetragen |

Die Spielwiese prüft Einmalcodes wirklich (RFC 6238, 30 Sekunden, ± einen Zeitschritt). Link und Text erzeugen je
Einrichtung einen zufälligen Schlüssel; die beiden QR-Varianten nutzen einen festen Testschlüssel mit fertigem
QR-Code (`public/qr-matrix.js`).

„Alles zurücksetzen“ auf der Übersicht löscht alle Testkonten.
