import { useState } from "react";
import { api, w } from "../api.ts";
import { go } from "../router.ts";
import { useLoad, Loading, ErrorBox, TypeBadge, ConfirmButton, toast, EntityPicker } from "../ui.tsx";
import { FONTS, getFont, setFont, type FontId } from "../display.ts";

type Overview = {
  world: { id: number; name: string; description: string };
  stats: Record<"entities" | "relations" | "documents" | "maps" | "media" | "published", number>;
  byType: { id: number; name: string; color: string; n: number }[];
  recent: { id: number; name: string; typeName: string | null; typeColor: string | null; updatedAt: string }[];
};

export function Dashboard({ wid }: { wid: number }) {
  const o = useLoad(() => api<Overview>("GET", w(wid)), [wid]);
  if (o.error) return <ErrorBox error={o.error} retry={o.reload} />;
  if (!o.data) return <Loading />;
  const { world, stats, byType, recent } = o.data;
  const tiles: [string, number, string][] = [
    ["Fiches", stats.entities, "entities"], ["Relations", stats.relations, "types"], ["Documents", stats.documents, "documents"],
    ["Cartes", stats.maps, "maps"], ["Images", stats.media, "media"], ["Publiées", stats.published, "../../read/" + wid],
  ];
  return (
    <div className="stack">
      <div className="topbar"><h1>{world.name}</h1></div>
      {world.description && <p className="muted">{world.description}</p>}
      <div className="card">
        <div className="row" style={{ gap: "1rem" }}>
          <div className="grow" style={{ minWidth: 220 }}><EntityPicker wid={wid} allowCreate placeholder="Ouvrir ou créer une fiche…" onPick={(s) => go(`/w/${wid}/entities/${s.id}`)} /></div>
          <a className="btn" href={`#/w/${wid}/search`}>🔎 Recherche plein texte</a>
          <a className="btn" href={`#/w/${wid}/entities`}>Tout parcourir</a>
        </div>
      </div>
      <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {tiles.map(([label, n, href]) => (
          <a key={label} className="card" href={href.startsWith("..") ? `#/read/${wid}` : `#/w/${wid}/${href}`} style={{ color: "inherit", textDecoration: "none" }}>
            <div className="stat">{n}</div><div className="muted small">{label}</div>
          </a>
        ))}
      </div>
      <div className="split">
        <div className="card">
          <h2>Modifiées récemment</h2>
          {recent.length === 0 ? <p className="muted">Aucune fiche. Utilisez le champ ci-dessus pour en créer une.</p> : (
            <ul className="rel-list">{recent.map((e) => <li key={e.id}><a href={`#/w/${wid}/entities/${e.id}`}>{e.name}</a><TypeBadge name={e.typeName} color={e.typeColor} /></li>)}</ul>
          )}
        </div>
        <div className="card">
          <h2>Par type</h2>
          <ul className="rel-list">{byType.map((t) => (
            <li key={t.id}><a href={`#/w/${wid}/entities?type=${t.id}`}><TypeBadge name={t.name} color={t.color} /></a><span className="muted small">{t.n}</span></li>
          ))}</ul>
        </div>
      </div>
    </div>
  );
}

export function WorldSettings({ wid, onChange }: { wid: number; onChange: () => void }) {
  const o = useLoad(() => api<Overview>("GET", w(wid)), [wid]);
  const [name, setName] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!o.data) return o.error ? <ErrorBox error={o.error} retry={o.reload} /> : <Loading />;
  const world = o.data.world;
  return (
    <div className="stack">
      <h1>Réglages du monde</h1>
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault(); setError(null);
        try { await api("PATCH", w(wid), { name: name ?? world.name, expectedName: world.name, description: desc ?? world.description }); toast("Monde enregistré."); o.reload(); onChange(); }
        catch (err) { setError((err as Error).message); }
      }}>
        <label>Nom<input value={name ?? world.name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Présentation<textarea rows={3} value={desc ?? world.description} onChange={(e) => setDesc(e.target.value)} /></label>
        {error && <ErrorBox error={error} />}
        <div className="row end"><button className="btn primary">Enregistrer</button></div>
      </form>
      <DisplaySettings />
      <div className="card stack">
        <h2>Supprimer ce monde</h2>
        <p className="muted small">Toutes ses fiches, relations, images, cartes et textes seront retirés. Une copie complète de la base est faite avant, dans <code>data/backups/</code>. Pensez aussi à exporter le monde depuis « Sauvegarde ».</p>
        <label>Retapez le nom exact du monde pour confirmer<input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={world.name} /></label>
        <div className="row end">
          <ConfirmButton label="Supprimer définitivement…" title="Supprimer le monde ?" confirmLabel="Supprimer"
            message={<p>Le monde « {world.name} » sera supprimé. Cette action ne peut pas être annulée depuis l'application.</p>}
            onConfirm={async () => { await api("DELETE", w(wid), { confirmName: confirm }); toast("Monde supprimé (copie de sécurité faite)."); go("/"); }} />
        </div>
      </div>
    </div>
  );
}

/** Choix de la police des textes : enregistré sur cet appareil, pour tous les mondes. */
export function DisplaySettings() {
  const [font, setFontState] = useState<FontId>(getFont);
  return (
    <div className="card stack" id="affichage">
      <h2>Affichage</h2>
      <p className="muted small">Police des textes, des fiches et des titres. Ce réglage vaut pour tous les mondes, sur cet appareil.</p>
      <div className="font-choices" role="radiogroup" aria-label="Police des textes">
        {FONTS.map((f) => (
          <label key={f.id} className={`font-choice ${font === f.id ? "active" : ""}`}>
            <input type="radio" name="font" checked={font === f.id} onChange={() => { setFont(f.id); setFontState(f.id); }} />
            <span className="sample" style={{ fontFamily: f.family }}>{f.label}<em> — La nuit était tombée sur Aldémar.</em></span>
            <span className="muted small">{f.note}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
