import { useRef, useState } from "react";
import { api, w } from "../api.ts";
import { go } from "../router.ts";
import { ErrorBox } from "../ui.tsx";

export function ArchivePage({ wid }: { wid: number }) {
  const [images, setImages] = useState(true);
  return (
    <div className="stack">
      <h1>Sauvegarde du monde</h1>
      <div className="card stack">
        <h2>Exporter</h2>
        <p>Télécharge un fichier <code>.json</code> contenant tout l'état de travail de ce monde : types, propriétés, fiches, étiquettes, relations, ères et dates, documents et sections{images ? ", images, galeries et cartes" : ""}.</p>
        <p className="muted small">Non inclus (et indiqué dans le fichier) : l'état publié, les brouillons non enregistrés du navigateur{images ? "" : ", les images et les cartes"}.</p>
        <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} />Inclure les images et les cartes</label>
        <div><a className="btn primary" href={w(wid, `/export?images=${images ? 1 : 0}`)} download>⬇ Télécharger la sauvegarde</a></div>
      </div>
      <div className="card stack">
        <h2>Importer</h2>
        <ImportPanel />
      </div>
      <div className="card stack">
        <h2>Sauvegarde complète</h2>
        <p className="muted small">Pour tout conserver (tous les mondes), copiez le dossier <code>data/</code> de l'application lorsqu'elle est arrêtée, ou suivez le guide <code>docs/SAUVEGARDE.md</code>. Une copie automatique est aussi faite dans <code>data/backups/</code> avant chaque suppression de monde et chaque migration de la base.</p>
      </div>
    </div>
  );
}

/** Import toujours dans un NOUVEAU monde : rien d'existant n'est modifié. */
export function ImportPanel() {
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ name: string; counts: Record<string, number>; data: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <p className="muted small">L'import crée toujours un nouveau monde « Nom (import) ». Le fichier est entièrement vérifié avant toute écriture : en cas de problème, rien n'est créé.</p>
      <div><button className="btn" onClick={() => file.current?.click()}>Choisir un fichier .json…</button></div>
      <input ref={file} type="file" hidden accept="application/json,.json" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        setError(null); setPreview(null);
        try {
          const data = JSON.parse(await f.text());
          const n = (k: string) => (Array.isArray(data[k]) ? data[k].length : 0);
          setPreview({ name: data.world?.name ?? "?", data, counts: { fiches: n("entities"), relations: n("relations"), documents: n("documents"), images: n("media"), cartes: n("maps") } });
        } catch { setError("Ce fichier n'est pas un JSON lisible."); }
      }} />
      {preview && (
        <div className="card stack" style={{ boxShadow: "none" }}>
          <strong>Monde « {preview.name} »</strong>
          <span className="muted small">{Object.entries(preview.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}</span>
          <div><button className="btn primary" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { const r = await api<{ id: number }>("POST", "/api/worlds/import", preview.data); go(`/w/${r.id}`); }
            catch (err) { setError((err as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Import…" : "Importer dans un nouveau monde"}</button></div>
        </div>
      )}
      {error && <ErrorBox error={error} />}
    </div>
  );
}
