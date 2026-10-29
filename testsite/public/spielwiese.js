/*
spielwiese.js: Logik der lokalen Test-Website für KeePassFerry. Keine echten Konten: alles liegt im Browser
(localStorage: Konten, sessionStorage: Anmeldung). Die Seiten verhalten sich wie echte Websites (Formular abschicken,
kurz "Server", dann Weiterleitung), damit die Erweiterung Anmeldung, Speichern und Zwei-Faktor wie im Alltag erkennt.
Schlüssel und otpauth-URIs entstehen nur hier im Skript, nie im HTML der Seiten (die Erweiterung durchsucht das HTML).
*/
(function () {
    "use strict";

    const KONTEN = "spielwiese.konten";
    const SITZUNG = "spielwiese.sitzung";
    const EINRICHTUNG = "spielwiese.einrichtung";
    const AUSSTELLER = "Spielwiese";
    const SERVER_PAUSE_MS = 300;

    // ---- Konten und Anmeldung ----

    function konten() {
        try {
            return JSON.parse(localStorage.getItem(KONTEN)) || {};
        } catch (e) {
            return {};
        }
    }

    function speichereKonten(k) {
        localStorage.setItem(KONTEN, JSON.stringify(k));
    }

    // Beim ersten Besuch ein Beispielkonto anlegen
    function startkontoAnlegen() {
        if (localStorage.getItem(KONTEN) !== null) return;
        speichereKonten({ "demo@spielwiese.test": { passwort: "Start-Passwort1", otpSecret: null } });
    }

    function konto(benutzer) {
        return benutzer ? konten()[benutzer.trim().toLowerCase()] || null : null;
    }

    function sitzung() {
        try {
            return JSON.parse(sessionStorage.getItem(SITZUNG));
        } catch (e) {
            return null;
        }
    }

    function anmelden(benutzer, zweiterFaktorOffen) {
        sessionStorage.setItem(SITZUNG, JSON.stringify({ benutzer: benutzer.trim().toLowerCase(), zweiterFaktorOffen }));
    }

    function abmelden() {
        sessionStorage.removeItem(SITZUNG);
        sessionStorage.removeItem(EINRICHTUNG);
    }

    // Angemeldeter Benutzer (Passwort und ggf. Code geprüft), sonst zur Anmeldung
    function angemeldetOderWeiter() {
        const s = sitzung();
        if (!s || s.zweiterFaktorOffen || !konto(s.benutzer)) {
            location.href = "login.html";
            return null;
        }
        return s.benutzer;
    }

    // Wie ein Server: kurz warten, dann weiterleiten (die Erweiterung verarbeitet das Abschicken vorher)
    function weiter(adresse) {
        setTimeout(() => {
            location.href = adresse;
        }, SERVER_PAUSE_MS);
    }

    function nachAnmeldung(benutzer) {
        const k = konto(benutzer);
        anmelden(benutzer, !!k.otpSecret);
        weiter(k.otpSecret ? "2fa-code.html" : "konto.html");
    }

    // ---- TOTP (RFC 6238, 30 s, 6 Stellen, SHA1) ----

    const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    function base32Encode(bytes) {
        let out = "", bits = 0, value = 0;
        for (const b of bytes) {
            value = (value << 8) | b;
            bits += 8;
            while (bits >= 5) {
                out += BASE32[(value >>> (bits - 5)) & 31];
                bits -= 5;
            }
        }
        if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
        return out;
    }

    function base32Decode(text) {
        const out = [];
        let bits = 0, value = 0;
        for (const ch of text.replace(/[\s=]/g, "").toUpperCase()) {
            const i = BASE32.indexOf(ch);
            if (i < 0) continue;
            value = (value << 5) | i;
            bits += 5;
            if (bits >= 8) {
                out.push((value >>> (bits - 8)) & 0xff);
                bits -= 8;
            }
        }
        return new Uint8Array(out);
    }

    function zufallsSchluessel() {
        return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    }

    async function totp(secret, schritt) {
        const nachricht = new Uint8Array(8);
        let rest = schritt;
        for (let i = 7; i >= 0; i--) {
            nachricht[i] = rest % 256;
            rest = Math.floor(rest / 256);
        }
        const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
        const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, nachricht));
        const o = mac[mac.length - 1] & 0x0f;
        const zahl = (mac[o] & 0x7f) * 2 ** 24 + (mac[o + 1] << 16) + (mac[o + 2] << 8) + mac[o + 3];
        return String(zahl % 1000000).padStart(6, "0");
    }

    function aktuellerSchritt() {
        return Math.floor(Date.now() / 30000);
    }

    // Aktueller Code sowie vorheriger und nächster Zeitschritt (Uhren laufen nie ganz gleich)
    async function codeGueltig(secret, code) {
        const c = (code || "").replace(/\s/g, "");
        const s = aktuellerSchritt();
        for (const schritt of [s, s - 1, s + 1]) {
            if ((await totp(secret, schritt)) === c) return true;
        }
        return false;
    }

    function otpauthUri(benutzer, secret) {
        return "otpauth://totp/" + encodeURIComponent(AUSSTELLER + ":" + benutzer) + "?secret=" + secret + "&issuer=" + AUSSTELLER;
    }

    // ---- Seitenhilfen ----

    const $ = sel => document.querySelector(sel);

    function zeigeFehler(text) {
        const el = $("#fehler");
        el.textContent = text;
        el.hidden = !text;
    }

    function zeigeHinweis(text) {
        const el = $("#hinweis");
        if (!el) return;
        el.textContent = text;
        el.hidden = !text;
    }

    function parameter(name) {
        return new URLSearchParams(location.search).get(name);
    }

    function sichtbarerBenutzer() {
        const s = sitzung();
        const el = $("#angemeldet");
        if (el) el.textContent = s && !s.zweiterFaktorOffen ? "Angemeldet als " + s.benutzer : "Nicht angemeldet";
    }

    // ---- Seiten ----

    function initUebersicht() {
        startkontoAnlegen();
        sichtbarerBenutzer();
        const tabelle = $("#konten");
        const zeichnen = async () => {
            const k = konten();
            const zeilen = await Promise.all(
                Object.keys(k)
                    .sort()
                    .map(async name => {
                        const z = k[name];
                        let zweiFaktor = "aus";
                        if (z.otpSecret) {
                            const rest = 30 - (Math.floor(Date.now() / 1000) % 30);
                            zweiFaktor = "aktiv – Code jetzt " + (await totp(z.otpSecret, aktuellerSchritt())) + " (noch " + rest + " s)";
                        }
                        return { name, passwort: z.passwort, zweiFaktor };
                    })
            );
            tabelle.replaceChildren(
                ...zeilen.map(z => {
                    const tr = document.createElement("tr");
                    for (const text of [z.name, z.passwort, z.zweiFaktor]) {
                        const td = document.createElement("td");
                        td.textContent = text;
                        tr.append(td);
                    }
                    const aktionen = document.createElement("td");
                    const aendern = document.createElement("button");
                    aendern.type = "button";
                    aendern.textContent = "Passwort woanders ändern";
                    aendern.title = "Wie eine Änderung auf einem anderen Gerät: KeePass erfährt davon nichts";
                    aendern.addEventListener("click", () => {
                        const neu = prompt("Neues Passwort für " + z.name + ":", z.passwort + "-neu");
                        if (!neu) return;
                        const alle = konten();
                        alle[z.name].passwort = neu;
                        speichereKonten(alle);
                        zeichnen();
                    });
                    const ohne2fa = document.createElement("button");
                    ohne2fa.type = "button";
                    ohne2fa.textContent = "2FA entfernen";
                    ohne2fa.disabled = !konten()[z.name].otpSecret;
                    ohne2fa.addEventListener("click", () => {
                        const alle = konten();
                        alle[z.name].otpSecret = null;
                        speichereKonten(alle);
                        zeichnen();
                    });
                    const loeschen = document.createElement("button");
                    loeschen.type = "button";
                    loeschen.textContent = "Löschen";
                    loeschen.addEventListener("click", () => {
                        const alle = konten();
                        delete alle[z.name];
                        speichereKonten(alle);
                        zeichnen();
                    });
                    aktionen.append(aendern, ohne2fa, loeschen);
                    tr.append(aktionen);
                    return tr;
                })
            );
        };
        zeichnen();
        setInterval(zeichnen, 1000);
        $("#zuruecksetzen").addEventListener("click", () => {
            if (!confirm("Alle Testkonten löschen und abmelden?")) return;
            localStorage.removeItem(KONTEN);
            abmelden();
            location.reload();
        });
        $("#abmelden").addEventListener("click", () => {
            abmelden();
            location.reload();
        });
    }

    // Klassische Anmeldung: Fehler -> Seite lädt mit Meldung neu (Formular steht wieder da)
    function initLogin() {
        startkontoAnlegen();
        sichtbarerBenutzer();
        if (parameter("fehler")) zeigeFehler("Benutzername oder Passwort falsch.");
        if (parameter("u")) $("#benutzer").value = parameter("u");
        $("form").addEventListener("submit", e => {
            e.preventDefault();
            const benutzer = $("#benutzer").value;
            const k = konto(benutzer);
            if (!k || k.passwort !== $("#passwort").value) {
                weiter("login.html?fehler=1&u=" + encodeURIComponent(benutzer));
                return;
            }
            nachAnmeldung(benutzer);
        });
    }

    // Anmeldung ohne Neuladen: bei Erfolg verschwindet das Formular, bei Fehler bleibt es mit Meldung stehen
    function initSpaLogin() {
        startkontoAnlegen();
        sichtbarerBenutzer();
        $("form").addEventListener("submit", e => {
            e.preventDefault();
            setTimeout(() => {
                const benutzer = $("#benutzer").value;
                const k = konto(benutzer);
                if (!k || k.passwort !== $("#passwort").value) {
                    zeigeFehler("Benutzername oder Passwort falsch.");
                    $("#passwort").value = "";
                    return;
                }
                if (k.otpSecret) {
                    nachAnmeldung(benutzer);
                    return;
                }
                anmelden(benutzer, false);
                $("form").remove();
                $("#willkommen").hidden = false;
                $("#willkommen-name").textContent = benutzer.trim().toLowerCase();
                sichtbarerBenutzer();
            }, SERVER_PAUSE_MS);
        });
    }

    // Mehrstufig, Schritt 1: nur der Benutzername
    function initSchritt1() {
        startkontoAnlegen();
        sichtbarerBenutzer();
        $("form").addEventListener("submit", e => {
            e.preventDefault();
            const benutzer = $("#benutzer").value.trim().toLowerCase();
            if (!konto(benutzer)) {
                zeigeFehler("Dieses Konto gibt es nicht.");
                return;
            }
            weiter("login-schritt2.html?u=" + encodeURIComponent(benutzer));
        });
    }

    // Mehrstufig, Schritt 2: nur das Passwort, der Benutzer steht als Text darüber (kein Eingabefeld)
    function initSchritt2() {
        const benutzer = parameter("u");
        if (!konto(benutzer)) {
            location.href = "login-schritt1.html";
            return;
        }
        sichtbarerBenutzer();
        $("#benutzer-anzeige").textContent = benutzer;
        if (parameter("fehler")) zeigeFehler("Passwort falsch.");
        $("form").addEventListener("submit", e => {
            e.preventDefault();
            if (konto(benutzer).passwort !== $("#passwort").value) {
                weiter("login-schritt2.html?fehler=1&u=" + encodeURIComponent(benutzer));
                return;
            }
            nachAnmeldung(benutzer);
        });
    }

    function initRegistrieren() {
        startkontoAnlegen();
        sichtbarerBenutzer();
        $("form").addEventListener("submit", e => {
            e.preventDefault();
            const benutzer = $("#benutzer").value.trim().toLowerCase();
            const passwort = $("#passwort").value;
            if (!benutzer || !passwort) return zeigeFehler("Bitte Benutzername und Passwort angeben.");
            if (passwort !== $("#passwort2").value) return zeigeFehler("Die Passwörter stimmen nicht überein.");
            if (konto(benutzer)) return zeigeFehler("Dieses Konto gibt es schon.");
            const alle = konten();
            alle[benutzer] = { passwort, otpSecret: null };
            speichereKonten(alle);
            anmelden(benutzer, false);
            weiter("konto.html?hinweis=neu");
        });
    }

    function initKonto() {
        const benutzer = angemeldetOderWeiter();
        if (!benutzer) return;
        sichtbarerBenutzer();
        $("#name").textContent = benutzer;
        $("#zweifaktor").textContent = konto(benutzer).otpSecret ? "aktiv" : "nicht eingerichtet";
        const hinweise = {
            neu: "Konto angelegt.",
            passwort: "Passwort geändert.",
            "2fa": "Zwei-Faktor-Anmeldung ist jetzt aktiv.",
            angemeldet: "Erfolgreich angemeldet."
        };
        zeigeHinweis(hinweise[parameter("hinweis")] || "");
        $("#abmelden").addEventListener("click", () => {
            abmelden();
            location.href = "index.html";
        });
    }

    // Kundencenter: altes Passwort, neues Passwort, Wiederholung; Benutzername als verstecktes Feld (wie viele Websites)
    function initPasswortAendern() {
        const benutzer = angemeldetOderWeiter();
        if (!benutzer) return;
        sichtbarerBenutzer();
        $("#benutzer").value = benutzer;
        $("form").addEventListener("submit", e => {
            e.preventDefault();
            if (konto(benutzer).passwort !== $("#alt").value) return zeigeFehler("Das aktuelle Passwort ist falsch.");
            if (!$("#neu").value) return zeigeFehler("Bitte ein neues Passwort angeben.");
            if ($("#neu").value !== $("#neu2").value) return zeigeFehler("Die neuen Passwörter stimmen nicht überein.");
            const alle = konten();
            alle[benutzer].passwort = $("#neu").value;
            speichereKonten(alle);
            weiter("konto.html?hinweis=passwort");
        });
    }

    // QR-Code aus dem Punktmuster zeichnen (mit Ruhezone), als Bild oder als SVG
    function qrCanvas(rows, modul) {
        const n = rows.length + 8;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = n * modul;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#000";
        rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) if (row[x] === "1") ctx.fillRect((x + 4) * modul, (y + 4) * modul, modul, modul);
        });
        return canvas;
    }

    function qrSvg(rows, modul) {
        const ns = "http://www.w3.org/2000/svg";
        const n = rows.length + 8;
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 " + n + " " + n);
        svg.setAttribute("width", String(n * modul));
        svg.setAttribute("height", String(n * modul));
        svg.setAttribute("shape-rendering", "crispEdges");
        const bg = document.createElementNS(ns, "rect");
        bg.setAttribute("width", String(n));
        bg.setAttribute("height", String(n));
        bg.setAttribute("fill", "#fff");
        svg.append(bg);
        let d = "";
        rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) if (row[x] === "1") d += "M" + (x + 4) + " " + (y + 4) + "h1v1h-1z";
        });
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "#000");
        svg.append(path);
        return svg;
    }

    // Zwei-Faktor einrichten: ?art=link | text | qr | qr-svg
    function init2faEinrichten() {
        const benutzer = angemeldetOderWeiter();
        if (!benutzer) return;
        sichtbarerBenutzer();
        const art = ["link", "text", "qr", "qr-svg"].includes(parameter("art")) ? parameter("art") : "link";
        document.querySelectorAll("[data-art]").forEach(el => {
            el.hidden = el.dataset.art !== art;
        });
        // QR-Varianten: fester Testschlüssel mit fertigem QR-Code; sonst neuer Zufallsschlüssel je Einrichtung
        let secret;
        if (art.startsWith("qr")) {
            secret = window.SPIELWIESE_QR.secret;
        } else {
            const offen = JSON.parse(sessionStorage.getItem(EINRICHTUNG) || "null");
            secret = offen && offen.art === art ? offen.secret : zufallsSchluessel();
            sessionStorage.setItem(EINRICHTUNG, JSON.stringify({ art, secret }));
        }
        if (art === "link") {
            $("#otpauth-link").href = otpauthUri(benutzer, secret);
        } else if (art === "text") {
            $("#schluessel-text").textContent = secret.match(/.{1,4}/g).join(" ");
        } else if (art === "qr") {
            const img = document.createElement("img");
            img.alt = "QR-Code für die Authenticator-App";
            img.width = img.height = (window.SPIELWIESE_QR.rows.length + 8) * 5;
            img.src = qrCanvas(window.SPIELWIESE_QR.rows, 5).toDataURL("image/png");
            $("#qr-bild").replaceChildren(img);
        } else {
            $("#qr-svg").replaceChildren(qrSvg(window.SPIELWIESE_QR.rows, 5));
        }
        if (konto(benutzer).otpSecret) zeigeHinweis("Für dieses Konto ist schon ein Schlüssel aktiv; er wird ersetzt.");
        $("form").addEventListener("submit", async e => {
            e.preventDefault();
            if (!(await codeGueltig(secret, $("#code").value))) return zeigeFehler("Der Code stimmt nicht.");
            const alle = konten();
            alle[benutzer].otpSecret = secret;
            speichereKonten(alle);
            sessionStorage.removeItem(EINRICHTUNG);
            weiter("konto.html?hinweis=2fa");
        });
    }

    // Zweiter Faktor bei der Anmeldung
    function init2faCode() {
        const s = sitzung();
        if (!s || !s.zweiterFaktorOffen || !konto(s.benutzer)) {
            location.href = "login.html";
            return;
        }
        sichtbarerBenutzer();
        $("#benutzer-anzeige").textContent = s.benutzer;
        $("form").addEventListener("submit", async e => {
            e.preventDefault();
            if (!(await codeGueltig(konto(s.benutzer).otpSecret, $("#code").value))) return zeigeFehler("Der Code stimmt nicht.");
            anmelden(s.benutzer, false);
            weiter("konto.html?hinweis=angemeldet");
        });
    }

    window.Spielwiese = {
        initUebersicht,
        initLogin,
        initSpaLogin,
        initSchritt1,
        initSchritt2,
        initRegistrieren,
        initKonto,
        initPasswortAendern,
        init2faEinrichten,
        init2faCode
    };
})();
