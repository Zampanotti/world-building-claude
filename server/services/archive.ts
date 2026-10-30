import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad } from "../errors.ts";
import { remapLinks, LINK_RE } from "../../shared/richtext.ts";
import { validatePoint, type DatePoint, type TimeSpan } from "../../shared/time.ts";
import { listTypes, listTags, uniqueWorldName, PROPERTY_KINDS } from "./worlds.ts";
import { listRelationTypes } from "./relations.ts";
import { listEras } from "./entities.ts";
import { sniffImage, MAX_IMAGE_BYTES } from "./media.ts";
import { createHash } from "node:crypto";

export const ARCHIVE_FORMAT = "world-building-claude";
export const ARCHIVE_VERSION = 1;

/**
 * Export complet de l'état de travail d'un monde, lu dans une seule transaction
 * pour être cohérent. Les exclusions sont écrites dans le fichier lui-même.
 */
export function exportWorld(db: DB, wid: number, includeImages: boolean) {
  db.exec("BEGIN");
  try {
    const world = get<{ name: string; description: string }>(db, "SELECT name, description FROM world WHERE id = ?", wid)!;
    const archive: Record<string, unknown> = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      world,
      excluded: ["État publié (instantanés des fiches publiées)", "Brouillons non enregistrés conservés dans le navigateur",
        ...(includeImages ? [] : ["Images, galeries et cartes (option « Inclure les images » décochée)"])],
      types: listTypes(db, wid).map(({ count: _c, ...t }) => ({ ...t, properties: t.properties.map(({ typeId: _t, ...p }) => p) })),
      tags: listTags(db, wid).map(({ count: _c, ...t }: Record<string, unknown>) => t),
      relationTypes: listRelationTypes(db, wid).map(({ count: _c, ...t }) => t),
      eras: listEras(db, wid),
      entities: all<{ id: number }>(db, "SELECT id, name, type_id AS typeId, summary, description FROM entity WHERE world_id = ? ORDER BY id", wid).map((e) => ({
        ...e,
        values: Object.fromEntries(all<{ defId: number; value: string }>(db, "SELECT def_id AS defId, value FROM property_value WHERE entity_id = ?", e.id).map((v) => [v.defId, JSON.parse(v.value)])),
        tagIds: all<{ t: number }>(db, "SELECT tag_id AS t FROM entity_tag WHERE entity_id = ?", e.id).map((r) => r.t),
        timeSpan: (() => { const r = get<{ data: string }>(db, "SELECT data FROM time_span WHERE entity_id = ?", e.id); return r ? JSON.parse(r.data) : null; })(),
      })),
      relations: all(db, "SELECT type_id AS typeId, source_id AS sourceId, target_id AS targetId, note FROM relation WHERE world_id = ? ORDER BY id", wid),
      documents: all<{ id: number }>(db, "SELECT id, title FROM document WHERE world_id = ? ORDER BY position, id", wid).map((d) => ({
        ...d, sections: all(db, "SELECT id, parent_id AS parentId, title, content, position FROM section WHERE document_id = ? ORDER BY id", d.id),
      })),
    };
    if (includeImages) {
      archive.media = all<{ data: Uint8Array }>(db, "SELECT id, name, mime, sha256, data FROM media WHERE world_id = ? ORDER BY id", wid)
        .map((m) => ({ ...m, data: Buffer.from(m.data).toString("base64") }));
      archive.entityImages = all(db, "SELECT em.entity_id AS entityId, em.media_id AS mediaId, em.position, em.caption FROM entity_media em JOIN entity e ON e.id = em.entity_id WHERE e.world_id = ?", wid);
      archive.maps = all(db, "SELECT id, name, media_id AS mediaId, entity_id AS entityId FROM map WHERE world_id = ? ORDER BY id", wid);
      archive.pins = all(db, "SELECT p.map_id AS mapId, p.entity_id AS entityId, p.x, p.y FROM map_pin p JOIN map m ON m.id = p.map_id WHERE m.world_id = ?", wid);
    }
    return archive;
  } finally {
    db.exec("COMMIT");
  }
}

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown, label: string): A[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => !x || typeof x !== "object")) throw bad(`Archive invalide : « ${label} » doit être une liste.`);
  return v as A[];
};
const text = (v: unknown, label: string, max = 200, allowEmpty = false): string => {
  if (typeof v !== "string" || (!allowEmpty && !v.trim()) || v.length > max) throw bad(`Archive invalide : ${label}.`);
  return v;
};

/**
 * Import : TOUJOURS dans un nouveau monde, tout ou rien. L'archive entière est
 * validée, puis tout est inséré avec de nouveaux identifiants dans une seule
 * transaction ; les références (y compris les liens dans les textes) sont
 * converties. Le monde d'origine n'est jamais modifié.
 */
