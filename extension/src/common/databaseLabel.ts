// Anzeigename einer Datenbank: Name aus KeePass, sonst Dateiname ohne Pfad und ".kdbx"
export function databaseLabel(db: { name?: string; fileName?: string }): string {
    if (!db) return "";
    if (db.name) return db.name;
    return (db.fileName ?? "").replace(/^.*[\\/]/, "").replace(/\.kdbx$/i, "");
}
