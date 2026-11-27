// Tab, zu dem das Popup gehört (das Popup hängt am Browserfenster, dessen aktiver Tab gemeint ist); -1 = unbekannt
export async function currentTabId(): Promise<number> {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.id ?? -1;
    } catch (e) {
        return -1;
    }
}
