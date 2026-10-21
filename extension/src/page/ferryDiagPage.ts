import { configManager } from "../common/ConfigManager";
import { Port } from "../common/port";
import type { AddonMessage } from "../common/AddonMessage";

// Diagnosemeldung aus der Seite an den Hintergrund (nur bei eingeschaltetem Diagnoseprotokoll, nie Inhalte)
export function pageDiag(event: string, data?: Record<string, unknown>) {
    if (!configManager.current?.ferryDiagnostics || !Port.raw) return;
    try {
        Port.postMessage({ ferryDiag: { event, data } } as AddonMessage);
    } catch (e) {
        // Verbindung zum Hintergrund weg: Meldung verwerfen
    }
}
