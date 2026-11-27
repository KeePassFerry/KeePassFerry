import { configManager } from "../common/ConfigManager";
import { ferry } from "./KF";

/*
ferryDiag.ts: Diagnoseprotokoll für die Entwicklung (Einstellung "Diagnoseprotokoll", standardmäßig aus).
Meldungen gehen gesammelt über den verschlüsselten Kanal an das Plugin, das sie in eine Datei schreibt
(%LOCALAPPDATA%\KeePassFerry\diagnose.log). Nur Ereignisse und Merkmale, nie Passwörter, Codes oder Feldinhalte.
*/

const queue: string[] = [];
let flushTimer: number = null;

export function diagEnabled(): boolean {
    return !!configManager.current?.ferryDiagnostics;
}

// Schalter an das Plugin melden: beim Verbinden und wenn er sich ändert. Das Plugin schreibt eigene Zeilen
// (z. B. Abgleich der Zwei-Faktor-Formate) nur bei eingeschaltetem Diagnosemodus
let reportedSwitch: boolean = null;

export function reportDiagSwitch(force = false) {
    const on = diagEnabled();
    if (!force && reportedSwitch === on) return;
    reportedSwitch = on;
    ferry?.rpc?.setDiagnostics(on).catch(() => {
        reportedSwitch = null;
    });
}

export function watchDiagSwitch() {
    configManager.addChangeListener(() => reportDiagSwitch());
}

export function diag(source: string, event: string, data?: Record<string, unknown>) {
    if (!diagEnabled()) return;
    let json = "";
    try {
        json = data ? JSON.stringify(data) : "";
    } catch (e) {
        json = "(nicht darstellbar)";
    }
    queue.push((source + " " + event + " " + json).slice(0, 4000));
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    if (flushTimer === null) flushTimer = self.setTimeout(flush, 500);
}

async function flush() {
    flushTimer = null;
    if (queue.length === 0) return;
    const lines = queue.splice(0, queue.length);
    try {
        await ferry?.rpc?.ferryDiagLog(lines);
    } catch (e) {
        // ohne Verbindung gehen die Meldungen verloren (nur Diagnose)
    }
}
