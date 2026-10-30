import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type DB = DatabaseSync;

/**
 * Migrations additives, appliquées dans l'ordre et jamais réécrites une fois
 * publiées. `PRAGMA user_version` mémorise la dernière appliquée. Pour faire
 * évoluer le schéma, AJOUTER une entrée à la fin de ce tableau.
 *
 * Isolation des mondes : toute table métier porte `world_id` (directement ou via
 * sa fiche/son document parent). Les suppressions en cascade ne servent qu'à la
 * suppression d'un monde ou d'une fiche ; les refus métier (type utilisé, image
 * utilisée…) sont vérifiés par les services avant toute écriture.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE world (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE entity_type (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT '#64748b',
    UNIQUE (world_id, name)
  );
  CREATE TABLE property_def (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    type_id INTEGER NOT NULL REFERENCES entity_type(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text','longtext','number','boolean','date','entity')),
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE entity (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    type_id INTEGER REFERENCES entity_type(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX entity_world_name ON entity (world_id, name COLLATE NOCASE, id);
  CREATE TABLE property_value (
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    def_id INTEGER NOT NULL REFERENCES property_def(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    PRIMARY KEY (entity_id, def_id)
  );
  CREATE TABLE tag (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT '#64748b',
    UNIQUE (world_id, name)
  );
  CREATE TABLE entity_tag (
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_id, tag_id)
  );
  CREATE TABLE relation_type (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    inverse_name TEXT NOT NULL,
    transitive INTEGER NOT NULL DEFAULT 0,
    symmetric INTEGER NOT NULL DEFAULT 0,
    UNIQUE (world_id, name)
  );
  CREATE TABLE relation (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    type_id INTEGER NOT NULL REFERENCES relation_type(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE (type_id, source_id, target_id),
    CHECK (source_id <> target_id)
  );
  CREATE INDEX relation_source ON relation (source_id);
  CREATE INDEX relation_target ON relation (target_id);
  CREATE TABLE era (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    duration INTEGER,
    gap_before INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#6366f1'
  );
  CREATE TABLE time_span (
    entity_id INTEGER PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );
  CREATE TABLE media (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE entity_media (
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (entity_id, media_id)
  );
  CREATE TABLE map (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    entity_id INTEGER UNIQUE REFERENCES entity(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE map_pin (
    id INTEGER PRIMARY KEY,
    map_id INTEGER NOT NULL REFERENCES map(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
    y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
    UNIQUE (map_id, entity_id)
  );
  CREATE TABLE document (
    id INTEGER PRIMARY KEY,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE section (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES section(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE publication (
    entity_id INTEGER PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    world_id INTEGER NOT NULL REFERENCES world(id) ON DELETE CASCADE,
    snapshot TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: DB, path: string | null) {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) throw new Error(`Base créée par une version plus récente (schéma ${current}).`);
  if (current === MIGRATIONS.length) return;
  // Copie de sécurité avant de faire évoluer une base existante.
  if (current > 0 && path) {
    const dir = join(dirname(path), "backups");
    mkdirSync(dir, { recursive: true });
    db.exec(`VACUUM INTO '${join(dir, `before-migration-v${current + 1}-${Date.now()}.db`).replace(/'/g, "''")}'`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Ouvre (ou crée) une base. `:memory:` pour les tests. */
export function openDb(path = ":memory:"): DB {
  const file = path === ":memory:" ? null : path;
  if (file && !existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (file) db.exec("PRAGMA journal_mode = WAL;");
  migrate(db, file);
  return db;
}

/** Exécute `fn` dans une transaction exclusive : tout ou rien. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

type Row = Record<string, unknown>;
export const all = <T = Row>(db: DB, sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
export const get = <T = Row>(db: DB, sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;
export const run = (db: DB, sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));
export const insert = (db: DB, sql: string, ...p: unknown[]) => Number(run(db, sql, ...p).lastInsertRowid);
