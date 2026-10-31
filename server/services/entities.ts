import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad, conflict, int, notFound, optInt, str } from "../errors.ts";
import { owned, bool } from "./common.ts";
import { linkedIds, LINK_RE, toPlainText, type Excerpt } from "../../shared/richtext.ts";
import { formatSpan, formatPoint, spanProblems, validatePoint, type Era, type TimeSpan, type DatePoint } from "../../shared/time.ts";

export function listEras(db: DB, wid: number): Era[] {
  return all<Era>(db, "SELECT id, name, position, duration, gap_before AS gapBefore, color FROM era WHERE world_id = ? ORDER BY position", wid);
}

/** Recherche rapide par nom pour les sélecteurs (20 résultats). */
export function suggestEntities(db: DB, wid: number, q: string, typeId: number | null) {
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  return all(db, `SELECT e.id, e.name, t.name AS typeName, t.color AS typeColor FROM entity e
    LEFT JOIN entity_type t ON t.id = e.type_id
    WHERE e.world_id = ? AND e.name LIKE ? ESCAPE '\\' ${typeId ? "AND e.type_id = " + typeId : ""}
    ORDER BY (e.name = ? COLLATE NOCASE) DESC, (e.name LIKE ? ESCAPE '\\') DESC, e.name COLLATE NOCASE, e.id LIMIT 20`,
    wid, like, q, `${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
}

/**
 * Explorateur : pagination par curseur (nom sans casse puis identifiant), stable
 * même si des fiches sont créées entre deux pages. Filtre type (`none` = sans
 * type) et étiquette. Ne lit que ce qui est affiché dans la liste.
 */
export function exploreEntities(db: DB, wid: number, p: URLSearchParams) {
  const where = ["e.world_id = ?"];
  const args: unknown[] = [wid];
  const q = (p.get("q") ?? "").trim();
  if (q) { where.push("e.name LIKE ? ESCAPE '\\'"); args.push(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`); }
  const type = p.get("type");
  if (type === "none") where.push("e.type_id IS NULL");
  else if (type) { where.push("e.type_id = ?"); args.push(owned(db, "entity_type", type, wid, "Type")); }
  const tag = p.get("tag");
  if (tag) { where.push("EXISTS (SELECT 1 FROM entity_tag et WHERE et.entity_id = e.id AND et.tag_id = ?)"); args.push(owned(db, "tag", tag, wid, "Étiquette")); }
  const cursor = p.get("cursor");
  if (cursor) {
    const [cname, cid] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, number];
    where.push("(e.name COLLATE NOCASE > ? OR (e.name = ? COLLATE NOCASE AND e.id > ?))");
    args.push(cname, cname, cid);
  }
  const limit = Math.min(100, Math.max(1, Number(p.get("limit")) || 50));
  const rows = all<{ id: number; name: string }>(db, `SELECT e.id, e.name, e.summary, e.updated_at AS updatedAt, t.id AS typeId, t.name AS typeName, t.color AS typeColor,
      (SELECT m.media_id FROM entity_media m WHERE m.entity_id = e.id ORDER BY m.position LIMIT 1) AS imageId,
      (SELECT GROUP_CONCAT(tg.name, ', ') FROM entity_tag et JOIN tag tg ON tg.id = et.tag_id WHERE et.entity_id = e.id) AS tags
    FROM entity e LEFT JOIN entity_type t ON t.id = e.type_id
    WHERE ${where.join(" AND ")} ORDER BY e.name COLLATE NOCASE, e.id LIMIT ?`, ...args, limit + 1);
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: more && last ? Buffer.from(JSON.stringify([last.name, last.id])).toString("base64url") : null };
}

export function createEntity(db: DB, wid: number, body: Record<string, unknown>) {
  const name = str(body.name, "nom", { max: 200 });
  const typeId = body.typeId === null || body.typeId === undefined ? null : owned(db, "entity_type", body.typeId, wid, "Type");
  const summary = typeof body.summary === "string" ? body.summary.slice(0, 500) : "";
  return { id: insert(db, "INSERT INTO entity (world_id, type_id, name, summary) VALUES (?, ?, ?, ?)", wid, typeId, name, summary) };
}

type Def = { id: number; name: string; kind: string; archived: boolean; typeId: number };

