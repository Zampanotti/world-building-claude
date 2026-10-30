import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad, conflict, str } from "../errors.ts";
import { owned, bool } from "./common.ts";

type RType = { id: number; name: string; inverseName: string; transitive: boolean; symmetric: boolean };
type Rel = { id: number; typeId: number; sourceId: number; targetId: number; note: string };

export function listRelationTypes(db: DB, wid: number): (RType & { count: number })[] {
  return all<RType & { count: number }>(db, `SELECT rt.id, rt.name, rt.inverse_name AS inverseName, rt.transitive, rt.symmetric,
      (SELECT COUNT(*) FROM relation r WHERE r.type_id = rt.id) AS count
    FROM relation_type rt WHERE rt.world_id = ? ORDER BY rt.name COLLATE NOCASE`, wid)
    .map((t) => ({ ...t, transitive: bool(t.transitive), symmetric: bool(t.symmetric) }));
}

export function createRelationType(db: DB, wid: number, body: Record<string, unknown>) {
  const name = str(body.name, "nom", { max: 80 });
  const symmetric = body.symmetric === true;
  const inverseName = symmetric ? name : str(body.inverseName, "nom inverse", { max: 80 });
  if (get(db, "SELECT 1 FROM relation_type WHERE world_id = ? AND name = ?", wid, name)) throw conflict("Ce type de relation existe déjà.");
  return { id: insert(db, "INSERT INTO relation_type (world_id, name, inverse_name, transitive, symmetric) VALUES (?, ?, ?, ?, ?)", wid, name, inverseName, body.transitive === true ? 1 : 0, symmetric ? 1 : 0) };
}

/** Seuls les libellés sont modifiables : changer la transitivité réinterpréterait des faits existants. */
export function updateRelationType(db: DB, wid: number, id: number, body: Record<string, unknown>) {
  owned(db, "relation_type", id, wid, "Type de relation");
  const t = get<{ symmetric: number }>(db, "SELECT symmetric FROM relation_type WHERE id = ?", id)!;
  if (body.name !== undefined) {
    const name = str(body.name, "nom", { max: 80 });
    if (get(db, "SELECT 1 FROM relation_type WHERE world_id = ? AND name = ? AND id <> ?", wid, name, id)) throw conflict("Ce type de relation existe déjà.");
    run(db, "UPDATE relation_type SET name = ? WHERE id = ?", name, id);
    if (bool(t.symmetric)) run(db, "UPDATE relation_type SET inverse_name = ? WHERE id = ?", name, id);
  }
  if (body.inverseName !== undefined && !bool(t.symmetric)) run(db, "UPDATE relation_type SET inverse_name = ? WHERE id = ?", str(body.inverseName, "nom inverse", { max: 80 }), id);
  return { ok: true };
}

export function deleteRelationType(db: DB, wid: number, id: number) {
  owned(db, "relation_type", id, wid, "Type de relation");
  const n = Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM relation WHERE type_id = ?", id)!.n);
  if (n) throw conflict(`Ce type est utilisé par ${n} relation(s). Retirez-les d'abord.`);
  run(db, "DELETE FROM relation_type WHERE id = ?", id);
  return { deleted: true };
}

/** Chemin de `from` vers `to` en suivant les faits d'un type dans le sens direct (BFS). */
function findPath(db: DB, typeId: number, from: number, to: number): number[] | null {
  const edges = all<{ s: number; t: number }>(db, "SELECT source_id AS s, target_id AS t FROM relation WHERE type_id = ?", typeId);
  const next = new Map<number, number[]>();
  for (const e of edges) next.set(e.s, [...(next.get(e.s) ?? []), e.t]);
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) {
      const path = [n];
      let c = n;
      while (prev.get(c)! !== -1) { c = prev.get(c)!; path.unshift(c); }
      return path;
    }
    for (const m of next.get(n) ?? []) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
  }
  return null;
}

const nameOf = (db: DB, id: number) => get<{ name: string }>(db, "SELECT name FROM entity WHERE id = ?", id)?.name ?? "?";

/**
 * Création d'un fait. Refus : doublon (y compris dans l'autre sens pour un type
 * symétrique) et boucle sur un type transitif non symétrique (« A dans B dans A »),
 * avec la chaîne existante. Vérification et insertion dans la même transaction.
 */
export function createRelation(db: DB, wid: number, body: Record<string, unknown>) {
  const typeId = owned(db, "relation_type", body.typeId, wid, "Type de relation");
  const sourceId = owned(db, "entity", body.sourceId, wid, "Fiche source");
  const targetId = owned(db, "entity", body.targetId, wid, "Fiche cible");
  if (sourceId === targetId) throw bad("Une fiche ne peut pas être reliée à elle-même.");
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
  return tx(db, () => {
    const t = get<{ transitive: number; symmetric: number }>(db, "SELECT transitive, symmetric FROM relation_type WHERE id = ?", typeId)!;
    const dup = get(db, "SELECT 1 FROM relation WHERE type_id = ? AND ((source_id = ? AND target_id = ?)" + (bool(t.symmetric) ? " OR (source_id = ? AND target_id = ?))" : ")"),
      ...(bool(t.symmetric) ? [typeId, sourceId, targetId, targetId, sourceId] : [typeId, sourceId, targetId]));
    if (dup) throw conflict("Cette relation existe déjà.");
    if (bool(t.transitive) && !bool(t.symmetric)) {
      const path = findPath(db, typeId, targetId, sourceId);
      if (path) throw conflict(`Boucle refusée : ${path.map((p) => nameOf(db, p)).join(" → ")} existe déjà.`, { chain: path });
    }
    return { id: insert(db, "INSERT INTO relation (world_id, type_id, source_id, target_id, note) VALUES (?, ?, ?, ?, ?)", wid, typeId, sourceId, targetId, note) };
  });
}

