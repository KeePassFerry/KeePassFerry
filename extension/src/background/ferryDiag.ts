import { configManager } from "../common/ConfigManager";
import { kee } from "./KF";

/*
ferryDiag.ts: Diagnoseprotokoll für die Entwicklung (Einstellung "Diagnoseprotokoll", standardmäßig aus).
Meldungen gehen gesammelt über den verschlüsselten Kanal an das Plugin, das sie in eine Datei schreibt
(Dokumente\KeePassFerry\diagnose.log). Nur Ereignisse und Merkmale, nie Passwörter, Codes oder Feldinhalte.
*/

const queue: string[] = [];
let flushTimer: number = null;

export function diagEnabled(): boolean {
    return !!configManager.current?.ferryDiagnostics;
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
        await kee?.KeePassRPC?.ferryDiagLog(lines);
    } catch (e) {
        // ohne Verbindung gehen die Meldungen verloren (nur Diagnose)
    }
}
