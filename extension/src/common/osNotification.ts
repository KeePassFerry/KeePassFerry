import { browserName } from "./browserName";

// Firefox kennt requireInteraction nicht und lehnt die ganze Benachrichtigung mit „Unexpected property“ ab
// (Schema toolkit/components/extensions/schemas/notifications.json); dort bleibt sie so lange, wie das System sie zeigt
export function createOsNotification(id: string, options: chrome.notifications.NotificationCreateOptions) {
    const opts = { ...options };
    if (browserName() === "Firefox") delete opts.requireInteraction;
    return chrome.notifications.create(id, opts);
}