export function deleteRelation(db: DB, wid: number, id: number) {
  owned(db, "relation", id, wid, "Relation");
  run(db, "DELETE FROM relation WHERE id = ?", id);
  return { deleted: true };
}

/**
 * Vue des relations d'une fiche :
 * - directes : faits enregistrés depuis la fiche ;
 * - inverses : faits enregistrés depuis l'autre fiche, lus avec le nom inverse ;
 * - déduites : pour les types transitifs, fiches atteintes par une chaîne (avec le chemin) ;
 * - boucles : chaînes anciennes qui reviennent à la fiche (signalées, jamais corrigées).
 */
export function entityRelations(db: DB, wid: number, id: number) {
  owned(db, "entity", id, wid, "Fiche");
  const types = new Map(listRelationTypes(db, wid).map((t) => [t.id, t]));
  const rels = all<Rel>(db, "SELECT id, type_id AS typeId, source_id AS sourceId, target_id AS targetId, note FROM relation WHERE world_id = ?", wid);
  const ents = new Map(all<{ id: number; name: string; typeColor: string | null; typeName: string | null }>(db,
    "SELECT e.id, e.name, t.color AS typeColor, t.name AS typeName FROM entity e LEFT JOIN entity_type t ON t.id = e.type_id WHERE e.world_id = ?", wid).map((e) => [e.id, e]));
  const ref = (eid: number) => ({ id: eid, name: ents.get(eid)?.name ?? "?", typeColor: ents.get(eid)?.typeColor ?? null, typeName: ents.get(eid)?.typeName ?? null });
  const direct = rels.filter((r) => r.sourceId === id).map((r) => ({ id: r.id, typeId: r.typeId, label: types.get(r.typeId)!.name, other: ref(r.targetId), note: r.note }));
  const inverse = rels.filter((r) => r.targetId === id).map((r) => ({ id: r.id, typeId: r.typeId, label: types.get(r.typeId)!.inverseName, other: ref(r.sourceId), note: r.note }));
  const inferred: { typeId: number; label: string; other: ReturnType<typeof ref>; via: string[] }[] = [];
  const cycles: { typeId: number; label: string; chain: string[] }[] = [];
  for (const t of types.values()) {
    if (!t.transitive) continue;
    const edges = rels.filter((r) => r.typeId === t.id);
    for (const [dir, label] of [["fwd", t.name], ["back", t.inverseName]] as const) {
      const next = new Map<number, number[]>();
      for (const e of edges) {
        const [a, b] = dir === "fwd" || t.symmetric ? [e.sourceId, e.targetId] : [e.targetId, e.sourceId];
        next.set(a, [...(next.get(a) ?? []), b]);
        if (t.symmetric) next.set(b, [...(next.get(b) ?? []), a]);
      }
      const prev = new Map<number, number>([[id, -1]]);
      const queue = [id];
      while (queue.length) {
        const n = queue.shift()!;
        for (const m of next.get(n) ?? []) {
          if (m === id && !t.symmetric && dir === "fwd" && n !== id) {
            const chain = [id];
            let c = n;
            while (c !== -1 && c !== id) { chain.splice(1, 0, c); c = prev.get(c)!; }
            chain.push(id);
            cycles.push({ typeId: t.id, label: t.name, chain: chain.map((x) => ref(x).name) });
          }
          if (prev.has(m)) continue;
          prev.set(m, n);
          queue.push(m);
        }
      }
      for (const [node, p] of prev) {
        if (node === id || p === id) continue; // fiche elle-même ou fait direct/inverse déjà listé
        const via: string[] = [];
        let c = p;
        while (c !== id && c !== -1) { via.unshift(ref(c).name); c = prev.get(c)!; }
        inferred.push({ typeId: t.id, label, other: ref(node), via });
      }
      if (t.symmetric) break;
    }
  }
  return { direct, inverse, inferred, cycles };
}

/** Arbre généalogique : ascendants et descendants via un type « parent de ». */
export function familyTree(db: DB, wid: number, id: number, typeId: number, reverse: boolean, depth = 6) {
  owned(db, "entity", id, wid, "Fiche");
  owned(db, "relation_type", typeId, wid, "Type de relation");
  const edges = all<{ s: number; t: number }>(db, "SELECT source_id AS s, target_id AS t FROM relation WHERE type_id = ?", typeId)
    .map((e) => (reverse ? { s: e.t, t: e.s } : e)); // s = parent, t = enfant
  const ents = new Map(all<{ id: number; name: string; typeColor: string | null }>(db,
    "SELECT e.id, e.name, t.color AS typeColor FROM entity e LEFT JOIN entity_type t ON t.id = e.type_id WHERE e.world_id = ?", wid).map((e) => [e.id, e]));
  type Node = { id: number; name: string; typeColor: string | null; children: Node[] };
  const build = (n: number, dir: "up" | "down", d: number, seen: Set<number>): Node => {
    const e = ents.get(n)!;
    const next = d >= depth || seen.has(n) ? [] : edges.filter((x) => (dir === "down" ? x.s === n : x.t === n)).map((x) => (dir === "down" ? x.t : x.s));
    const s2 = new Set(seen).add(n);
    return { id: n, name: e.name, typeColor: e.typeColor, children: next.map((m) => build(m, dir, d + 1, s2)) };
  };
  const root = build(id, "down", 0, new Set());
  return { ancestors: build(id, "up", 0, new Set()).children, root };
}
