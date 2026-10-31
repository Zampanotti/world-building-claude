import { useEffect, useRef, useState } from "react";
import { api, w, mediaUrl } from "../api.ts";
import { go } from "../router.ts";
import { ErrorBox, TypeBadge, Loading, toast } from "../ui.tsx";

type Item = { id: number; name: string; summary: string; typeName: string | null; typeColor: string | null; imageId: number | null; tags: string | null };
type Opt = { id: number; name: string; color: string };

export function Explorer({ wid, query }: { wid: number; query: URLSearchParams }) {
  const [q, setQ] = useState(query.get("q") ?? "");
  const [type, setType] = useState(query.get("type") ?? "");
  const [tag, setTag] = useState(query.get("tag") ?? "");
  const [types, setTypes] = useState<Opt[]>([]);
  const [tags, setTags] = useState<Opt[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    api<Opt[]>("GET", w(wid, "/types")).then(setTypes).catch(() => {});
    api<Opt[]>("GET", w(wid, "/tags")).then(setTags).catch(() => {});
  }, [wid]);

  const load = (after: string | null) => {
    const n = ++seq.current;
    setLoading(true); setError(null);
    const p = new URLSearchParams({ q, ...(type ? { type } : {}), ...(tag ? { tag } : {}), ...(after ? { cursor: after } : {}) });
    api<{ items: Item[]; nextCursor: string | null }>("GET", w(wid, `/entities?${p}`)).then((r) => {
      if (n !== seq.current) return; // réponse périmée : une autre recherche a été lancée
      setItems((cur) => (after ? [...cur, ...r.items] : r.items));
      setCursor(r.nextCursor);
      setLoading(false);
    }, (e: Error) => { if (n === seq.current) { setError(e.message); setLoading(false); } });
  };
  useEffect(() => {
    const t = setTimeout(() => load(null), 200);
    history.replaceState(null, "", `#/w/${wid}/entities?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), ...(tag ? { tag } : {}) })}`);
    return () => clearTimeout(t);
  }, [q, type, tag, wid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div className="topbar"><h1>Fiches</h1></div>
      <form className="card row" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await api<{ id: number }>("POST", w(wid, "/entities"), { name: newName, typeId: type && type !== "none" ? Number(type) : null }); toast("Fiche créée."); go(`/w/${wid}/entities/${r.id}`); }
        catch (err) { toast((err as Error).message); }
      }}>
        <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom d'une nouvelle fiche" aria-label="Nom d'une nouvelle fiche" />
        <button className="btn primary" disabled={!newName.trim()}>＋ Créer{type && type !== "none" ? ` (${types.find((t) => String(t.id) === type)?.name ?? ""})` : ""}</button>
      </form>
      <div className="row">
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer par nom…" aria-label="Filtrer par nom" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Tous les types</option><option value="none">Sans type</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {tags.length > 0 && <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Étiquette">
          <option value="">Toutes les étiquettes</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>}
      </div>
      {error && <ErrorBox error={error} retry={() => load(null)} />}
      {!loading && !error && items.length === 0 && <div className="empty card">{q || type || tag ? "Aucune fiche ne correspond à ces critères." : "Ce monde n'a pas encore de fiche."}</div>}
      <div className="grid-cards">
        {items.map((e) => (
          <a key={e.id} href={`#/w/${wid}/entities/${e.id}`} className="card row" style={{ color: "inherit", textDecoration: "none", alignItems: "flex-start", flexWrap: "nowrap" }}>
            {e.imageId ? <img src={mediaUrl(wid, e.imageId)} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flex: "none" }} loading="lazy" />
              : <div style={{ width: 56, height: 56, borderRadius: 8, background: e.typeColor ?? "var(--panel-2)", opacity: .25, flex: "none" }} />}
            <div style={{ minWidth: 0 }}>
              <strong>{e.name}</strong>
              <div className="row" style={{ gap: ".3rem", margin: ".2rem 0" }}><TypeBadge name={e.typeName} color={e.typeColor} />{e.tags && <span className="muted small">{e.tags}</span>}</div>
              {e.summary && <div className="muted small">{e.summary.slice(0, 110)}</div>}
            </div>
          </a>
        ))}
      </div>
      {loading && <Loading />}
      {cursor && !loading && <div className="row" style={{ justifyContent: "center" }}><button className="btn" onClick={() => load(cursor)}>Afficher plus</button></div>}
    </div>
  );
}
