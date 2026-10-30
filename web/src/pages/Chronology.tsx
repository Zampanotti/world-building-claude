import { useEffect, useState } from "react";
import { api, w } from "../api.ts";
import { useLoad, Loading, ErrorBox, toast } from "../ui.tsx";

type EraRow = { id?: number; name: string; duration: number | null; gapBefore: number; color: string };
type Chrono = {
  eras: (EraRow & { id: number; startYear: number })[];
  present: number | null;
  items: { entity: { id: number; name: string; typeName: string | null; typeColor: string | null }; label: string; startKey: number | null; startYear: number | null; endYear: number | null; problems: string[] }[];
  total: number;
};

export function Chronology({ wid }: { wid: number }) {
  const [type, setType] = useState("");
  const [types, setTypes] = useState<{ id: number; name: string }[]>([]);
  const data = useLoad(() => api<Chrono>("GET", w(wid, `/chronology${type ? "?type=" + type : ""}`)), [wid, type]);
  const [editing, setEditing] = useState(false);
  useEffect(() => { api<typeof types>("GET", w(wid, "/types")).then(setTypes).catch(() => {}); }, [wid]);
  if (data.error) return <ErrorBox error={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const { eras, items, present } = data.data;
  const byEra = (i: number) => {
    const start = eras[i].startYear, next = eras[i + 1]?.startYear ?? Infinity;
    return items.filter((it) => it.startYear !== null && it.startYear >= start && (it.startYear < next || i === eras.length - 1));
  };
  const before = items.filter((it) => it.startYear !== null && it.startYear < (eras[0]?.startYear ?? 0));
  const undated = items.filter((it) => it.startYear === null);
  const Item = ({ it }: { it: Chrono["items"][number] }) => (
    <div className="tl-item" style={{ ["--dot" as string]: it.entity.typeColor ?? "var(--accent)" }}>
      <a href={`#/w/${wid}/entities/${it.entity.id}`}><strong>{it.entity.name}</strong></a> <span className="muted small">— {it.label}{it.entity.typeName ? ` · ${it.entity.typeName}` : ""}</span>
      {it.problems.map((p) => <div key={p} className="small" style={{ color: "var(--warn)" }}>⚠ {p}</div>)}
    </div>
  );
  return (
    <div className="stack">
      <div className="topbar"><h1>Chronologie</h1><span className="grow" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrer par type"><option value="">Tous les types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <button className="btn" onClick={() => setEditing(!editing)}>{editing ? "Fermer le réglage" : "⚙ Régler les ères"}</button>
      </div>
      {editing && <EraEditor wid={wid} eras={eras} onSaved={() => { setEditing(false); data.reload(); }} />}
      <p className="muted small">{items.length} fiche(s) datée(s) sur {data.data.total}. Datez une fiche depuis sa section « Dates ». Les années sont recalculées à partir des ères : modifier une durée ne réécrit aucune date.</p>
      <div className="card timeline">
        {before.length > 0 && <><div className="tl-era" style={{ background: "#64748b" }}>Avant {eras[0].name}</div>{before.map((it, i) => <Item key={i} it={it} />)}</>}
        {eras.map((e, i) => (
          <div key={e.id}>
            <div className="tl-era" style={{ background: e.color }}>
              <span>{e.name}</span>
              <span className="small" style={{ fontWeight: 400 }}>{e.duration ? `${e.duration} ans` : "en cours"}{e.gapBefore ? ` · ${e.gapBefore} ans après la précédente` : ""}</span>
            </div>
            {byEra(i).map((it, j) => <Item key={j} it={it} />)}
            {i === eras.length - 1 && present !== null && <div className="tl-item muted small">— Aujourd'hui (an {e.duration} de {e.name})</div>}
          </div>
        ))}
        {undated.length > 0 && <><div className="tl-era" style={{ background: "#94a3b8" }}>Ère supprimée ou inconnue</div>{undated.map((it, i) => <Item key={i} it={it} />)}</>}
      </div>
    </div>
  );
}

function EraEditor({ wid, eras, onSaved }: { wid: number; eras: EraRow[]; onSaved: () => void }) {
  const [rows, setRows] = useState<EraRow[]>(eras.map(({ id, name, duration, gapBefore, color }) => ({ id, name, duration, gapBefore, color })));
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<EraRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const swap = (i: number, j: number) => { const r = [...rows]; [r[i], r[j]] = [r[j], r[i]]; setRows(r); };
  return (
    <div className="card stack">
      <p className="muted small">Les ères se suivent dans cet ordre. Seule la dernière peut être « en cours » (sans durée) ; si vous lui donnez une durée, sa fin marque « aujourd'hui ». Une ère utilisée par une date ne peut pas être retirée.</p>
      <div className="table-wrap"><table><thead><tr><th>Couleur</th><th>Nom</th><th>Durée (ans)</th><th>Écart avant</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id ?? `n${i}`}>
            <td><input type="color" value={r.color} onChange={(e) => set(i, { color: e.target.value })} style={{ padding: 2, width: 40 }} /></td>
            <td><input value={r.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: "100%" }} /></td>
            <td><input type="number" min={1} value={r.duration ?? ""} placeholder={i === rows.length - 1 ? "en cours" : ""} onChange={(e) => set(i, { duration: e.target.value ? Number(e.target.value) : null })} style={{ width: "7em" }} /></td>
            <td><input type="number" min={0} value={r.gapBefore} disabled={i === 0} onChange={(e) => set(i, { gapBefore: Number(e.target.value) || 0 })} style={{ width: "6em" }} /></td>
            <td className="row" style={{ flexWrap: "nowrap" }}>
              <button className="btn ghost small" disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</button>
              <button className="btn ghost small" disabled={i === rows.length - 1} onClick={() => swap(i, i + 1)}>↓</button>
              <button className="btn ghost small" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </td>
          </tr>
        ))}</tbody></table></div>
      {error && <ErrorBox error={error} />}
      <div className="row between">
        <button className="btn" onClick={() => setRows([...rows, { name: "Nouvelle ère", duration: null, gapBefore: 0, color: "#6366f1" }])}>＋ Ajouter une ère</button>
        <button className="btn primary" onClick={async () => {
          setError(null);
          try { await api("PUT", w(wid, "/eras"), { eras: rows }); toast("Ères enregistrées."); onSaved(); } catch (e) { setError((e as Error).message); }
        }}>Enregistrer les ères</button>
      </div>
    </div>
  );
}
