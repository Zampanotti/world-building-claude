import { useEffect, useRef, useState } from "react";
import { api, w } from "../api.ts";
import { ErrorBox, Loading } from "../ui.tsx";

type Ex = { before: string; match: string; after: string; label: string };
type Item = { kind: string; id: number; name: string; href: string; context: string; color: string | null; excerpts: Ex[] };
type Res = { counts: { all: number; world: number; writing: number }; items: Item[]; nextOffset: number | null };
const ICON: Record<string, string> = { entity: "📇", map: "🗺️", era: "⏳", document: "✒️", section: "✒️" };

export function SearchPage({ wid, query }: { wid: number; query: URLSearchParams }) {
  const [q, setQ] = useState(query.get("q") ?? "");
  const [scope, setScope] = useState(query.get("scope") ?? "all");
  const [res, setRes] = useState<Res | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const run = (offset = 0) => {
    if (q.trim().length < 2) { setRes(null); return; }
    const n = ++seq.current;
    setLoading(true); setError(null);
    api<Res>("GET", w(wid, `/search?${new URLSearchParams({ q, scope, offset: String(offset) })}`)).then((r) => {
      if (n !== seq.current) return;
      setRes((cur) => (offset && cur ? { ...r, items: [...cur.items, ...r.items.filter((x) => !cur.items.some((c) => c.kind === x.kind && c.id === x.id))] } : r));
      setLoading(false);
    }, (e: Error) => { if (n === seq.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(() => {
    const t = setTimeout(() => run(0), 250);
    history.replaceState(null, "", `#/w/${wid}/search?${new URLSearchParams({ q, scope })}`);
    return () => clearTimeout(t);
  }, [q, scope, wid]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabs: [string, string][] = [["all", "Tout"], ["world", "Fiches"], ["writing", "Textes"]];
  return (
    <div className="stack">
      <h1>Recherche</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder='Mots ou "expression exacte" — noms, descriptions, propriétés, légendes, cartes, ères, textes…' aria-label="Recherche" style={{ fontSize: "1.1rem", padding: ".7em .9em" }} />
      <div className="row" role="tablist">{tabs.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={scope === k} className={`btn small ${scope === k ? "primary" : ""}`} onClick={() => setScope(k)}>{l}{res ? ` (${res.counts[k as keyof Res["counts"]]})` : ""}</button>
      ))}</div>
      {error && <ErrorBox error={error} retry={() => run(0)} />}
      {res && res.items.length === 0 && !loading && <div className="empty card">Aucun résultat pour « {q} ».</div>}
      <div className="stack">{res?.items.map((it) => (
        <a key={`${it.kind}${it.id}`} className="card" href={`#/w/${wid}/${it.href}`} style={{ color: "inherit", textDecoration: "none" }}>
          <div className="row"><span>{ICON[it.kind]}</span><strong>{it.name}</strong><span className="muted small">{it.context}</span></div>
          {it.excerpts.map((x, i) => <div key={i} className="small muted"><span className="badge" style={{ marginRight: ".4em" }}>{x.label}</span>{x.before}<mark>{x.match}</mark>{x.after}</div>)}
        </a>
      ))}</div>
      {loading && <Loading what="Recherche…" />}
      {res?.nextOffset && !loading && <div className="row" style={{ justifyContent: "center" }}><button className="btn" onClick={() => run(res.nextOffset!)}>Afficher plus</button></div>}
    </div>
  );
}
