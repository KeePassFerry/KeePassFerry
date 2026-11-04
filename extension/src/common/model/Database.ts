import { SessionType } from "../SessionType";
import { DatabaseDto } from "./PluginDTOs";
import { Icon } from "./Icon";
import { Group } from "./Group";

export class Database {
    name: string;
    fileName: string;
    icon: Icon;
    root: Group;
    active: boolean;
    // Nicht beschreibbar (z. B. nur lesend geteilt): beim Speichern nicht anbieten
    readOnly: boolean;
    sessionType: SessionType;
    sessionFeatures: string[];

    constructor(db: Partial<Database>) {
        this.name = db.name || "";
        this.fileName = db.fileName || "";
        this.icon = db.icon || { version: 1, iconImageData: "" };
        this.root = db.root || new Group({});
        this.active = db.active || false;
        this.readOnly = db.readOnly || false;
        this.sessionType = db.sessionType || SessionType.Event;
        this.sessionFeatures = db.sessionFeatures || [""];
    }

    public static fromPluginDatabaseDTO(
        dto: DatabaseDto,
        sessionType: SessionType,
        sessionFeatures: string[]
    ) {
        return new Database({
            name: dto.name,
            fileName: dto.fileName,
            icon: { version: 1, iconImageData: dto.iconImageData },
            root: Group.fromPluginGroupDTO(dto.root, dto.fileName),
            active: dto.active,
            readOnly: !!dto.readOnly,
            sessionType,
            sessionFeatures
        });
    }
}
