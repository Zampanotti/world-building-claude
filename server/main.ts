import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb, type DB } from "./db.ts";
import { dispatch, FileResponse } from "./api.ts";
import { HttpError } from "./errors.ts";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };

function send(res: ServerResponse, status: number, body: unknown) {
  if (body instanceof FileResponse) {
    res.writeHead(status === 201 ? 200 : status, {
      "Content-Type": body.mime,
      "Content-Length": body.data.length,
      "X-Content-Type-Options": "nosniff",
      ...(body.cache ? { "Cache-Control": body.cache } : { "Cache-Control": "no-store" }),
      ...(body.filename ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(body.filename)}` } : {}),
    });
    res.end(body.data);
    return;
  }
  const json = JSON.stringify(body ?? null);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(json);
}

/** Crée le serveur HTTP : API JSON sous /api, application compilée (dist/) ailleurs. */
export function createApp(db: DB, opts: { dataDir: string | null; staticDir?: string }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const r = await dispatch(db, opts.dataDir, req, url);
        if (!r) throw new HttpError(404, "Route inconnue.");
        return send(res, r.status, r.result);
      }
      if (!opts.staticDir) throw new HttpError(404, "Introuvable.");
      const root = resolve(opts.staticDir);
      let file = resolve(join(root, decodeURIComponent(url.pathname)));
      if (!file.startsWith(root)) throw new HttpError(403, "Interdit.");
      const st = await stat(file).catch(() => null);
      if (!st || st.isDirectory()) file = join(root, "index.html"); // routage côté client
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
      res.end(data);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, details: e.details });
      console.error(e);
      send(res, 500, { error: "Erreur interne du serveur. Aucune donnée n'a été modifiée si l'opération était en cours." });
    }
  });
}

// Lancé directement (et non importé par les tests). pathToFileURL est indispensable
// sous Windows, où le chemin « P:\\… » ne ressemble pas à l'URL « file:///P:/… ».
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dataDir = resolve(process.env.WB_DATA_DIR ?? "data");
  const db = openDb(join(dataDir, "worldbuilding.db"));
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  createApp(db, { dataDir, staticDir: resolve("dist") }).listen(port, host, () => {
    console.log(`World Building prêt sur http://${host === "0.0.0.0" ? "localhost" : host}:${port}  (données : ${dataDir})`);
  });
}
