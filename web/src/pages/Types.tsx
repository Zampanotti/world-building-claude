import { useState } from "react";
import { api, w } from "../api.ts";
import { useLoad, Loading, ErrorBox, ConfirmButton, toast } from "../ui.tsx";

type Prop = { id: number; name: string; kind: string; archived: boolean };
type T = { id: number; name: string; color: string; count: number; properties: Prop[] };
type RT = { id: number; name: string; inverseName: string; transitive: boolean; symmetric: boolean; count: number };
const KINDS: Record<string, string> = { text: "Texte court", longtext: "Texte long", number: "Nombre", boolean: "Oui / non", date: "Date (ère)", entity: "Lien vers une fiche" };

export function TypesPage({ wid }: { wid: number }) {
  const types = useLoad(() => api<T[]>("GET", w(wid, "/types")), [wid]);
  const rtypes = useLoad(() => api<RT[]>("GET", w(wid, "/relation-types")), [wid]);
  const tags = useLoad(() => api<{ id: number; name: string; color: string; count: number }[]>("GET", w(wid, "/tags")), [wid]);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setError(null);
    try { await fn(); after(); } catch (e) { setError((e as Error).message); }
  };
  const [nt, setNt] = useState({ name: "", color: "#64748b" });
  const [nr, setNr] = useState({ name: "", inverseName: "", transitive: false, symmetric: false });
  return (
    <div className="stack">
      <h1>Types et relations</h1>
      <p className="muted">Les types organisent les fiches et définissent leurs propriétés. Les types de relation décrivent les liens entre fiches.</p>
      {error && <ErrorBox error={error} />}
      <section className="card stack">
        <h2>Types de fiches</h2>
        {types.error && <ErrorBox error={types.error} retry={types.reload} />}
        {!types.data && !types.error && <Loading />}
        {types.data?.map((t) => <TypeCard key={t.id} wid={wid} t={t} run={run} reload={types.reload} />)}
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api("POST", w(wid, "/types"), nt), () => { setNt({ name: "", color: "#64748b" }); types.reload(); }); }}>
          <input type="color" value={nt.color} onChange={(e) => setNt({ ...nt, color: e.target.value })} aria-label="Couleur" style={{ padding: 2, width: 40 }} />
          <input className="grow" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} placeholder="Nouveau type (ex. Créature, Divinité…)" />
          <button className="btn primary" disabled={!nt.name.trim()}>Ajouter le type</button>
        </form>
      </section>
      <section className="card stack">
        <h2>Types de relation</h2>
        <p className="muted small"><strong>Inverse</strong> : comment le lien se lit depuis l'autre fiche (« possède » / « appartient à »). <strong>Transitive</strong> : les chaînes sont déduites (si A est situé dans B et B dans C, alors A est situé dans C) ; à éviter pour « ami de » ou « parent de ». <strong>Symétrique</strong> : le lien vaut dans les deux sens (« allié de »).</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Relation</th><th>Inverse</th><th>Propriétés</th><th>Faits</th><th /></tr></thead>
          <tbody>{rtypes.data?.map((r) => (
            <tr key={r.id}>
              <td><InlineEdit value={r.name} onSave={(name) => run(() => api("PATCH", w(wid, `/relation-types/${r.id}`), { name }), rtypes.reload)} /></td>
              <td>{r.symmetric ? <span className="muted">(identique)</span> : <InlineEdit value={r.inverseName} onSave={(inverseName) => run(() => api("PATCH", w(wid, `/relation-types/${r.id}`), { inverseName }), rtypes.reload)} />}</td>
              <td className="small">{[r.transitive && "transitive", r.symmetric && "symétrique"].filter(Boolean).join(", ") || "—"}</td>
              <td>{r.count}</td>
              <td><ConfirmButton label="Supprimer" className="btn ghost small" title="Supprimer ce type de relation ?" message={<p>« {r.name} » sera supprimé (refusé s'il est encore utilisé).</p>}
                onConfirm={() => api("DELETE", w(wid, `/relation-types/${r.id}`)).then(rtypes.reload)} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api("POST", w(wid, "/relation-types"), nr), () => { setNr({ name: "", inverseName: "", transitive: false, symmetric: false }); rtypes.reload(); }); }}>
          <input value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} placeholder="Relation (ex. vassal de)" />
          {!nr.symmetric && <input value={nr.inverseName} onChange={(e) => setNr({ ...nr, inverseName: e.target.value })} placeholder="Inverse (ex. suzerain de)" />}
          <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={nr.transitive} onChange={(e) => setNr({ ...nr, transitive: e.target.checked })} />transitive</label>
          <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={nr.symmetric} onChange={(e) => setNr({ ...nr, symmetric: e.target.checked })} />symétrique</label>
          <button className="btn primary" disabled={!nr.name.trim() || (!nr.symmetric && !nr.inverseName.trim())}>Ajouter</button>
        </form>
      </section>
      <section className="card stack">
        <h2>Étiquettes</h2>
        {tags.data?.length === 0 && <p className="muted small">Aucune étiquette. Ajoutez-en depuis une fiche (bouton « Étiquettes »).</p>}
        <div className="row">{tags.data?.map((t) => (
          <span key={t.id} className="badge"><span className="dot" style={{ background: t.color }} /><a href={`#/w/${wid}/entities?tag=${t.id}`}>{t.name}</a> ({t.count})
            <ConfirmButton label="✕" className="btn ghost small" title="Supprimer l'étiquette ?" message={<p>« {t.name} » sera retirée de {t.count} fiche(s). Les fiches ne sont pas modifiées autrement.</p>}
              onConfirm={() => api("DELETE", w(wid, `/tags/${t.id}`)).then(tags.reload)} /></span>
        ))}</div>
      </section>
    </div>
  );
}

