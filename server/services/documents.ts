import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad, conflict, int, notFound, str } from "../errors.ts";
import { owned, sectionOwned } from "./common.ts";
import { linkedIds } from "../../shared/richtext.ts";

type Sec = { id: number; documentId: number; parentId: number | null; title: string; position: number };

export function listDocuments(db: DB, wid: number) {
  const docs = all<{ id: number }>(db, "SELECT id, title, position, created_at AS createdAt FROM document WHERE world_id = ? ORDER BY position, id", wid);
  const secs = all<Sec & { words: number }>(db, `SELECT s.id, s.document_id AS documentId, s.parent_id AS parentId, s.title, s.position,
      LENGTH(TRIM(s.content)) - LENGTH(REPLACE(TRIM(s.content), ' ', '')) + (LENGTH(TRIM(s.content)) > 0) AS words
    FROM section s JOIN document d ON d.id = s.document_id WHERE d.world_id = ? ORDER BY s.position, s.id`, wid);
  return docs.map((d) => ({ ...d, sections: secs.filter((s) => s.documentId === d.id) }));
}

export function createDocument(db: DB, wid: number, body: Record<string, unknown>) {
  const title = str(body.title, "titre", { max: 200 });
  return tx(db, () => {
    const pos = Number(get<{ p: number }>(db, "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM document WHERE world_id = ?", wid)!.p);
    const id = insert(db, "INSERT INTO document (world_id, title, position) VALUES (?, ?, ?)", wid, title, pos);
    const sectionId = insert(db, "INSERT INTO section (document_id, title, position) VALUES (?, 'Chapitre 1', 0)", id);
    return { id, sectionId };
  });
}

export function updateDocument(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "document", id, wid, "Document");
  run(db, "UPDATE document SET title = ? WHERE id = ?", str(body.title, "titre", { max: 200 }), id);
  return { ok: true };
}

export function deleteDocument(db: DB, wid: number, id: number) {
  owned(db, "document", id, wid, "Document");
  run(db, "DELETE FROM document WHERE id = ?", id);
  return { deleted: true };
}

/** Lecture continue d'un document : toutes les sections dans l'ordre de l'arbre. */
export function getDocument(db: DB, wid: number, id: number) {
  const doc = get(db, "SELECT id, title FROM document WHERE id = ? AND world_id = ?", id, wid);
  if (!doc) throw notFound("Document introuvable dans ce monde.");
  const secs = all<Sec & { content: string; revision: number }>(db, "SELECT id, document_id AS documentId, parent_id AS parentId, title, position, content, revision FROM section WHERE document_id = ? ORDER BY position, id", id);
  const ordered: (Sec & { content: string; depth: number })[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const s of secs.filter((x) => x.parentId === parent)) { ordered.push({ ...s, depth }); walk(s.id, depth + 1); }
  };
  walk(null, 0);
  return { ...doc, sections: ordered, names: namesFor(db, wid, ordered.map((s) => s.content).join("\n")) };
}

/** Noms actuels des fiches citées : l'affichage suit les renommages. */
export function namesFor(db: DB, wid: number, text: string) {
  const out: Record<number, string> = {};
  for (const id of linkedIds(text)) {
    const r = get<{ name: string }>(db, "SELECT name FROM entity WHERE id = ? AND world_id = ?", id, wid);
    if (r) out[id] = r.name;
  }
  return out;
}

export function createSection(db: DB, wid: number, docId: number, body: Record<string, unknown>) {
  owned(db, "document", docId, wid, "Document");
  const title = str(body.title, "titre", { max: 200 });
  const parentId = body.parentId === null || body.parentId === undefined ? null : sectionOwned(db, body.parentId, wid);
  if (parentId && get<{ d: number }>(db, "SELECT document_id AS d FROM section WHERE id = ?", parentId)!.d !== docId) throw bad("La section parente appartient à un autre document.");
  return tx(db, () => {
    const pos = Number(get<{ p: number }>(db, `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM section WHERE document_id = ? AND parent_id IS ?`, docId, parentId)!.p);
    return { id: insert(db, "INSERT INTO section (document_id, parent_id, title, position) VALUES (?, ?, ?, ?)", docId, parentId, title, pos) };
  });
}

