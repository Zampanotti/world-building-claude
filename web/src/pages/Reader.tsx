import { api } from "../api.ts";
import { useLoad, Loading, ErrorBox } from "../ui.tsx";
import { RichText } from "../richtext.tsx";

type PubList = { world: { name: string; description: string }; items: { id: number; name: string; summary: string; type: { name: string; color: string } | null; imageId: number | null }[] };
type PubEntity = {
  name: string; summary: string; description: string; type: { name: string; color: string } | null; imageId: number | null; timeLabel: string | null; publishedAt: string;
  properties: { name: string; kind: string; value: unknown }[]; tags: { name: string }[]; publishedNames: Record<number, string>;
};

/**
 * Lecture publique : n'affiche QUE les instantanés publiés, jamais l'état de
 * travail. Les liens vers des fiches non publiées sont rendus en simple texte.
 */
export function Reader({ wid, id }: { wid: number; id: number | null }) {
  const list = useLoad(() => api<PubList>("GET", `/api/public/${wid}`), [wid]);
  const ent = useLoad(() => (id ? api<PubEntity>("GET", `/api/public/${wid}/entities/${id}`) : Promise.resolve(null)), [wid, id]);
  if (list.error) return <div className="reader"><ErrorBox error={list.error} /></div>;
  if (!list.data) return <div className="reader"><Loading /></div>;
  const img = (mid: number) => `/api/public/${wid}/media/${mid}`;
  return (
    <div className="reader stack">
      <div className="row between small"><a href={`#/read/${wid}`}>📖 {list.data.world.name}</a><a href={`#/w/${wid}`} className="muted">Retour à l'atelier</a></div>
      {!id && (
        <>
          <h1>{list.data.world.name}</h1>
          {list.data.world.description && <p className="muted">{list.data.world.description}</p>}
          <p className="muted small">Vue lecteur : seules les fiches explicitement publiées apparaissent, dans leur version publiée.</p>
          {list.data.items.length === 0 && <div className="empty card">Aucune fiche publiée. Utilisez « Publier » sur une fiche.</div>}
          <div className="grid-cards">{list.data.items.map((e) => (
            <a key={e.id} className="card" href={`#/read/${wid}/${e.id}`} style={{ color: "inherit", textDecoration: "none" }}>
              {e.imageId && <img src={img(e.imageId)} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />}
              <strong>{e.name}</strong><div className="muted small">{e.type?.name}</div>{e.summary && <div className="small">{e.summary}</div>}
            </a>
          ))}</div>
        </>
      )}
      {id && ent.error && <ErrorBox error={ent.error} />}
      {id && ent.data && (
        <article className="entity-grid">
          <div>
            <h1>{ent.data.name}</h1>
            {ent.data.summary && <p style={{ fontStyle: "italic" }}>{ent.data.summary}</p>}
            <RichText text={ent.data.description} names={ent.data.publishedNames} href={(rid) => `#/read/${wid}/${rid}`} />
            <p className="muted small">Publiée le {new Date(ent.data.publishedAt + "Z").toLocaleString("fr-FR")}</p>
          </div>
          <aside className="infobox">
            <div className="title" style={{ borderTop: `4px solid ${ent.data.type?.color ?? "var(--border)"}` }}>{ent.data.name}</div>
            {ent.data.imageId && <img src={img(ent.data.imageId)} alt={ent.data.name} />}
            <dl>
              {ent.data.type && <><dt>Type</dt><dd>{ent.data.type.name}</dd></>}
              {ent.data.timeLabel && <><dt>Date</dt><dd>{ent.data.timeLabel}</dd></>}
              {ent.data.properties.map((p) => (
                <span key={p.name} style={{ display: "contents" }}><dt>{p.name}</dt><dd>{p.kind === "boolean" ? (p.value ? "Oui" : "Non")
                  : p.kind === "entity" ? (() => { const v = p.value as { id: number; name: string | null }; return ent.data!.publishedNames[v.id] ? <a href={`#/read/${wid}/${v.id}`}>{ent.data!.publishedNames[v.id]}</a> : v.name ?? "—"; })()
                  : String(p.value)}</dd></span>
              ))}
            </dl>
          </aside>
        </article>
      )}
    </div>
  );
}
