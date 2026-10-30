import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad, conflict, notFound, str, color, int } from "../errors.ts";
import { owned, bool } from "./common.ts";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function listWorlds(db: DB) {
  return all(db, `SELECT w.id, w.name, w.description, w.created_at AS createdAt,
      (SELECT COUNT(*) FROM entity e WHERE e.world_id = w.id) AS entities,
      (SELECT COUNT(*) FROM document d WHERE d.world_id = w.id) AS documents
    FROM world w ORDER BY w.name COLLATE NOCASE`);
}

export function uniqueWorldName(db: DB, base: string): string {
  let name = base;
  for (let i = 2; get(db, "SELECT 1 FROM world WHERE name = ?", name); i++) name = `${base} ${i}`;
  return name;
}

/** Types et relations proposés par défaut : un point de départ modifiable. */
export function seedDefaults(db: DB, wid: number) {
  const types: [string, string, [string, string][]][] = [
    ["Personnage", "#e11d48", [["Titre", "text"], ["Naissance", "date"], ["Espèce", "text"]]],
    ["Lieu", "#059669", [["Population", "number"], ["Climat", "text"]]],
    ["Organisation", "#7c3aed", [["Devise", "text"], ["Dirigeant", "entity"]]],
    ["Objet", "#d97706", [["Matériau", "text"], ["Magique", "boolean"]]],
    ["Événement", "#2563eb", [["Issue", "longtext"]]],
    ["Concept", "#0891b2", []],
  ];
  for (const [name, c, props] of types) {
    const tid = insert(db, "INSERT INTO entity_type (world_id, name, color) VALUES (?, ?, ?)", wid, name, c);
    props.forEach(([pn, kind], i) => insert(db, "INSERT INTO property_def (world_id, type_id, name, kind, position) VALUES (?, ?, ?, ?, ?)", wid, tid, pn, kind, i));
  }
  const rels: [string, string, number, number][] = [
    ["situé dans", "contient", 1, 0],
    ["membre de", "a pour membre", 0, 0],
    ["parent de", "enfant de", 0, 0],
    ["possède", "appartient à", 0, 0],
    ["allié de", "allié de", 0, 1],
    ["ennemi de", "ennemi de", 0, 1],
  ];
  for (const [n, inv, t, s] of rels) insert(db, "INSERT INTO relation_type (world_id, name, inverse_name, transitive, symmetric) VALUES (?, ?, ?, ?, ?)", wid, n, inv, t, s);
  insert(db, "INSERT INTO era (world_id, name, position, duration, gap_before, color) VALUES (?, 'Première ère', 0, NULL, 0, '#6366f1')", wid);
}

export function createWorld(db: DB, body: Record<string, unknown>) {
  const name = str(body.name, "nom", { max: 120 });
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : "";
  return tx(db, () => {
    if (get(db, "SELECT 1 FROM world WHERE name = ?", name)) throw conflict("Un monde porte déjà ce nom.");
    const wid = insert(db, "INSERT INTO world (name, description) VALUES (?, ?)", name, description);
    if (body.empty !== true) seedDefaults(db, wid);
    return { id: wid };
  });
}

export function worldOverview(db: DB, wid: number) {
  const world = get(db, "SELECT id, name, description, created_at AS createdAt FROM world WHERE id = ?", wid);
  if (!world) throw notFound("Monde introuvable.");
  const count = (sql: string) => Number((get(db, sql, wid) as { n: number }).n);
  return {
    world,
    stats: {
      entities: count("SELECT COUNT(*) AS n FROM entity WHERE world_id = ?"),
      relations: count("SELECT COUNT(*) AS n FROM relation WHERE world_id = ?"),
      documents: count("SELECT COUNT(*) AS n FROM document WHERE world_id = ?"),
      maps: count("SELECT COUNT(*) AS n FROM map WHERE world_id = ?"),
      media: count("SELECT COUNT(*) AS n FROM media WHERE world_id = ?"),
      published: count("SELECT COUNT(*) AS n FROM publication WHERE world_id = ?"),
    },
    byType: all(db, `SELECT t.id, t.name, t.color, COUNT(e.id) AS n FROM entity_type t
      LEFT JOIN entity e ON e.type_id = t.id WHERE t.world_id = ? GROUP BY t.id ORDER BY n DESC, t.name`, wid),
    recent: all(db, `SELECT e.id, e.name, e.updated_at AS updatedAt, t.name AS typeName, t.color AS typeColor
      FROM entity e LEFT JOIN entity_type t ON t.id = e.type_id WHERE e.world_id = ? ORDER BY e.updated_at DESC, e.id DESC LIMIT 8`, wid),
  };
}

export function updateWorld(db: DB, wid: number, body: Record<string, unknown>) {
  return tx(db, () => {
    const cur = get<{ name: string }>(db, "SELECT name FROM world WHERE id = ?", wid)!;
    if (body.name !== undefined) {
      if (body.expectedName !== undefined && body.expectedName !== cur.name) throw conflict("Le monde a été renommé entre-temps.");
      const name = str(body.name, "nom", { max: 120 });
      if (get(db, "SELECT 1 FROM world WHERE name = ? AND id <> ?", name, wid)) throw conflict("Un monde porte déjà ce nom.");
      run(db, "UPDATE world SET name = ? WHERE id = ?", name, wid);
    }
    if (typeof body.description === "string") run(db, "UPDATE world SET description = ? WHERE id = ?", body.description.slice(0, 2000), wid);
    return worldOverview(db, wid).world;
  });
}

