import { useState } from "react";
import { api } from "../api.ts";
import { go } from "../router.ts";
import { useLoad, Loading, ErrorBox, toast } from "../ui.tsx";

type WorldRow = { id: number; name: string; description: string; entities: number; documents: number };

export function Home() {
  const worlds = useLoad(() => api<WorldRow[]>("GET", "/api/worlds"), []);
  const [name, setName] = useState("");
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try { const r = await api<{ id: number }>("POST", "/api/worlds", { name, empty }); go(`/w/${r.id}`); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const example = async () => {
    setBusy(true);
    try { const r = await api<{ id: number }>("POST", "/api/worlds/example"); toast("Monde d'exemple créé."); go(`/w/${r.id}`); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="hero">
      <div className="row between">
        <div>
          <h1>World Building</h1>
          <p className="muted">Votre atelier de mondes : fiches, relations, cartes, chronologie et écriture, au même endroit. Tout reste sur votre ordinateur.</p>
        </div>
        <a className="btn" href="#/aide">❓ Aide</a>
      </div>
      <div className="card" style={{ margin: "1.5rem 0" }}>
        <form className="row" onSubmit={create}>
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du nouveau monde" aria-label="Nom du nouveau monde" />
          <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />vide (sans types proposés)</label>
          <button className="btn primary" disabled={busy || !name.trim()}>Créer le monde</button>
          <button type="button" className="btn" disabled={busy} onClick={example}>✨ Monde d'exemple</button>
          <a className="btn" href="#/import">Importer…</a>
        </form>
        {error && <div style={{ marginTop: ".8rem" }}><ErrorBox error={error} /></div>}
      </div>
      {worlds.error && <ErrorBox error={worlds.error} retry={worlds.reload} />}
      {worlds.loading && !worlds.data && <Loading />}
      {worlds.data && worlds.data.length === 0 && <div className="empty card">Aucun monde pour l'instant. Créez-en un, ou essayez le monde d'exemple.</div>}
      <div className="grid-cards">
        {worlds.data?.map((wd) => (
          <a key={wd.id} className="card world-card" href={`#/w/${wd.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            <h2>{wd.name}</h2>
            {wd.description && <p className="muted small" style={{ margin: 0 }}>{wd.description.slice(0, 140)}</p>}
            <span className="muted small">{wd.entities} fiche(s) · {wd.documents} document(s)</span>
          </a>
        ))}
      </div>
    </div>
  );
}
