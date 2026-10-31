import type { IncomingMessage } from "node:http";
import type { DB } from "./db.ts";
import { HttpError, bad, int, optInt } from "./errors.ts";
import { requireWorld } from "./services/common.ts";
import * as W from "./services/worlds.ts";
import * as E from "./services/entities.ts";
import * as R from "./services/relations.ts";
import * as M from "./services/media.ts";
import * as Maps from "./services/maps.ts";
import * as C from "./services/chronology.ts";
import * as D from "./services/documents.ts";
import { searchWorld } from "./services/search.ts";
import { exportWorld, importWorld } from "./services/archive.ts";
import { createExampleWorld } from "./services/example.ts";

export interface Ctx {
  db: DB;
  dataDir: string | null;
  params: Record<string, string>;
  query: URLSearchParams;
  wid: number;
  body: () => Promise<Record<string, unknown>>;
  raw: () => Promise<Buffer>;
}

/** Réponse binaire (image) ou téléchargement plutôt que JSON. */
export class FileResponse {
  mime: string; data: Uint8Array; filename?: string; cache?: string;
  constructor(mime: string, data: Uint8Array, opts: { filename?: string; cache?: string } = {}) {
    this.mime = mime; this.data = data; this.filename = opts.filename; this.cache = opts.cache;
  }
}

type Handler = (c: Ctx) => unknown | Promise<unknown>;
const routes: { method: string; re: RegExp; keys: string[]; h: Handler; limit: number }[] = [];

function route(method: string, path: string, h: Handler, limit = 2 * 1024 * 1024) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, re, keys, h, limit });
}

const id = (c: Ctx, k = "id") => int(c.params[k], k);

// Mondes
route("GET", "/api/worlds", (c) => W.listWorlds(c.db));
route("POST", "/api/worlds", async (c) => W.createWorld(c.db, await c.body()));
route("POST", "/api/worlds/example", (c) => createExampleWorld(c.db));
route("POST", "/api/worlds/import", async (c) => importWorld(c.db, await c.body()), 600 * 1024 * 1024);
route("GET", "/api/worlds/:wid", (c) => W.worldOverview(c.db, c.wid));
route("PATCH", "/api/worlds/:wid", async (c) => W.updateWorld(c.db, c.wid, await c.body()));
route("DELETE", "/api/worlds/:wid", async (c) => W.deleteWorld(c.db, c.wid, (await c.body()).confirmName, c.dataDir));
route("GET", "/api/worlds/:wid/export", (c) => {
  const archive = exportWorld(c.db, c.wid, c.query.get("images") !== "0");
  const name = String((archive.world as { name: string }).name).replace(/[^\p{L}\p{N}-]+/gu, "-");
  return new FileResponse("application/json", Buffer.from(JSON.stringify(archive)), { filename: `${name}-${new Date().toISOString().slice(0, 10)}.json` });
});

// Types, propriétés, étiquettes
route("GET", "/api/worlds/:wid/types", (c) => W.listTypes(c.db, c.wid));
route("POST", "/api/worlds/:wid/types", async (c) => W.createType(c.db, c.wid, await c.body()));
route("PATCH", "/api/worlds/:wid/types/:id", async (c) => W.updateType(c.db, c.wid, id(c), await c.body()));
route("DELETE", "/api/worlds/:wid/types/:id", (c) => W.deleteType(c.db, c.wid, id(c)));
route("POST", "/api/worlds/:wid/types/:id/properties", async (c) => W.createProperty(c.db, c.wid, id(c), await c.body()));
route("PATCH", "/api/worlds/:wid/properties/:id", async (c) => W.updateProperty(c.db, c.wid, id(c), await c.body()));
route("GET", "/api/worlds/:wid/tags", (c) => W.listTags(c.db, c.wid));
route("POST", "/api/worlds/:wid/tags", async (c) => W.createTag(c.db, c.wid, await c.body()));
route("DELETE", "/api/worlds/:wid/tags/:id", (c) => W.deleteTag(c.db, c.wid, id(c)));