/** Valide une valeur selon le genre de propriété ; renvoie le JSON à stocker. */
function encodeValue(db: DB, wid: number, def: Def, v: unknown): string {
  switch (def.kind) {
    case "text": return JSON.stringify(str(v, def.name, { max: 500 }));
    case "longtext": return JSON.stringify(str(v, def.name, { max: 20000 }));
    case "number": {
      const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) throw bad(`« ${def.name} » doit être un nombre.`);
      return JSON.stringify(n);
    }
    case "boolean": if (typeof v !== "boolean") throw bad(`« ${def.name} » doit être vrai ou faux.`); return JSON.stringify(v);
    case "date": {
      const err = validatePoint(v);
      if (err) throw bad(`« ${def.name} » : ${err}`);
      owned(db, "era", (v as DatePoint).eraId, wid, "Ère");
      const d = v as DatePoint;
      return JSON.stringify({ eraId: d.eraId, year: d.year, month: d.month, day: d.day, approx: d.approx });
    }
    case "entity": return JSON.stringify(owned(db, "entity", v, wid, "Fiche liée"));
  }
  throw bad("Genre de propriété inconnu.");
}

function readSpan(db: DB, id: number): TimeSpan | null {
  const r = get<{ data: string }>(db, "SELECT data FROM time_span WHERE entity_id = ?", id);
  return r ? (JSON.parse(r.data) as TimeSpan) : null;
}

/** Fiche complète telle qu'affichée dans l'application. */
export function getEntity(db: DB, wid: number, id: number) {
  const e = get<{ id: number; name: string; summary: string; description: string; revision: number; typeId: number | null; updatedAt: string; createdAt: string }>(db,
    "SELECT id, name, summary, description, revision, type_id AS typeId, updated_at AS updatedAt, created_at AS createdAt FROM entity WHERE id = ? AND world_id = ?", id, wid);
  if (!e) throw notFound("Fiche introuvable dans ce monde.");
  const type = e.typeId ? get(db, "SELECT id, name, color FROM entity_type WHERE id = ?", e.typeId) : null;
  const values = new Map(all<{ defId: number; value: string }>(db, "SELECT def_id AS defId, value FROM property_value WHERE entity_id = ?", id).map((r) => [r.defId, JSON.parse(r.value)]));
  const defs = e.typeId
    ? all<Def>(db, "SELECT id, name, kind, archived, type_id AS typeId FROM property_def WHERE type_id = ? ORDER BY position, id", e.typeId).map((d) => ({ ...d, archived: bool(d.archived) }))
    : [];
  const properties = defs.filter((d) => !d.archived || values.has(d.id)).map((d) => ({ def: d, value: values.has(d.id) ? values.get(d.id) : null }));
  // Valeurs des anciens types : conservées, signalées mais non affichées comme actives.
  const hiddenValues = values.size - properties.filter((p) => p.value !== null).length;
  const eras = listEras(db, wid);
  const timeSpan = readSpan(db, id);
  const refIds = new Set<number>(linkedIds(e.description));
  for (const p of properties) if (p.def.kind === "entity" && p.value) refIds.add(p.value as number);
  const names: Record<number, { name: string; typeColor: string | null }> = {};
  for (const rid of refIds) {
    const r = get<{ name: string; typeColor: string | null }>(db, "SELECT e.name, t.color AS typeColor FROM entity e LEFT JOIN entity_type t ON t.id = e.type_id WHERE e.id = ? AND e.world_id = ?", rid, wid);
    if (r) names[rid] = r;
  }
  const pub = get<{ snapshot: string; publishedAt: string }>(db, "SELECT snapshot, published_at AS publishedAt FROM publication WHERE entity_id = ?", id);
  return {
    ...e,
    type,
    properties,
    hiddenValues,
    tags: all(db, "SELECT t.id, t.name, t.color FROM entity_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entity_id = ? ORDER BY t.name", id),
    images: all(db, `SELECT m.id AS mediaId, m.name, m.width, m.height, em.caption, em.position FROM entity_media em
      JOIN media m ON m.id = em.media_id WHERE em.entity_id = ? ORDER BY em.position`, id),
    timeSpan,
    timeLabel: timeSpan ? formatSpan(timeSpan, eras) : null,
    timeProblems: timeSpan ? spanProblems(timeSpan, eras) : [],
    ownMap: get(db, "SELECT id, name FROM map WHERE entity_id = ?", id) ?? null,
    pins: all(db, "SELECT p.id AS pinId, m.id AS mapId, m.name AS mapName FROM map_pin p JOIN map m ON m.id = p.map_id WHERE p.entity_id = ? ORDER BY m.name", id),
    names,
    publication: pub ? { publishedAt: pub.publishedAt, upToDate: (JSON.parse(pub.snapshot) as { revision: number }).revision === e.revision } : null,
  };
}

