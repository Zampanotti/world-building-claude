import { useEffect, useState } from "react";
import { api, w } from "../api.ts";
import { useLoad, ErrorBox, ConfirmButton, EntityPicker, Loading, toast, type Suggestion } from "../ui.tsx";

type Ref = { id: number; name: string; typeColor: string | null; typeName: string | null };
type Rels = {
  direct: { id: number; typeId: number; label: string; other: Ref; note: string }[];
  inverse: { id: number; typeId: number; label: string; other: Ref; note: string }[];
  inferred: { typeId: number; label: string; other: Ref; via: string[] }[];
  cycles: { typeId: number; label: string; chain: string[] }[];
};
type RType = { id: number; name: string; inverseName: string; transitive: boolean; symmetric: boolean };

const loadRels = (wid: number, id: number) => api<Rels>("GET", w(wid, `/entities/${id}/relations`));

export function RelationsPanel({ wid, entityId, entityName }: { wid: number; entityId: number; entityName: string }) {
  const rels = useLoad(() => loadRels(wid, entityId), [wid, entityId]);
  const [types, setTypes] = useState<RType[]>([]);
  const [choice, setChoice] = useState("");
  const [target, setTarget] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"list" | "graph" | "family">("list");
  useEffect(() => { api<RType[]>("GET", w(wid, "/relation-types")).then((t) => { setTypes(t); if (t[0]) setChoice(`${t[0].id}:f`); }).catch(() => {}); }, [wid]);

  const add = async () => {
    if (!target || !choice) return;
    const [tid, dir] = choice.split(":");
    setError(null);
    try {
      await api("POST", w(wid, "/relations"), { typeId: Number(tid), sourceId: dir === "f" ? entityId : target.id, targetId: dir === "f" ? target.id : entityId });
      setTarget(null); rels.reload(); toast("Relation ajoutée.");
    } catch (e) { setError((e as Error).message); }
  };
  const Link = ({ r }: { r: Ref }) => <a href={`#/w/${wid}/entities/${r.id}`}><span className="dot" style={{ background: r.typeColor ?? "#999", marginRight: ".3em" }} />{r.name}</a>;
  const data = rels.data;
  return (
    <section className="card">
      <div className="section-title"><h2>Relations</h2>
        <div className="row" role="tablist">
          {(["list", "graph", "family"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`btn small ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>{{ list: "Liste", graph: "Schéma", family: "Arbre" }[t]}</button>)}
        </div>
      </div>
      {rels.error && <ErrorBox error={rels.error} retry={rels.reload} />}
      {data?.cycles.map((c, i) => <div key={i} className="warn small" style={{ marginBottom: ".5rem" }}>⚠ Boucle « {c.label} » : {c.chain.join(" → ")}. Retirez l'un de ces faits pour la corriger.</div>)}
      {tab === "list" && data && (
        <div className="stack">
          {data.direct.length + data.inverse.length + data.inferred.length === 0 && <p className="muted small">Aucune relation.</p>}
          <ul className="rel-list">
            {data.direct.map((r) => (
              <li key={`d${r.id}`}><span className="rel-label">{r.label}</span><Link r={r.other} />
                <ConfirmButton label="Retirer" className="btn ghost small" title="Retirer la relation ?" confirmLabel="Retirer"
                  message={<p>« {entityName} <em>{r.label}</em> {r.other.name} » sera retiré. Les relations déduites seront recalculées.</p>}
                  onConfirm={async () => { await api("DELETE", w(wid, `/relations/${r.id}`)); rels.reload(); }} /></li>
            ))}
            {data.inverse.map((r) => (
              <li key={`i${r.id}`}><span className="rel-label">{r.label}</span><Link r={r.other} /><span className="muted small" title="Fait enregistré depuis l'autre fiche">(inverse)</span>
                <ConfirmButton label="Retirer" className="btn ghost small" title="Retirer la relation ?" confirmLabel="Retirer"
                  message={<p>Le fait enregistré depuis « {r.other.name} » sera retiré.</p>}
                  onConfirm={async () => { await api("DELETE", w(wid, `/relations/${r.id}`)); rels.reload(); }} /></li>
            ))}
            {data.inferred.map((r, i) => (
              <li key={`x${i}`} className="muted"><span className="rel-label">{r.label}</span><Link r={r.other} /><span className="small">(déduit, via {r.via.join(" → ")})</span></li>
            ))}
          </ul>
          <div className="row" style={{ borderTop: "1px solid var(--border)", paddingTop: ".7rem" }}>
            <span className="small">{entityName}</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Type de relation">
              {types.map((t) => [<option key={`${t.id}f`} value={`${t.id}:f`}>{t.name}</option>, !t.symmetric && <option key={`${t.id}b`} value={`${t.id}:b`}>{t.inverseName}</option>])}
            </select>
            {target ? <span className="badge">{target.name} <button className="btn ghost small" onClick={() => setTarget(null)} aria-label="Changer">✕</button></span>
              : <div className="grow" style={{ minWidth: 200 }}><EntityPicker wid={wid} allowCreate exclude={[entityId]} onPick={setTarget} /></div>}
            <button className="btn primary small" disabled={!target} onClick={add}>Ajouter</button>
          </div>
          {error && <ErrorBox error={error} />}
        </div>
      )}
      {tab === "graph" && <RelationGraph wid={wid} startId={entityId} />}
      {tab === "family" && <FamilyTree wid={wid} id={entityId} types={types} />}
    </section>
  );
}

/**
 * Schéma centré sur une fiche : voisines immédiates en cercle, flèches dans le
 * sens de lecture, déductions en pointillé (masquées par défaut). Cliquer une
 * voisine recentre le schéma ; seule la réponse du dernier centre s'affiche.
 */
export function RelationGraph({ wid, startId }: { wid: number; startId: number }) {
  const [center, setCenter] = useState(startId);
  const [inferred, setInferred] = useState(false);
  const [names, setNames] = useState<Record<number, string>>({});
  const rels = useLoad(() => loadRels(wid, center), [wid, center]);
  useEffect(() => setCenter(startId), [startId]);
  if (rels.error) return <ErrorBox error={rels.error} retry={rels.reload} />;
  if (!rels.data) return <Loading />;
  type Edge = { label: string; out: boolean; dashed: boolean };
  const groups = new Map<number, { ref: Ref; edges: Edge[] }>();
  const push = (ref: Ref, e: Edge) => { if (!groups.has(ref.id)) groups.set(ref.id, { ref, edges: [] }); groups.get(ref.id)!.edges.push(e); };
  rels.data.direct.forEach((r) => push(r.other, { label: r.label, out: true, dashed: false }));
  rels.data.inverse.forEach((r) => push(r.other, { label: r.label, out: true, dashed: false }));
  if (inferred) rels.data.inferred.forEach((r) => push(r.other, { label: r.label, out: true, dashed: true }));
  const all = [...groups.values()];
  const shown = all.slice(0, 30);
  const W = 760, H = 480, cx = W / 2, cy = H / 2, R = Math.min(200, 90 + shown.length * 8);
  const centerName = names[center] ?? (center === startId ? "" : "");
  return (
    <div className="graph stack">
      <div className="row between">
        <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={inferred} onChange={(e) => setInferred(e.target.checked)} />Afficher les relations déduites</label>
        {center !== startId && <span className="row"><a className="btn small" href={`#/w/${wid}/entities/${center}`}>Ouvrir {centerName || "cette fiche"}</a><button className="btn small" onClick={() => setCenter(startId)}>↺ Revenir à la fiche</button></span>}
      </div>
      {shown.length === 0 ? <p className="muted small">Aucune relation à dessiner.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Schéma des relations">
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" /></marker></defs>
          {shown.map((g, i) => {
            const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(a) * R * 1.45, y = cy + Math.sin(a) * R;
            const sx = cx + (x - cx) * 0.18, sy = cy + (y - cy) * 0.18, ex = cx + (x - cx) * 0.86, ey = cy + (y - cy) * 0.86;
            return (
              <g key={g.ref.id}>
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--muted)" strokeWidth="1.3" strokeDasharray={g.edges.every((e) => e.dashed) ? "5 4" : undefined} markerEnd="url(#arrow)" />
                <text className="edge-label" x={(sx + ex) / 2} y={(sy + ey) / 2 - 4} textAnchor="middle">{[...new Set(g.edges.map((e) => e.label))].join(" · ")}</text>
                <g style={{ cursor: "pointer" }} onClick={() => { setNames((n) => ({ ...n, [g.ref.id]: g.ref.name })); setCenter(g.ref.id); }}>
                  <circle cx={x} cy={y} r="9" fill={g.ref.typeColor ?? "#94a3b8"} />
                  <text className="node-label" x={x} y={Math.sin(a) < -0.3 ? y - 15 : y + 24} textAnchor="middle">{g.ref.name.length > 22 ? g.ref.name.slice(0, 21) + "…" : g.ref.name}</text>
                </g>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r="16" fill="var(--accent)" />
          <text className="node-label" x={cx} y={cy + 34} textAnchor="middle" fontWeight="bold">{center === startId ? "Cette fiche" : centerName}</text>
        </svg>
      )}
      {all.length > shown.length && <p className="muted small">{all.length - shown.length} voisine(s) non dessinée(s) : consultez la liste.</p>}
      <p className="muted small">Les flèches se lisent depuis le centre : « centre — relation → voisine ». Cliquez une voisine pour recentrer.</p>
    </div>
  );
}

type TreeNode = { id: number; name: string; typeColor: string | null; children: TreeNode[] };

/** Généalogie : ascendants et descendants suivant un type de relation « parent de ». */
function FamilyTree({ wid, id, types }: { wid: number; id: number; types: RType[] }) {
  const guess = types.find((t) => /parent/i.test(t.name)) ?? types.find((t) => /parent/i.test(t.inverseName));
  const [choice, setChoice] = useState(guess ? `${guess.id}:${/parent/i.test(guess.name) ? "f" : "b"}` : "");
  const [tid, dir] = choice.split(":");
  const tree = useLoad(() => (tid ? api<{ ancestors: TreeNode[]; root: TreeNode }>("GET", w(wid, `/entities/${id}/family?type=${tid}&reverse=${dir === "b" ? 1 : 0}`)) : Promise.resolve(null)), [wid, id, choice]);
  const Branch = ({ nodes }: { nodes: TreeNode[] }) => nodes.length ? <ul>{nodes.map((n) => <li key={n.id}><a href={`#/w/${wid}/entities/${n.id}`}><span className="dot" style={{ background: n.typeColor ?? "#999", marginRight: ".3em" }} />{n.name}</a><Branch nodes={n.children} /></li>)}</ul> : null;
  return (
    <div className="family stack">
      <label className="row" style={{ display: "flex" }}>Lien de filiation
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">— choisir —</option>
          {types.filter((t) => !t.symmetric).map((t) => [<option key={`${t.id}f`} value={`${t.id}:f`}>« {t.name} »</option>, <option key={`${t.id}b`} value={`${t.id}:b`}>« {t.inverseName} »</option>])}
        </select>
      </label>
      {tree.error && <ErrorBox error={tree.error} retry={tree.reload} />}
      {tree.data && (
        <div className="split">
          <div><h3>Ascendants</h3>{tree.data.ancestors.length ? <Branch nodes={tree.data.ancestors} /> : <p className="muted small">Aucun.</p>}</div>
          <div><h3>Descendants</h3>{tree.data.root.children.length ? <Branch nodes={tree.data.root.children} /> : <p className="muted small">Aucun.</p>}</div>
        </div>
      )}
    </div>
  );
}
