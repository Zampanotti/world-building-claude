import { useRef, useState } from "react";
import { api, w, mediaUrl } from "../api.ts";
import { useLoad, Loading, ErrorBox, ConfirmButton, formatBytes, toast } from "../ui.tsx";
import { uploadImage } from "../images.ts";

type M = { id: number; name: string; size: number; width: number; height: number; createdAt: string; entities: { id: number; name: string }[]; maps: { id: number; name: string }[] };

export function MediaPage({ wid }: { wid: number }) {
  const media = useLoad(() => api<M[]>("GET", w(wid, "/media")), [wid]);
  const [unused, setUnused] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (media.error) return <ErrorBox error={media.error} retry={media.reload} />;
  if (!media.data) return <Loading />;
  const list = media.data.filter((m) => !unused || (m.entities.length === 0 && m.maps.length === 0));
  return (
    <div className="stack">
      <div className="topbar"><h1>Médiathèque</h1><span className="grow" />
        <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={unused} onChange={(e) => setUnused(e.target.checked)} />Seulement les images inutilisées</label>
        <button className="btn primary" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Envoi…" : "＋ Ajouter des images"}</button>
      </div>
      <input ref={file} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (e) => {
        const files = [...(e.target.files ?? [])]; e.target.value = "";
        setBusy(true);
        for (const f of files) { try { const r = await uploadImage(wid, f); if (r.reused) toast(`« ${f.name} » était déjà dans la médiathèque.`); } catch (err) { toast((err as Error).message); } }
        setBusy(false); media.reload();
      }} />
      {list.length === 0 && <div className="empty card">{unused ? "Aucune image inutilisée." : "La médiathèque est vide. Les images ajoutées aux fiches et aux cartes apparaissent ici."}</div>}
      <div className="grid-cards">{list.map((m) => (
        <div key={m.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
          <a href={mediaUrl(wid, m.id)} target="_blank" rel="noreferrer"><img src={mediaUrl(wid, m.id)} alt={m.name} loading="lazy" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} /></a>
          <div style={{ padding: ".6rem .8rem" }} className="stack">
            <div className="small" style={{ overflowWrap: "anywhere" }}><strong>{m.name}</strong><br /><span className="muted">{m.width} × {m.height} · {formatBytes(m.size)}</span></div>
            {m.entities.map((e) => <a key={`e${e.id}`} className="small" href={`#/w/${wid}/entities/${e.id}`}>📇 {e.name}</a>)}
            {m.maps.map((e) => <a key={`m${e.id}`} className="small" href={`#/w/${wid}/maps/${e.id}`}>🗺️ Carte : {e.name}</a>)}
            {m.entities.length === 0 && m.maps.length === 0 && (
              <ConfirmButton label="Supprimer définitivement…" title="Supprimer l'image ?" message={<p>« {m.name} » n'est utilisée nulle part. Elle sera supprimée de la base.</p>}
                onConfirm={() => api("DELETE", w(wid, `/media/${m.id}`)).then(media.reload)} />
            )}
          </div>
        </div>
      ))}</div>
    </div>
  );
}