/**
 * Modification d'une fiche avec contrôle optimiste : `expectedRevision` doit
 * correspondre à la révision enregistrée, sinon 409 et rien n'est écrit. Toute
 * modification incrémente la révision. Ne touche jamais l'état publié.
 */
export function updateEntity(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  const expected = int(body.expectedRevision, "expectedRevision");
  return tx(db, () => {
    const cur = get<{ revision: number; typeId: number | null }>(db, "SELECT revision, type_id AS typeId FROM entity WHERE id = ? AND world_id = ?", id, wid);
    if (!cur) throw notFound("Fiche introuvable dans ce monde.");
    if (cur.revision !== expected) throw conflict("La fiche a été modifiée ailleurs. Rechargez-la pour voir la dernière version.", { revision: cur.revision });
    if (body.name !== undefined) run(db, "UPDATE entity SET name = ? WHERE id = ?", str(body.name, "nom", { max: 200 }), id);
    if (body.summary !== undefined) run(db, "UPDATE entity SET summary = ? WHERE id = ?", str(body.summary, "résumé", { max: 500, allowEmpty: true }), id);
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 200000) throw bad("Description invalide.");
      run(db, "UPDATE entity SET description = ? WHERE id = ?", body.description, id);
    }
    let typeId = cur.typeId;
    if (body.typeId !== undefined) {
      typeId = body.typeId === null ? null : owned(db, "entity_type", body.typeId, wid, "Type");
      run(db, "UPDATE entity SET type_id = ? WHERE id = ?", typeId, id);
    }
    if (body.properties !== undefined) {
      if (!body.properties || typeof body.properties !== "object") throw bad("Propriétés invalides.");
      for (const [k, v] of Object.entries(body.properties as Record<string, unknown>)) {
        const def = get<Def>(db, "SELECT id, name, kind, archived, type_id AS typeId FROM property_def WHERE id = ? AND world_id = ?", Number(k), wid);
        if (!def || def.typeId !== typeId) throw bad("Cette propriété n'appartient pas au type de la fiche.");
        if (v === null || v === "") run(db, "DELETE FROM property_value WHERE entity_id = ? AND def_id = ?", id, def.id);
        else run(db, "INSERT INTO property_value (entity_id, def_id, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value", id, def.id, encodeValue(db, wid, def, v));
      }
    }
    if (body.tagIds !== undefined) {
      if (!Array.isArray(body.tagIds)) throw bad("Étiquettes invalides.");
      const ids = body.tagIds.map((t) => owned(db, "tag", t, wid, "Étiquette"));
      run(db, "DELETE FROM entity_tag WHERE entity_id = ?", id);
      for (const t of new Set(ids)) run(db, "INSERT INTO entity_tag (entity_id, tag_id) VALUES (?, ?)", id, t);
    }
    if (body.timeSpan !== undefined) {
      if (body.timeSpan === null) run(db, "DELETE FROM time_span WHERE entity_id = ?", id);
      else {
        const s = body.timeSpan as TimeSpan;
        for (const p of [s?.start, s?.end].filter((x) => x !== null)) {
          const err = validatePoint(p);
          if (err) throw bad(err);
          owned(db, "era", (p as DatePoint).eraId, wid, "Ère");
        }
        const clean = (p: DatePoint) => ({ eraId: p.eraId, year: p.year, month: p.month, day: p.day, approx: p.approx });
        run(db, "INSERT INTO time_span (entity_id, data) VALUES (?, ?) ON CONFLICT DO UPDATE SET data = excluded.data", id,
          JSON.stringify({ start: clean(s.start), end: s.end ? clean(s.end) : null }));
      }
    }
    run(db, "UPDATE entity SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?", id);
    return getEntity(db, wid, id);
  });
}

/** Supprimer une fiche garde les textes qui la citent : leurs liens deviennent « cassés ». */
export function deleteEntity(db: DB, wid: number, id: number) {
  owned(db, "entity", id, wid, "Fiche");
  run(db, "DELETE FROM entity WHERE id = ?", id);
  return { deleted: true };
}

// ---- Images d'une fiche ---------------------------------------------------------------

