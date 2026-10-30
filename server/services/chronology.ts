import { all, get, insert, run, tx, type DB } from "../db.ts";
import { bad, conflict, str, color, int } from "../errors.ts";
import { owned } from "./common.ts";
import { listEras } from "./entities.ts";
import { absoluteKey, eraStarts, formatSpan, spanProblems, type TimeSpan, type DatePoint } from "../../shared/time.ts";

/** Ères utilisées par une date de fiche ou une propriété de genre « date ». */
function usedEraIds(db: DB, wid: number): Set<number> {
  const used = new Set<number>();
  for (const r of all<{ data: string }>(db, "SELECT ts.data FROM time_span ts JOIN entity e ON e.id = ts.entity_id WHERE e.world_id = ?", wid)) {
    const s = JSON.parse(r.data) as TimeSpan;
    used.add(s.start.eraId);
    if (s.end) used.add(s.end.eraId);
  }
  for (const r of all<{ value: string }>(db, "SELECT v.value FROM property_value v JOIN property_def d ON d.id = v.def_id WHERE d.world_id = ? AND d.kind = 'date'", wid)) {
    used.add((JSON.parse(r.value) as DatePoint).eraId);
  }
  return used;
}

/**
 * Remplace la liste des ères (ordre = ordre du tableau). Les dates étant
 * relatives aux ères, aucune date n'est réécrite. Une ère utilisée ne peut pas
 * être retirée. Seule la dernière ère peut être sans durée (en cours).
 */
export function saveEras(db: DB, wid: number, body: Record<string, unknown>) {
  if (!Array.isArray(body.eras) || !body.eras.length) throw bad("Il faut au moins une ère.");
  const items = body.eras as Record<string, unknown>[];
  return tx(db, () => {
    const keep = new Set<number>();
    items.forEach((e, i) => {
      const name = str(e.name, "nom de l'ère", { max: 80 });
      const duration = e.duration === null || e.duration === undefined || e.duration === "" ? null : int(e.duration, "durée");
      if (duration === null && i < items.length - 1) throw bad(`L'ère « ${name} » doit avoir une durée (seule la dernière peut être en cours).`);
      if (duration !== null && duration < 1) throw bad("Une durée doit être positive.");
      const gap = e.gapBefore ? int(e.gapBefore, "écart") : 0;
      if (gap < 0) throw bad("Un écart ne peut pas être négatif.");
      if (e.id) {
        const id = owned(db, "era", e.id, wid, "Ère");
        run(db, "UPDATE era SET name = ?, position = ?, duration = ?, gap_before = ?, color = ? WHERE id = ?", name, i, duration, gap, color(e.color ?? "#6366f1"), id);
        keep.add(id);
      } else keep.add(insert(db, "INSERT INTO era (world_id, name, position, duration, gap_before, color) VALUES (?, ?, ?, ?, ?, ?)", wid, name, i, duration, gap, color(e.color ?? "#6366f1")));
    });
    const used = usedEraIds(db, wid);
    for (const era of listEras(db, wid)) {
      if (keep.has(era.id)) continue;
      if (used.has(era.id)) throw conflict(`L'ère « ${era.name} » est utilisée par des dates : elle ne peut pas être retirée.`);
      run(db, "DELETE FROM era WHERE id = ?", era.id);
    }
    return listEras(db, wid);
  });
}

export function chronology(db: DB, wid: number, p: URLSearchParams) {
  const eras = listEras(db, wid);
  const starts = eraStarts(eras);
  const type = p.get("type");
  const typeId = type ? owned(db, "entity_type", type, wid, "Type") : null;
  const rows = all<{ id: number; name: string; data: string; typeId: number | null; typeName: string | null; typeColor: string | null }>(db,
    `SELECT e.id, e.name, ts.data, t.id AS typeId, t.name AS typeName, t.color AS typeColor FROM time_span ts
     JOIN entity e ON e.id = ts.entity_id LEFT JOIN entity_type t ON t.id = e.type_id WHERE e.world_id = ? ${typeId ? "AND e.type_id = ?" : ""}`, wid, ...(typeId ? [typeId] : []));
  const items = rows.map((r) => {
    const span = JSON.parse(r.data) as TimeSpan;
    const startKey = absoluteKey(span.start, starts);
    const endKey = span.end ? absoluteKey(span.end, starts) : null;
    return { entity: { id: r.id, name: r.name, typeName: r.typeName, typeColor: r.typeColor }, label: formatSpan(span, eras), startKey, endKey,
      startYear: startKey === null ? null : Math.floor(startKey / 10000), endYear: endKey === null ? null : Math.floor(endKey / 10000), problems: spanProblems(span, eras) };
  }).sort((a, b) => (a.startKey ?? Infinity) - (b.startKey ?? Infinity) || a.entity.name.localeCompare(b.entity.name, "fr"));
  const last = eras[eras.length - 1];
  return {
    eras: eras.map((e) => ({ ...e, startYear: starts.get(e.id)! })),
    present: last && last.duration !== null ? starts.get(last.id)! + last.duration : null,
    items,
    total: Number(get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM entity WHERE world_id = ?", wid)!.n),
  };
}
