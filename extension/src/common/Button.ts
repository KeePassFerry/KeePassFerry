export type ButtonAction =
    | "disableNotifyWhenEntryUpdated"
    | "startPluginUpdate"
    | "launchLoginEditorFromNotification";

export interface Button {
    label: string;
    action?: ButtonAction;
    id?: string;
    tooltip?: string;
    values?: { [id: string]: string };
}