export function attachImage(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "entity", id, wid, "Fiche");
  const mid = owned(db, "media", body.mediaId, wid, "Image");
  return tx(db, () => {
    if (get(db, "SELECT 1 FROM entity_media WHERE entity_id = ? AND media_id = ?", id, mid)) throw conflict("Cette image est déjà sur la fiche.");
    const pos = Number(get<{ p: number }>(db, "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM entity_media WHERE entity_id = ?", id)!.p);
    run(db, "INSERT INTO entity_media (entity_id, media_id, position, caption) VALUES (?, ?, ?, ?)", id, mid, pos,
      typeof body.caption === "string" ? body.caption.slice(0, 500) : "");
    touch(db, id);
    return { ok: true };
  });
}

export function updateImage(db: DB, wid: number, id: number, mid: number, body: Record<string, unknown>) {
  owned(db, "entity", id, wid, "Fiche");
  const r = run(db, "UPDATE entity_media SET caption = ? WHERE entity_id = ? AND media_id = ?", str(body.caption, "légende", { max: 500, allowEmpty: true }), id, mid);
  if (!r.changes) throw notFound("Image absente de cette fiche.");
  touch(db, id);
  return { ok: true };
}

export function detachImage(db: DB, wid: number, id: number, mid: number) {
  owned(db, "entity", id, wid, "Fiche");
  tx(db, () => {
    run(db, "DELETE FROM entity_media WHERE entity_id = ? AND media_id = ?", id, mid);
    renumber(db, id, all<{ m: number }>(db, "SELECT media_id AS m FROM entity_media WHERE entity_id = ? ORDER BY position", id).map((r) => r.m));
    touch(db, id);
  });
  return { ok: true };
}

/** Nouvel ordre de la galerie ; la première image devient l'image principale. */
export function reorderImages(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "entity", id, wid, "Fiche");
  if (!Array.isArray(body.order)) throw bad("Ordre invalide.");
  const order = body.order.map((x) => int(x, "ordre"));
  return tx(db, () => {
    const cur = all<{ m: number }>(db, "SELECT media_id AS m FROM entity_media WHERE entity_id = ? ORDER BY position", id).map((r) => r.m);
    if (cur.length !== order.length || [...cur].sort().join() !== [...order].sort().join()) throw conflict("La galerie a changé entre-temps.");
    renumber(db, id, order);
    touch(db, id);
    return { ok: true };
  });
}

function renumber(db: DB, id: number, order: number[]) {
  order.forEach((m, i) => run(db, "UPDATE entity_media SET position = ? WHERE entity_id = ? AND media_id = ?", i, id, m));
}

function touch(db: DB, id: number) {
  run(db, "UPDATE entity SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?", id);
}

// ---- Citations dans l'écriture --------------------------------------------------------

/** Extraits où le lien vers la fiche apparaît, positions calculées à la lecture. */
function linkExcerpts(text: string, id: number, names: Map<number, string>): { excerpts: Excerpt[]; total: number } {
  const excerpts: Excerpt[] = [];
  let plain = "";
  let last = 0;
  let total = 0;
  const spans: [number, number][] = [];
  for (const m of text.matchAll(LINK_RE)) {
    plain += toPlainText(text.slice(last, m.index), names);
    const label = names.get(Number(m[1])) ?? m[2];
    if (Number(m[1]) === id) { spans.push([plain.length, label.length]); total++; }
    plain += label;
    last = m.index! + m[0].length;
  }
  plain += toPlainText(text.slice(last), names);
  for (const [s, l] of spans.slice(0, 3)) {
    const from = Math.max(0, s - 70), to = Math.min(plain.length, s + l + 70);
    excerpts.push({ before: (from ? "…" : "") + plain.slice(from, s), match: plain.slice(s, s + l), after: plain.slice(s + l, to) + (to < plain.length ? "…" : "") });
  }
  return { excerpts, total };
}

