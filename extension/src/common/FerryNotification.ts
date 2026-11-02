import type { Button } from "./Button";

// These notifications are displayed within the KeePassFerry browser action popup.
// They may persist for significant lengths of time.
// For transient system notification popups (sometimes known as growls)
// look at the background/NativeNotification class

export class FerryNotification {
    constructor(
        public name: string,
        public buttons: Button[],
        public id: string, //Guid
        public messages: string[],
        public priority: "High" | "Medium" | "Low"
    ) {}
}