export function importWorld(db: DB, a: A) {
  if (!a || a.format !== ARCHIVE_FORMAT) throw bad("Ce fichier n'est pas une sauvegarde de monde World Building.");
  if (a.version !== ARCHIVE_VERSION) throw bad(`Version d'archive non prise en charge (${a.version}).`);
  const worldName = text(a.world?.name, "nom du monde", 120);
  const types = arr(a.types, "types"), tags = arr(a.tags, "étiquettes"), rtypes = arr(a.relationTypes, "types de relation");
  const eras = arr(a.eras, "ères"), entities = arr(a.entities, "fiches"), relations = arr(a.relations, "relations");
  const documents = arr(a.documents, "documents"), media = arr(a.media, "images"), entityImages = arr(a.entityImages, "images des fiches");
  const maps = arr(a.maps, "cartes"), pins = arr(a.pins, "épingles");

  // Pré-validation des images (décodage, format réel, empreinte) avant toute écriture.
  const decoded = new Map<number, { name: string; mime: string; sha256: string; data: Buffer; width: number; height: number }>();
  let totalBytes = 0;
  for (const m of media) {
    const data = Buffer.from(text(m.data, "contenu d'image", 40_000_000), "base64");
    const info = sniffImage(data);
    if (!info || data.length > MAX_IMAGE_BYTES) throw bad(`Archive invalide : image « ${m.name} » illisible ou trop lourde.`);
    const sha = createHash("sha256").update(data).digest("hex");
    if (m.sha256 && m.sha256 !== sha) throw bad(`Archive invalide : l'image « ${m.name} » est corrompue (empreinte).`);
    totalBytes += data.length;
    decoded.set(m.id, { name: String(m.name ?? "image"), mime: info.mime, sha256: sha, data, width: info.width, height: info.height });
  }
  if (totalBytes > 400 * 1024 * 1024) throw bad("Archive trop volumineuse (400 Mo d'images au plus).");

  return tx(db, () => {
    const name = uniqueWorldName(db, `${worldName} (import)`);
    const wid = insert(db, "INSERT INTO world (name, description) VALUES (?, ?)", name, typeof a.world.description === "string" ? a.world.description : "");
    const ref = (map: Map<number, number>, id: unknown, label: string) => {
      const v = map.get(Number(id));
      if (v === undefined) throw bad(`Archive invalide : ${label} inconnu(e) (${id}).`);
      return v;
    };
    const typeMap = new Map<number, number>(), defMap = new Map<number, { id: number; kind: string }>(), tagMap = new Map<number, number>();
    const rtMap = new Map<number, number>(), eraMap = new Map<number, number>(), entMap = new Map<number, number>(), mediaMap = new Map<number, number>(), mapMap = new Map<number, number>();
    for (const t of types) {
      const id = insert(db, "INSERT INTO entity_type (world_id, name, color) VALUES (?, ?, ?)", wid, text(t.name, "nom de type", 80), /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#64748b");
      typeMap.set(t.id, id);
      for (const p of arr(t.properties, "propriétés")) {
        if (!PROPERTY_KINDS.includes(p.kind)) throw bad(`Archive invalide : genre de propriété « ${p.kind} ».`);
        defMap.set(p.id, { id: insert(db, "INSERT INTO property_def (world_id, type_id, name, kind, position, archived) VALUES (?, ?, ?, ?, ?, ?)", wid, id, text(p.name, "nom de propriété", 80), p.kind, Number(p.position) || 0, p.archived ? 1 : 0), kind: p.kind });
      }
    }
    for (const t of tags) tagMap.set(t.id, insert(db, "INSERT INTO tag (world_id, name, color) VALUES (?, ?, ?)", wid, text(t.name, "étiquette", 60), /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#64748b"));
    for (const t of rtypes) rtMap.set(t.id, insert(db, "INSERT INTO relation_type (world_id, name, inverse_name, transitive, symmetric) VALUES (?, ?, ?, ?, ?)", wid, text(t.name, "type de relation", 80), text(t.inverseName, "nom inverse", 80), t.transitive ? 1 : 0, t.symmetric ? 1 : 0));
    eras.forEach((e, i) => eraMap.set(e.id, insert(db, "INSERT INTO era (world_id, name, position, duration, gap_before, color) VALUES (?, ?, ?, ?, ?, ?)", wid, text(e.name, "ère", 80), i,
      e.duration === null ? null : Number(e.duration), Number(e.gapBefore) || 0, /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#6366f1")));
    if (!eras.length) insert(db, "INSERT INTO era (world_id, name, position) VALUES (?, 'Première ère', 0)", wid);
    for (const e of entities) entMap.set(e.id, insert(db, "INSERT INTO entity (world_id, type_id, name, summary) VALUES (?, ?, ?, ?)", wid,
      e.typeId === null || e.typeId === undefined ? null : ref(typeMap, e.typeId, "type"), text(e.name, "nom de fiche"), typeof e.summary === "string" ? e.summary.slice(0, 500) : ""));
    const remapPoint = (p: DatePoint): DatePoint => {
      const err = validatePoint(p);
      if (err) throw bad(`Archive invalide : ${err}`);
      return { ...p, eraId: ref(eraMap, p.eraId, "ère") };
    };
    for (const e of entities) {
      const id = entMap.get(e.id)!;
      run(db, "UPDATE entity SET description = ? WHERE id = ?", remapLinks(typeof e.description === "string" ? e.description : "", entMap), id);
      for (const [k, v] of Object.entries((e.values ?? {}) as A)) {
        const def = defMap.get(Number(k));
        if (!def) throw bad("Archive invalide : propriété inconnue.");
        const value = def.kind === "entity" ? (entMap.get(Number(v)) ?? 0) : def.kind === "date" ? remapPoint(v) : v;
        run(db, "INSERT INTO property_value (entity_id, def_id, value) VALUES (?, ?, ?)", id, def.id, JSON.stringify(value));
      }
      for (const t of arr(e.tagIds?.map((x: number) => ({ x })), "étiquettes")) run(db, "INSERT OR IGNORE INTO entity_tag (entity_id, tag_id) VALUES (?, ?)", id, ref(tagMap, t.x, "étiquette"));
      if (e.timeSpan) {
        const s = e.timeSpan as TimeSpan;
        run(db, "INSERT INTO time_span (entity_id, data) VALUES (?, ?)", id, JSON.stringify({ start: remapPoint(s.start), end: s.end ? remapPoint(s.end) : null }));
      }
    }
    for (const r of relations) {
      const s = ref(entMap, r.sourceId, "fiche"), t = ref(entMap, r.targetId, "fiche");
      if (s === t) throw bad("Archive invalide : relation d'une fiche vers elle-même.");
      run(db, "INSERT OR IGNORE INTO relation (world_id, type_id, source_id, target_id, note) VALUES (?, ?, ?, ?, ?)", wid, ref(rtMap, r.typeId, "type de relation"), s, t, typeof r.note === "string" ? r.note : "");
    }
    for (const [oldId, m] of decoded) mediaMap.set(oldId, insert(db, "INSERT INTO media (world_id, name, mime, size, width, height, sha256, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", wid, m.name, m.mime, m.data.length, m.width, m.height, m.sha256, m.data));
    for (const ei of entityImages) run(db, "INSERT INTO entity_media (entity_id, media_id, position, caption) VALUES (?, ?, ?, ?)", ref(entMap, ei.entityId, "fiche"), ref(mediaMap, ei.mediaId, "image"), Number(ei.position) || 0, String(ei.caption ?? ""));
    const mapEntities = new Set<number>();
    for (const m of maps) {
      const eid = m.entityId === null || m.entityId === undefined ? null : ref(entMap, m.entityId, "fiche");
      if (eid !== null) { if (mapEntities.has(eid)) throw bad("Archive invalide : deux cartes pour une même fiche."); mapEntities.add(eid); }
      mapMap.set(m.id, insert(db, "INSERT INTO map (world_id, name, media_id, entity_id) VALUES (?, ?, ?, ?)", wid, text(m.name, "nom de carte", 120), ref(mediaMap, m.mediaId, "image"), eid));
    }
    for (const p of pins) {
      if (typeof p.x !== "number" || typeof p.y !== "number" || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) throw bad("Archive invalide : épingle hors de la carte.");
      run(db, "INSERT INTO map_pin (map_id, entity_id, x, y) VALUES (?, ?, ?, ?)", ref(mapMap, p.mapId, "carte"), ref(entMap, p.entityId, "fiche"), p.x, p.y);
    }
    documents.forEach((d, i) => {
      const did = insert(db, "INSERT INTO document (world_id, title, position) VALUES (?, ?, ?)", wid, text(d.title, "titre de document"), i);
      const secs = arr(d.sections, "sections");
      const secMap = new Map<number, number>();
      // Les parents sont créés avant les enfants ; un parent absent ou une boucle est refusé.
      let pending = [...secs];
      while (pending.length) {
        const ready = pending.filter((s) => s.parentId === null || s.parentId === undefined || secMap.has(s.parentId));
        if (!ready.length) throw bad("Archive invalide : sections imbriquées incohérentes.");
        for (const s of ready) secMap.set(s.id, insert(db, "INSERT INTO section (document_id, parent_id, title, content, position) VALUES (?, ?, ?, ?, ?)", did,
          s.parentId === null || s.parentId === undefined ? null : secMap.get(s.parentId)!, text(s.title, "titre de section"), remapLinks(typeof s.content === "string" ? s.content : "", entMap), Number(s.position) || 0));
        pending = pending.filter((s) => !ready.includes(s));
      }
    });
    if (all(db, "PRAGMA foreign_key_check").length) throw new Error("Intégrité rompue pendant l'import.");
    return {
      id: wid, name,
      counts: { entities: entities.length, relations: relations.length, documents: documents.length, images: decoded.size, maps: maps.length },
      brokenLinks: entities.reduce((n, e) => n + [...String(e.description ?? "").matchAll(LINK_RE)].filter((m) => !entMap.has(Number(m[1]))).length, 0),
    };
  });
}