export function entityMentions(db: DB, wid: number, id: number) {
  owned(db, "entity", id, wid, "Fiche");
  const needle = `%[[${id}|%`;
  const names = new Map(all<{ id: number; name: string }>(db, "SELECT id, name FROM entity WHERE world_id = ?", wid).map((r) => [r.id, r.name]));
  const sections = all<{ id: number; title: string; content: string; documentId: number; documentTitle: string; parentId: number | null }>(db,
    `SELECT s.id, s.title, s.content, s.parent_id AS parentId, d.id AS documentId, d.title AS documentTitle FROM section s
     JOIN document d ON d.id = s.document_id WHERE d.world_id = ? AND s.content LIKE ? ORDER BY d.title COLLATE NOCASE, s.position`, wid, needle);
  const entities = all<{ id: number; name: string; description: string }>(db,
    "SELECT id, name, description FROM entity WHERE world_id = ? AND id <> ? AND description LIKE ? ORDER BY name COLLATE NOCASE", wid, id, needle);
  return {
    sections: sections.map((s) => ({ id: s.id, title: s.title, documentId: s.documentId, documentTitle: s.documentTitle, path: sectionPath(db, s.parentId), ...linkExcerpts(s.content, id, names) })).filter((s) => s.total > 0),
    entities: entities.map((e) => ({ id: e.id, name: e.name, ...linkExcerpts(e.description, id, names) })).filter((e) => e.total > 0),
  };
}

export function sectionPath(db: DB, parentId: number | null): string[] {
  const path: string[] = [];
  const seen = new Set<number>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const p = get<{ title: string; parentId: number | null }>(db, "SELECT title, parent_id AS parentId FROM section WHERE id = ?", parentId);
    if (!p) break;
    path.unshift(p.title);
    parentId = p.parentId;
  }
  return path;
}

// ---- Publication ----------------------------------------------------------------------

/**
 * Publication explicite : un instantané figé de la fiche est enregistré. Les
 * modifications ultérieures ne le changent pas tant qu'on ne republie pas.
 */
export function publishEntity(db: DB, wid: number, id: number) {
  return tx(db, () => {
    const e = getEntity(db, wid, id);
    const snapshot = {
      revision: e.revision,
      name: e.name,
      summary: e.summary,
      description: e.description,
      type: e.type,
      properties: e.properties.filter((p) => !p.def.archived && p.value !== null).map((p) => ({
        name: p.def.name, kind: p.def.kind === "date" ? "text" : p.def.kind,
        value: p.def.kind === "entity" ? { id: p.value, name: e.names[p.value as number]?.name ?? null } : p.def.kind === "date" ? formatPoint(p.value as DatePoint, listEras(db, wid)) : p.value,
      })),
      imageId: (e.images[0] as { mediaId: number } | undefined)?.mediaId ?? null,
      timeLabel: e.timeLabel,
      tags: e.tags,
    };
    run(db, `INSERT INTO publication (entity_id, world_id, snapshot, published_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT DO UPDATE SET snapshot = excluded.snapshot, published_at = excluded.published_at`, id, wid, JSON.stringify(snapshot));
    return { published: true };
  });
}

export function unpublishEntity(db: DB, wid: number, id: number) {
  owned(db, "entity", id, wid, "Fiche");
  run(db, "DELETE FROM publication WHERE entity_id = ?", id);
  return { published: false };
}

export function publicWorld(db: DB, wid: number) {
  const world = get(db, "SELECT id, name, description FROM world WHERE id = ?", wid);
  if (!world) throw notFound("Monde introuvable.");
  const items = all<{ entityId: number; snapshot: string; publishedAt: string }>(db, "SELECT entity_id AS entityId, snapshot, published_at AS publishedAt FROM publication WHERE world_id = ?", wid)
    .map((r) => { const s = JSON.parse(r.snapshot); return { id: r.entityId, name: s.name, summary: s.summary, type: s.type, imageId: s.imageId, publishedAt: r.publishedAt }; })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { world, items };
}

export function publicEntity(db: DB, wid: number, id: number) {
  const r = get<{ snapshot: string; publishedAt: string }>(db, "SELECT snapshot, published_at AS publishedAt FROM publication WHERE world_id = ? AND entity_id = ?", wid, id);
  if (!r) throw notFound("Cette fiche n'est pas publiée.");
  const s = JSON.parse(r.snapshot);
  // Seuls les liens vers des fiches elles-mêmes publiées sont exposés au lecteur.
  const published = new Map(all<{ id: number; snapshot: string }>(db, "SELECT entity_id AS id, snapshot FROM publication WHERE world_id = ?", wid).map((p) => [p.id, JSON.parse(p.snapshot).name as string]));
  return { ...s, id, publishedAt: r.publishedAt, publishedNames: Object.fromEntries(published), revision: undefined };
}

export function publicMediaAllowed(db: DB, wid: number, mid: number): boolean {
  return all<{ snapshot: string }>(db, "SELECT snapshot FROM publication WHERE world_id = ?", wid).some((r) => JSON.parse(r.snapshot).imageId === mid);
}

export { optInt };
