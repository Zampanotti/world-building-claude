import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad, conflict, notFound, str } from "../errors.ts";
import { owned } from "./common.ts";

export function listMaps(db: DB, wid: number) {
  return all(db, `SELECT m.id, m.name, m.media_id AS mediaId, me.width, me.height, m.entity_id AS entityId, e.name AS entityName,
      (SELECT COUNT(*) FROM map_pin p WHERE p.map_id = m.id) AS pins
    FROM map m JOIN media me ON me.id = m.media_id LEFT JOIN entity e ON e.id = m.entity_id
    WHERE m.world_id = ? ORDER BY m.name COLLATE NOCASE`, wid);
}

function entityForMap(db: DB, wid: number, v: unknown, mapId: number | null): number | null {
  if (v === null || v === undefined) return null;
  const eid = owned(db, "entity", v, wid, "Fiche");
  const other = get<{ id: number }>(db, "SELECT id FROM map WHERE entity_id = ?", eid);
  if (other && other.id !== mapId) throw conflict("Cette fiche a déjà sa carte.");
  return eid;
}

export function createMap(db: DB, wid: number, body: Record<string, unknown>) {
  const name = str(body.name, "nom", { max: 120 });
  const mediaId = owned(db, "media", body.mediaId, wid, "Image");
  return tx(db, () => ({ id: insert(db, "INSERT INTO map (world_id, name, media_id, entity_id) VALUES (?, ?, ?, ?)", wid, name, mediaId, entityForMap(db, wid, body.entityId, null)) }));
}

/** Carte avec ses épingles et son fil d'Ariane (cartes qui épinglent la fiche rattachée). */
export function getMap(db: DB, wid: number, id: number) {
  const m = get<{ id: number; entityId: number | null }>(db, `SELECT m.id, m.name, m.media_id AS mediaId, me.width, me.height, m.entity_id AS entityId, e.name AS entityName
    FROM map m JOIN media me ON me.id = m.media_id LEFT JOIN entity e ON e.id = m.entity_id WHERE m.id = ? AND m.world_id = ?`, id, wid);
  if (!m) throw notFound("Carte introuvable dans ce monde.");
  const pins = all(db, `SELECT p.id, p.x, p.y, e.id AS entityId, e.name, e.summary, t.name AS typeName, t.color AS typeColor,
      (SELECT em.media_id FROM entity_media em WHERE em.entity_id = e.id ORDER BY em.position LIMIT 1) AS imageId,
      (SELECT sub.id FROM map sub WHERE sub.entity_id = e.id) AS childMapId
    FROM map_pin p JOIN entity e ON e.id = p.entity_id LEFT JOIN entity_type t ON t.id = e.type_id WHERE p.map_id = ? ORDER BY e.name COLLATE NOCASE`, id);
  // Fil d'Ariane : on remonte de carte parente en carte parente, sans jamais boucler.
  const breadcrumb: { id: number; name: string }[] = [];
  const seen = new Set([id]);
  let entityId = m.entityId;
  while (entityId) {
    const parent = get<{ id: number; name: string; entityId: number | null }>(db,
      "SELECT m.id, m.name, m.entity_id AS entityId FROM map_pin p JOIN map m ON m.id = p.map_id WHERE p.entity_id = ? AND m.world_id = ? ORDER BY m.id LIMIT 1", entityId, wid);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    breadcrumb.unshift({ id: parent.id, name: parent.name });
    entityId = parent.entityId;
  }
  return { ...m, pins, breadcrumb };
}

export function updateMap(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "map", id, wid, "Carte");
  return tx(db, () => {
    if (body.name !== undefined) run(db, "UPDATE map SET name = ? WHERE id = ?", str(body.name, "nom", { max: 120 }), id);
    if (body.entityId !== undefined) run(db, "UPDATE map SET entity_id = ? WHERE id = ?", entityForMap(db, wid, body.entityId, id), id);
    return getMap(db, wid, id);
  });
}

/** Supprimer une carte garde son image dans la médiathèque. */
export function deleteMap(db: DB, wid: number, id: number) {
  owned(db, "map", id, wid, "Carte");
  run(db, "DELETE FROM map WHERE id = ?", id);
  return { deleted: true };
}

function coord(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw bad(`Position ${label} hors de la carte.`);
  return v;
}

export function addPin(db: DB, wid: number, mapId: number, body: Record<string, unknown>) {
  owned(db, "map", mapId, wid, "Carte");
  const eid = owned(db, "entity", body.entityId, wid, "Fiche");
  if (get(db, "SELECT 1 FROM map_pin WHERE map_id = ? AND entity_id = ?", mapId, eid)) throw conflict("Cette fiche est déjà épinglée sur la carte.");
  return { id: insert(db, "INSERT INTO map_pin (map_id, entity_id, x, y) VALUES (?, ?, ?, ?)", mapId, eid, coord(body.x, "x"), coord(body.y, "y")) };
}

function pinOwned(db: DB, wid: number, mapId: number, pinId: number) {
  owned(db, "map", mapId, wid, "Carte");
  if (!get(db, "SELECT 1 FROM map_pin WHERE id = ? AND map_id = ?", pinId, mapId)) throw notFound("Épingle introuvable.");
}

export function movePin(db: DB, wid: number, mapId: number, pinId: number, body: Record<string, unknown>) {
  pinOwned(db, wid, mapId, pinId);
  run(db, "UPDATE map_pin SET x = ?, y = ? WHERE id = ?", coord(body.x, "x"), coord(body.y, "y"), pinId);
  return { ok: true };
}

export function deletePin(db: DB, wid: number, mapId: number, pinId: number) {
  pinOwned(db, wid, mapId, pinId);
  run(db, "DELETE FROM map_pin WHERE id = ?", pinId);
  return { deleted: true };
}