export function getSection(db: DB, wid: number, sid: number) {
  sectionOwned(db, sid, wid);
  const s = get<{ content: string }>(db, "SELECT id, document_id AS documentId, parent_id AS parentId, title, content, revision, updated_at AS updatedAt FROM section WHERE id = ?", sid)!;
  return { ...s, names: namesFor(db, wid, s.content) };
}

/**
 * Autosauvegarde : `expectedRevision` protège contre l'écrasement d'une version
 * plus récente (autre onglet). En cas de conflit, 409 avec la version enregistrée ;
 * le navigateur garde la saisie locale pour que rien ne soit perdu.
 */
export function updateSection(db: DB, wid: number, sid: number, body: Record<string, unknown>) {
  sectionOwned(db, sid, wid);
  const expected = int(body.expectedRevision, "expectedRevision");
  return tx(db, () => {
    const cur = get<{ revision: number }>(db, "SELECT revision FROM section WHERE id = ?", sid)!;
    if (cur.revision !== expected) throw conflict("Cette section a été modifiée ailleurs.", { revision: cur.revision });
    if (body.title !== undefined) run(db, "UPDATE section SET title = ? WHERE id = ?", str(body.title, "titre", { max: 200 }), sid);
    if (body.content !== undefined) {
      if (typeof body.content !== "string" || body.content.length > 2_000_000) throw bad("Contenu invalide.");
      run(db, "UPDATE section SET content = ? WHERE id = ?", body.content, sid);
    }
    run(db, "UPDATE section SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?", sid);
    return getSection(db, wid, sid);
  });
}

export function deleteSection(db: DB, wid: number, sid: number) {
  sectionOwned(db, sid, wid);
  run(db, "DELETE FROM section WHERE id = ?", sid);
  return { deleted: true };
}

/** Déplacements dans l'arbre : monter, descendre, indenter (devient enfant de la précédente), désindenter. */
export function moveSection(db: DB, wid: number, sid: number, body: Record<string, unknown>) {
  sectionOwned(db, sid, wid);
  return tx(db, () => {
    const s = get<Sec>(db, "SELECT id, document_id AS documentId, parent_id AS parentId, title, position FROM section WHERE id = ?", sid)!;
    const siblings = (parent: number | null) => all<Sec>(db, "SELECT id, parent_id AS parentId, position FROM section WHERE document_id = ? AND parent_id IS ? ORDER BY position, id", s.documentId, parent);
    const renumber = (list: { id: number }[]) => list.forEach((x, i) => run(db, "UPDATE section SET position = ? WHERE id = ?", i, x.id));
    const sibs = siblings(s.parentId);
    const i = sibs.findIndex((x) => x.id === sid);
    switch (body.direction) {
      case "up": case "down": {
        const j = body.direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= sibs.length) return { ok: true };
        [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
        renumber(sibs);
        break;
      }
      case "indent": {
        if (i <= 0) throw bad("Aucune section précédente sous laquelle ranger celle-ci.");
        const newParent = sibs[i - 1].id;
        const kids = siblings(newParent);
        run(db, "UPDATE section SET parent_id = ?, position = ? WHERE id = ?", newParent, kids.length, sid);
        renumber(siblings(s.parentId));
        break;
      }
      case "outdent": {
        if (!s.parentId) throw bad("Cette section est déjà au premier niveau.");
        const parent = get<Sec>(db, "SELECT id, parent_id AS parentId FROM section WHERE id = ?", s.parentId)!;
        const upper = siblings(parent.parentId).filter((x) => x.id !== sid);
        const at = upper.findIndex((x) => x.id === parent.id) + 1;
        run(db, "UPDATE section SET parent_id = ? WHERE id = ?", parent.parentId, sid);
        upper.splice(at, 0, s);
        renumber(upper);
        renumber(siblings(s.parentId));
        break;
      }
      default: throw bad("Déplacement inconnu.");
    }
    return { ok: true };
  });
}