/**
 * Suppression d'un monde : il faut retaper son nom exact. Une copie complète de
 * la base est faite avant (`data/backups/`), puis tout le monde est retiré en
 * cascade dans une transaction, avec contrôle des clés étrangères.
 */
export function deleteWorld(db: DB, wid: number, confirmName: unknown, dataDir: string | null) {
  const w = get<{ name: string }>(db, "SELECT name FROM world WHERE id = ?", wid)!;
  if (confirmName !== w.name) throw bad("Le nom saisi ne correspond pas au nom du monde.");
  let backup: string | null = null;
  if (dataDir) {
    const dir = join(dataDir, "backups");
    mkdirSync(dir, { recursive: true });
    backup = join(dir, `before-delete-world-${wid}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }
  tx(db, () => {
    run(db, "DELETE FROM world WHERE id = ?", wid);
    const fk = all(db, "PRAGMA foreign_key_check");
    if (fk.length) throw new Error("Intégrité rompue pendant la suppression ; rien n'a été supprimé.");
  });
  return { deleted: true, backup };
}

// ---- Types de fiches et propriétés -------------------------------------------------

export const PROPERTY_KINDS = ["text", "longtext", "number", "boolean", "date", "entity"] as const;

export function listTypes(db: DB, wid: number) {
  const types = all<{ id: number; name: string; color: string; count: number }>(db, `SELECT t.id, t.name, t.color,
      (SELECT COUNT(*) FROM entity e WHERE e.type_id = t.id) AS count
    FROM entity_type t WHERE t.world_id = ? ORDER BY t.name COLLATE NOCASE`, wid);
  const defs = all<{ id: number; typeId: number; name: string; kind: string; position: number; archived: number }>(db,
    "SELECT id, type_id AS typeId, name, kind, position, archived FROM property_def WHERE world_id = ? ORDER BY position, id", wid);
  return types.map((t) => ({ ...t, properties: defs.filter((d) => d.typeId === t.id).map((d) => ({ ...d, archived: bool(d.archived) })) }));
}

export function createType(db: DB, wid: number, body: Record<string, unknown>) {
  const name = str(body.name, "nom", { max: 80 });
  if (get(db, "SELECT 1 FROM entity_type WHERE world_id = ? AND name = ?", wid, name)) throw conflict("Ce type existe déjà.");
  return { id: insert(db, "INSERT INTO entity_type (world_id, name, color) VALUES (?, ?, ?)", wid, name, color(body.color)) };
}

export function updateType(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "entity_type", id, wid, "Type");
  if (body.name !== undefined) {
    const name = str(body.name, "nom", { max: 80 });
    if (get(db, "SELECT 1 FROM entity_type WHERE world_id = ? AND name = ? AND id <> ?", wid, name, id)) throw conflict("Ce type existe déjà.");
    run(db, "UPDATE entity_type SET name = ? WHERE id = ?", name, id);
  }
  if (body.color !== undefined) run(db, "UPDATE entity_type SET color = ? WHERE id = ?", color(body.color), id);
  return { ok: true };
}

export function deleteType(db: DB, wid: number, id: number) {
  owned(db, "entity_type", id, wid, "Type");
  const n = Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM entity WHERE type_id = ?", id)!.n);
  // Supprimer un type utilisé effacerait les valeurs de propriétés de ses fiches.
  if (n > 0) throw conflict(`Ce type est utilisé par ${n} fiche(s). Changez d'abord leur type.`);
  run(db, "DELETE FROM entity_type WHERE id = ?", id);
  return { deleted: true };
}

export function createProperty(db: DB, wid: number, typeId: number, body: Record<string, unknown>) {
  owned(db, "entity_type", typeId, wid, "Type");
  const name = str(body.name, "nom", { max: 80 });
  if (!PROPERTY_KINDS.includes(body.kind as never)) throw bad("Genre de propriété inconnu.");
  const pos = Number(get<{ p: number }>(db, "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM property_def WHERE type_id = ?", typeId)!.p);
  return { id: insert(db, "INSERT INTO property_def (world_id, type_id, name, kind, position) VALUES (?, ?, ?, ?, ?)", wid, typeId, name, body.kind, pos) };
}

/** Une propriété n'est jamais supprimée : elle est archivée, ses valeurs restent. */
export function updateProperty(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "property_def", id, wid, "Propriété");
  if (body.name !== undefined) run(db, "UPDATE property_def SET name = ? WHERE id = ?", str(body.name, "nom", { max: 80 }), id);
  if (body.archived !== undefined) run(db, "UPDATE property_def SET archived = ? WHERE id = ?", body.archived ? 1 : 0, id);
  if (body.position !== undefined) run(db, "UPDATE property_def SET position = ? WHERE id = ?", int(body.position, "position"), id);
  return { ok: true };
}

// ---- Étiquettes ---------------------------------------------------------------------

export function listTags(db: DB, wid: number) {
  return all(db, `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM entity_tag et WHERE et.tag_id = t.id) AS count
    FROM tag t WHERE t.world_id = ? ORDER BY t.name COLLATE NOCASE`, wid);
}

export function createTag(db: DB, wid: number, body: Record<string, unknown>) {
  const name = str(body.name, "nom", { max: 60 });
  const existing = get<{ id: number }>(db, "SELECT id FROM tag WHERE world_id = ? AND name = ?", wid, name);
  if (existing) return { id: existing.id };
  return { id: insert(db, "INSERT INTO tag (world_id, name, color) VALUES (?, ?, ?)", wid, name, color(body.color)) };
}

export function deleteTag(db: DB, wid: number, id: number) {
  owned(db, "tag", id, wid, "Étiquette");
  run(db, "DELETE FROM tag WHERE id = ?", id);
  return { deleted: true };
}
