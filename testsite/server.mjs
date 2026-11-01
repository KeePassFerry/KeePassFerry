// Spielwiese für KeePassFerry: liefert den Ordner public/ unter http://127.0.0.1:8080/ aus.
// Ohne Abhängigkeiten (nur Node.js), nur auf diesem Rechner erreichbar. Anderer Port: PORT=8081 node server.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
};

createServer(async (req, res) => {
    let path;
    try {
        path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch (e) {
        res.writeHead(400).end();
        return;
    }
    const file = normalize(join(root, path.endsWith("/") ? path + "index.html" : path));
    // Nichts außerhalb von public/ ausliefern
    if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
        res.end(body);
    } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Nicht gefunden");
    }
}).listen(port, "127.0.0.1", () => {
    console.log(`Spielwiese läuft: http://127.0.0.1:${port}/  (beenden mit Strg+C)`);
});
