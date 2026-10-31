import { all, type DB } from "../db.ts";
import { bad } from "../errors.ts";
import { findExcerpts, normalize, parseQuery, toPlainText, type Excerpt } from "../../shared/richtext.ts";
import { sectionPath } from "./entities.ts";

type Field = { label: string; text: string };
type Doc = { kind: "entity" | "map" | "era" | "document" | "section"; scope: "world" | "writing"; id: number; name: string; href: string; context: string; color?: string | null; fields: Field[] };

/**
 * Recherche plein texte dans un monde, sans index : les textes sont relus à
 * chaque requête (suffisant à l'échelle d'un monde personnel). Tous les mots
 * doivent être présents (éventuellement dans des champs différents) ; une
 * expression entre guillemets doit l'être telle quelle dans un même champ.
 */
export function searchWorld(db: DB, wid: number, p: URLSearchParams) {
  const q = (p.get("q") ?? "").trim();
  if (q.length < 2) throw bad("Saisissez au moins 2 caractères.");
  const scope = p.get("scope") ?? "all";
  if (!["all", "world", "writing"].includes(scope)) throw bad("Onglet inconnu.");
  const offset = Math.max(0, Number(p.get("offset")) || 0);
  const terms = parseQuery(q);
  const names = new Map(all<{ id: number; name: string }>(db, "SELECT id, name FROM entity WHERE world_id = ?", wid).map((r) => [r.id, r.name]));
  const docs: Doc[] = [];

  const ents = all<{ id: number; name: string; summary: string; description: string; typeName: string | null; typeColor: string | null }>(db,
    "SELECT e.id, e.name, e.summary, e.description, t.name AS typeName, t.color AS typeColor FROM entity e LEFT JOIN entity_type t ON t.id = e.type_id WHERE e.world_id = ?", wid);
  const props = all<{ entityId: number; name: string; value: string }>(db,
    "SELECT v.entity_id AS entityId, d.name, v.value FROM property_value v JOIN property_def d ON d.id = v.def_id WHERE d.world_id = ? AND d.kind IN ('text','longtext')", wid);
  const captions = all<{ entityId: number; caption: string }>(db, "SELECT em.entity_id AS entityId, em.caption FROM entity_media em JOIN entity e ON e.id = em.entity_id WHERE e.world_id = ? AND em.caption <> ''", wid);
  for (const e of ents) {
    docs.push({ kind: "entity", scope: "world", id: e.id, name: e.name, href: `entities/${e.id}`, context: e.typeName ?? "Fiche", color: e.typeColor, fields: [
      { label: "Nom", text: e.name }, { label: "Résumé", text: e.summary }, { label: "Description", text: toPlainText(e.description, names) },
      ...props.filter((x) => x.entityId === e.id).map((x) => ({ label: x.name, text: JSON.parse(x.value) as string })),
      ...captions.filter((x) => x.entityId === e.id).map((x) => ({ label: "Légende", text: x.caption })),
    ] });
  }
  for (const m of all<{ id: number; name: string }>(db, "SELECT id, name FROM map WHERE world_id = ?", wid)) docs.push({ kind: "map", scope: "world", id: m.id, name: m.name, href: `maps/${m.id}`, context: "Carte", fields: [{ label: "Nom", text: m.name }] });
  for (const e of all<{ id: number; name: string }>(db, "SELECT id, name FROM era WHERE world_id = ?", wid)) docs.push({ kind: "era", scope: "world", id: e.id, name: e.name, href: "chronology", context: "Ère", fields: [{ label: "Nom", text: e.name }] });
  for (const d of all<{ id: number; title: string }>(db, "SELECT id, title FROM document WHERE world_id = ?", wid)) docs.push({ kind: "document", scope: "writing", id: d.id, name: d.title, href: `documents/${d.id}`, context: "Écriture · document", fields: [{ label: "Nom", text: d.title }] });
  for (const s of all<{ id: number; title: string; content: string; documentId: number; documentTitle: string; parentId: number | null }>(db,
    "SELECT s.id, s.title, s.content, s.parent_id AS parentId, d.id AS documentId, d.title AS documentTitle FROM section s JOIN document d ON d.id = s.document_id WHERE d.world_id = ?", wid)) {
    docs.push({ kind: "section", scope: "writing", id: s.id, name: s.title, href: `documents/${s.documentId}?section=${s.id}`,
      context: ["Écriture", s.documentTitle, ...sectionPath(db, s.parentId)].join(" › "), fields: [{ label: "Nom", text: s.title }, { label: "Texte", text: toPlainText(s.content, names) }] });
  }

  const results: { doc: Doc; rank: number; excerpts: (Excerpt & { label: string })[] }[] = [];
  for (const d of docs) {
    const normFields = d.fields.map((f) => normalize(f.text));
    if (!terms.every((t) => normFields.some((f) => f.includes(t)))) continue;
    const nn = normalize(d.name);
    const rank = nn === normalize(q.replace(/"/g, "")) ? 0 : terms.every((t) => nn.includes(t)) ? 1 : terms.some((t) => nn.includes(t)) ? 2 : 3;
    const excerpts: (Excerpt & { label: string })[] = [];
    d.fields.forEach((f, i) => {
      if (f.label === "Nom" || excerpts.length >= 3 || !terms.some((t) => normFields[i].includes(t))) return;
      for (const x of findExcerpts(f.text, terms, d.kind === "section" ? 1 : 3 - excerpts.length)) excerpts.push({ ...x, label: f.label });
    });
    results.push({ doc: d, rank, excerpts });
  }
  results.sort((a, b) => a.rank - b.rank || a.doc.name.localeCompare(b.doc.name, "fr"));
  const counts = { all: results.length, world: results.filter((r) => r.doc.scope === "world").length, writing: results.filter((r) => r.doc.scope === "writing").length };
  const filtered = scope === "all" ? results : results.filter((r) => r.doc.scope === scope);
  return {
    counts,
    items: filtered.slice(offset, offset + 50).map(({ doc, excerpts }) => ({ kind: doc.kind, id: doc.id, name: doc.name, href: doc.href, context: doc.context, color: doc.color ?? null, excerpts })),
    nextOffset: offset + 50 < filtered.length ? offset + 50 : null,
  };
}