function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== value && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} style={{ width: "100%" }} />;
}

function TypeCard({ wid, t, run, reload }: { wid: number; t: T; run: (fn: () => Promise<unknown>, after: () => void) => void; reload: () => void }) {
  const [np, setNp] = useState({ name: "", kind: "text" });
  const [showArchived, setShowArchived] = useState(false);
  return (
    <details className="card" style={{ boxShadow: "none" }}>
      <summary className="row" style={{ cursor: "pointer" }}>
        <span className="dot" style={{ background: t.color }} /><strong>{t.name}</strong>
        <span className="muted small">{t.count} fiche(s) · {t.properties.filter((p) => !p.archived).length} propriété(s)</span>
      </summary>
      <div className="stack" style={{ marginTop: ".8rem" }}>
        <div className="row">
          <input type="color" defaultValue={t.color} aria-label="Couleur" style={{ padding: 2, width: 40 }} onChange={(e) => run(() => api("PATCH", w(wid, `/types/${t.id}`), { color: e.target.value }), () => {})} onBlur={reload} />
          <InlineEdit value={t.name} onSave={(name) => run(() => api("PATCH", w(wid, `/types/${t.id}`), { name }), () => { toast("Type renommé."); reload(); })} />
          <ConfirmButton label="Supprimer le type" title="Supprimer ce type ?" message={<p>Refusé tant que des fiches l'utilisent.</p>}
            onConfirm={() => api("DELETE", w(wid, `/types/${t.id}`)).then(reload)} />
        </div>
        <div className="table-wrap"><table>
          <tbody>{t.properties.filter((p) => showArchived || !p.archived).map((p) => (
            <tr key={p.id} className={p.archived ? "muted" : ""}>
              <td><InlineEdit value={p.name} onSave={(name) => run(() => api("PATCH", w(wid, `/properties/${p.id}`), { name }), reload)} /></td>
              <td className="small">{KINDS[p.kind]}</td>
              <td><button className="btn ghost small" onClick={() => run(() => api("PATCH", w(wid, `/properties/${p.id}`), { archived: !p.archived }), reload)}>{p.archived ? "Réactiver" : "Archiver"}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        {t.properties.some((p) => p.archived) && <label className="row small" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Voir les propriétés archivées (leurs valeurs sont conservées)</label>}
        <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => api("POST", w(wid, `/types/${t.id}/properties`), np), () => { setNp({ name: "", kind: "text" }); reload(); }); }}>
          <input className="grow" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="Nouvelle propriété" />
          <select value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn" disabled={!np.name.trim()}>Ajouter</button>
        </form>
      </div>
    </details>
  );
}
