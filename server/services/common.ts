import { get, type DB } from "../db.ts";
import { notFound } from "../errors.ts";

const WORLD_TABLES = new Set(["entity", "entity_type", "property_def", "tag", "relation_type", "relation", "era", "media", "map", "document"]);

/**
 * Vérifie qu'une ligne appartient bien au monde de la requête. C'est la garde
 * centrale de l'isolation : un identifiant venu du navigateur n'est jamais
 * utilisé sans ce contrôle.
 */
export function owned(db: DB, table: string, id: unknown, wid: number, label = "Élément"): number {
  if (!WORLD_TABLES.has(table)) throw new Error(`Table non isolée : ${table}`);
  const n = Number(id);
  if (!Number.isSafeInteger(n) || !get(db, `SELECT 1 FROM ${table} WHERE id = ? AND world_id = ?`, n, wid)) {
    throw notFound(`${label} introuvable dans ce monde.`);
  }
  return n;
}

export function requireWorld(db: DB, wid: unknown): number {
  const n = Number(wid);
  if (!Number.isSafeInteger(n) || !get(db, "SELECT 1 FROM world WHERE id = ?", n)) throw notFound("Monde introuvable.");
  return n;
}

export function sectionOwned(db: DB, sid: unknown, wid: number): number {
  const n = Number(sid);
  const ok = Number.isSafeInteger(n) && get(db, "SELECT 1 FROM section s JOIN document d ON d.id = s.document_id WHERE s.id = ? AND d.world_id = ?", n, wid);
  if (!ok) throw notFound("Section introuvable dans ce monde.");
  return n;
}

export const bool = (v: unknown) => v === 1 || v === true || v === 1n;