// Fiches
route("GET", "/api/worlds/:wid/entities", (c) => E.exploreEntities(c.db, c.wid, c.query));
route("GET", "/api/worlds/:wid/entities/suggest", (c) => E.suggestEntities(c.db, c.wid, c.query.get("q") ?? "", optInt(c.query.get("type"), "type")));
route("POST", "/api/worlds/:wid/entities", async (c) => E.createEntity(c.db, c.wid, await c.body()));
route("GET", "/api/worlds/:wid/entities/:id", (c) => E.getEntity(c.db, c.wid, id(c)));
route("PATCH", "/api/worlds/:wid/entities/:id", async (c) => E.updateEntity(c.db, c.wid, id(c), await c.body()));
route("DELETE", "/api/worlds/:wid/entities/:id", (c) => E.deleteEntity(c.db, c.wid, id(c)));
route("GET", "/api/worlds/:wid/entities/:id/relations", (c) => R.entityRelations(c.db, c.wid, id(c)));
route("GET", "/api/worlds/:wid/entities/:id/family", (c) => R.familyTree(c.db, c.wid, id(c), int(c.query.get("type"), "type"), c.query.get("reverse") === "1"));
route("GET", "/api/worlds/:wid/entities/:id/mentions", (c) => E.entityMentions(c.db, c.wid, id(c)));
route("POST", "/api/worlds/:wid/entities/:id/images", async (c) => E.attachImage(c.db, c.wid, id(c), await c.body()));
route("PUT", "/api/worlds/:wid/entities/:id/images", async (c) => E.reorderImages(c.db, c.wid, id(c), await c.body()));
route("PATCH", "/api/worlds/:wid/entities/:id/images/:mid", async (c) => E.updateImage(c.db, c.wid, id(c), id(c, "mid"), await c.body()));
route("DELETE", "/api/worlds/:wid/entities/:id/images/:mid", (c) => E.detachImage(c.db, c.wid, id(c), id(c, "mid")));
route("POST", "/api/worlds/:wid/entities/:id/publish", (c) => E.publishEntity(c.db, c.wid, id(c)));
route("DELETE", "/api/worlds/:wid/entities/:id/publish", (c) => E.unpublishEntity(c.db, c.wid, id(c)));

// Relations
route("GET", "/api/worlds/:wid/relation-types", (c) => R.listRelationTypes(c.db, c.wid));
route("POST", "/api/worlds/:wid/relation-types", async (c) => R.createRelationType(c.db, c.wid, await c.body()));
route("PATCH", "/api/worlds/:wid/relation-types/:id", async (c) => R.updateRelationType(c.db, c.wid, id(c), await c.body()));
route("DELETE", "/api/worlds/:wid/relation-types/:id", (c) => R.deleteRelationType(c.db, c.wid, id(c)));
route("POST", "/api/worlds/:wid/relations", async (c) => R.createRelation(c.db, c.wid, await c.body()));
route("DELETE", "/api/worlds/:wid/relations/:id", (c) => R.deleteRelation(c.db, c.wid, id(c)));

// Médiathèque
route("GET", "/api/worlds/:wid/media", (c) => M.listMedia(c.db, c.wid));
route("POST", "/api/worlds/:wid/media", async (c) => M.addMedia(c.db, c.wid, c.query.get("name") ?? "image", await c.raw()), M.MAX_IMAGE_BYTES + 1);
route("GET", "/api/worlds/:wid/media/:id", (c) => {
  const f = M.mediaFile(c.db, c.wid, id(c));
  return new FileResponse(f.mime, f.data, { cache: "private, max-age=31536000, immutable" });
});
route("DELETE", "/api/worlds/:wid/media/:id", (c) => M.deleteMedia(c.db, c.wid, id(c)));

