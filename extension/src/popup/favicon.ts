async function sleep(milliseconds: number) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

export function fetchFavicon(url): Promise<string> {
    return new Promise(function (resolve) {
        if (!url) {
            resolve(undefined);
            return;
        }
        const img = new Image();
        img.onload = function (this: HTMLImageElement) {
            const canvas = document.createElement("canvas");
            canvas.width = this.width;
            canvas.height = this.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(this, 0, 0);
            const dataURL = canvas.toDataURL("image/png");
            resolve(dataURL.substr(22));
        };
        img.src = url;
    });
}

// Website-Symbol des aktiven Tabs und die Adresse der Seite, zu der es gehört
export async function getFaviconSource(): Promise<{ favIconUrl: string; pageUrl: string }> {
    for (let i = 0; i < 45; i++) {
        const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (tab) {
            return { favIconUrl: tab.favIconUrl, pageUrl: tab.url };
        }
        await sleep(1000);
    }
    return null;
}
