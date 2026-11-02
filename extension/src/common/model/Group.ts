import { EntrySummary } from "./EntrySummary";
import { Icon } from "./Icon";
import { utils } from "../utils";
import { GroupDto } from "./PluginDTOs";

export class Group {
    readonly title: string;
    readonly uuid: string;
    readonly icon: Icon;
    readonly path: string;
    readonly entrySummaries: EntrySummary[];
    readonly groups: Group[];
    //childEntries: Entry[] - this is only needed if we ever request GetAllDatabases(true) but KeePassFerry currently has no need for this plugin feature

    constructor(g: Partial<Group>) {
        this.title = g.title || "";
        this.uuid = g.uuid || utils.newGUID();
        this.icon = g.icon || { version: 1, iconImageData: "" };
        this.path = g.path || "UNKNOWN PATH";
        this.entrySummaries = g.entrySummaries || [];
        this.groups = g.groups || [];
    }

    public static fromPluginGroupDTO(groupDto: GroupDto, dbFileName: string) {
        return new Group({
            title: groupDto.title,
            uuid: groupDto.uniqueID,
            icon: { version: 1, iconImageData: groupDto.iconImageData },
            path: groupDto.path,
            entrySummaries: groupDto.childLightEntries.map(childLightEntry =>
                EntrySummary.fromPluginEntrySummaryDTO(childLightEntry, groupDto.path, dbFileName)
            ),
            groups: groupDto.childGroups.map(childGroup =>
                this.fromPluginGroupDTO(childGroup, dbFileName)
            )
        });
    }

    public static containsId(group: Group, id: string) {
        if (group.uuid === id) return true;
        if (group.groups && group.groups.some(g => Group.containsId(g, id))) return true;
        return false;
    }
    public static matchingId(group: Group, id: string): Group | null {
        if (group.uuid === id) {
            return group;
        }

        for (const childGroup of group.groups) {
            const matchingChildGroup = Group.matchingId(childGroup, id);
            if (matchingChildGroup) {
                return matchingChildGroup;
            }
        }

        return null;
    }

}