// Cartes
route("GET", "/api/worlds/:wid/maps", (c) => Maps.listMaps(c.db, c.wid));
route("POST", "/api/worlds/:wid/maps", async (c) => Maps.createMap(c.db, c.wid, await c.body()));
route("GET", "/api/worlds/:wid/maps/:id", (c) => Maps.getMap(c.db, c.wid, id(c)));
route("PATCH", "/api/worlds/:wid/maps/:id", async (c) => Maps.updateMap(c.db, c.wid, id(c), await c.body()));
route("DELETE", "/api/worlds/:wid/maps/:id", (c) => Maps.deleteMap(c.db, c.wid, id(c)));
route("POST", "/api/worlds/:wid/maps/:id/pins", async (c) => Maps.addPin(c.db, c.wid, id(c), await c.body()));
route("PATCH", "/api/worlds/:wid/maps/:id/pins/:pid", async (c) => Maps.movePin(c.db, c.wid, id(c), id(c, "pid"), await c.body()));
route("DELETE", "/api/worlds/:wid/maps/:id/pins/:pid", (c) => Maps.deletePin(c.db, c.wid, id(c), id(c, "pid")));

// Chronologie
route("GET", "/api/worlds/:wid/eras", (c) => E.listEras(c.db, c.wid));
route("PUT", "/api/worlds/:wid/eras", async (c) => C.saveEras(c.db, c.wid, await c.body()));
route("GET", "/api/worlds/:wid/chronology", (c) => C.chronology(c.db, c.wid, c.query));

// Écriture
route("GET", "/api/worlds/:wid/documents", (c) => D.listDocuments(c.db, c.wid));
route("POST", "/api/worlds/:wid/documents", async (c) => D.createDocument(c.db, c.wid, await c.body()));
route("GET", "/api/worlds/:wid/documents/:id", (c) => D.getDocument(c.db, c.wid, id(c)));
route("PATCH", "/api/worlds/:wid/documents/:id", async (c) => D.updateDocument(c.db, c.wid, id(c), await c.body()));
route("DELETE", "/api/worlds/:wid/documents/:id", (c) => D.deleteDocument(c.db, c.wid, id(c)));
route("POST", "/api/worlds/:wid/documents/:id/sections", async (c) => D.createSection(c.db, c.wid, id(c), await c.body()));
route("GET", "/api/worlds/:wid/sections/:id", (c) => D.getSection(c.db, c.wid, id(c)));
route("PATCH", "/api/worlds/:wid/sections/:id", async (c) => D.updateSection(c.db, c.wid, id(c), await c.body()), 4 * 1024 * 1024);
route("DELETE", "/api/worlds/:wid/sections/:id", (c) => D.deleteSection(c.db, c.wid, id(c)));
route("POST", "/api/worlds/:wid/sections/:id/move", async (c) => D.moveSection(c.db, c.wid, id(c), await c.body()));

// Recherche
route("GET", "/api/worlds/:wid/search", (c) => searchWorld(c.db, c.wid, c.query));

// Lecture publique : uniquement les instantanés publiés.
route("GET", "/api/public/:wid", (c) => E.publicWorld(c.db, c.wid));
route("GET", "/api/public/:wid/entities/:id", (c) => E.publicEntity(c.db, c.wid, id(c)));
route("GET", "/api/public/:wid/media/:id", (c) => {
  if (!E.publicMediaAllowed(c.db, c.wid, id(c))) throw new HttpError(404, "Image non publiée.");
  const f = M.mediaFile(c.db, c.wid, id(c));
  return new FileResponse(f.mime, f.data);
});

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Contenu trop volumineux.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Trouve et exécute la route ; null si aucune ne correspond. */
export async function dispatch(db: DB, dataDir: string | null, req: IncomingMessage, url: URL): Promise<{ status: number; result: unknown } | null> {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let raw: Promise<Buffer> | null = null;
    const getRaw = () => (raw ??= readBody(req, r.limit));
    const ctx: Ctx = {
      db, dataDir, params, query: url.searchParams, wid: 0,
      raw: getRaw,
      body: async () => {
        const buf = await getRaw();
        let v: unknown;
        try { v = JSON.parse(buf.toString("utf8") || "{}"); } catch { throw bad("Corps JSON invalide."); }
        if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("Corps JSON invalide.");
        return v as Record<string, unknown>;
      },
    };
    // Le monde est résolu et vérifié côté serveur avant tout accès aux données.
    if (params.wid !== undefined) ctx.wid = requireWorld(db, params.wid);
    const result = await r.h(ctx);
    return { status: req.method === "POST" ? 201 : 200, result };
  }
  return null;
}
