/*
passkeyGroups.ts: Gruppen für einen neuen Passkey-Eintrag, wie beim Speichern einer neuen Anmeldung im Popup.
Vorauswahl: zuletzt benutzte Gruppe (mruGroup), sonst die Wurzel der aktiven Datenbank. Gefragt wird nicht, wenn
"Gruppe merken" an ist und die zuletzt benutzte Gruppe noch existiert.
*/

export interface GroupNode {
    uuid: string;
    title: string;
    path?: string;
    groups?: GroupNode[];
}

export interface DatabaseNode {
    fileName: string;
    name: string;
    readOnly?: boolean;
    root: GroupNode;
}

export interface PasskeyGroupChoice {
    key: string;
    uuid: string;
    dbFileName: string;
    // Ganzer Pfad (für "Gruppe: …")
    label: string;
    dbName: string;
    // Für die Baumansicht: eigener Name, Ebene, übergeordnete Gruppe, hat Untergruppen
    name: string;
    depth: number;
    parentKey: string;
    hasChildren: boolean;
}

const PRIMARY = "{<{{<<ferry-primary>>}}>}";

export function groupKey(dbFileName: string, uuid: string) {
    return dbFileName + "|" + uuid;
}

export function passkeyGroupChoices(
    databases: DatabaseNode[],
    activeIndex: number,
    mruGroup: { [key: string]: string },
    rememberMruGroup: boolean
): { groups: PasskeyGroupChoice[]; preferredKey: string; ask: boolean } {
    const writable = (databases ?? []).filter(db => db?.root && !db.readOnly);
    const groups: PasskeyGroupChoice[] = [];
    // Mehrere Datenbanken: jede Gruppe mit dem Namen ihrer Datenbank davor, die Wurzel nur mit dem Datenbanknamen
    const several = writable.length > 1;
    for (const db of writable) {
        const dbName = db.name || db.fileName;
        const walk = (g: GroupNode, depth: number, parentKey: string) => {
            const path = (g.path || g.title).split("/").join(" › ");
            const isRoot = g.uuid === db.root.uuid;
            const label = several ? (isRoot ? dbName : dbName + " › " + path) : isRoot ? db.root.title || dbName : path;
            const key = groupKey(db.fileName, g.uuid);
            const name = isRoot ? (several ? dbName : db.root.title || dbName) : g.title;
            const children = g.groups ?? [];
            groups.push({ key, uuid: g.uuid, dbFileName: db.fileName, label, dbName, name, depth, parentKey, hasChildren: children.length > 0 });
            for (const child of children) walk(child, depth + 1, key);
        };
        walk(db.root, 0, "");
    }

    const candidates = [mruGroup?.[PRIMARY]];
    if (writable.length === 1) candidates.push(mruGroup?.[writable[0].fileName]);
    const remembered = candidates.map(uuid => groups.find(g => uuid && g.uuid === uuid)).find(Boolean);

    const active = databases?.[activeIndex];
    const activeDb = active && !active.readOnly && active.root ? active : writable[0];
    const fallback = activeDb ? groups.find(g => g.key === groupKey(activeDb.fileName, activeDb.root.uuid)) : undefined;

    const preferred = remembered ?? fallback;
    return { groups, preferredKey: preferred?.key ?? "", ask: !(rememberMruGroup && remembered) };
}
