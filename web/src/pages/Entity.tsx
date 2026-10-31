import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, w, mediaUrl, ApiError } from "../api.ts";
import { go } from "../router.ts";
import { useLoad, Loading, ErrorBox, TypeBadge, ConfirmButton, Modal, EntityPicker, DatePointEditor, toast } from "../ui.tsx";
import { RichText, RichEditor } from "../richtext.tsx";
import { uploadImage } from "../images.ts";
import type { DatePoint, Era, TimeSpan } from "../../../shared/time.ts";
import { formatPoint } from "../../../shared/time.ts";
import { RelationsPanel } from "./Relations.tsx";

type Def = { id: number; name: string; kind: string; archived: boolean };
export type EntityFull = {
  id: number; name: string; summary: string; description: string; revision: number; typeId: number | null; updatedAt: string;
  type: { id: number; name: string; color: string } | null;
  properties: { def: Def; value: unknown }[]; hiddenValues: number;
  tags: { id: number; name: string; color: string }[];
  images: { mediaId: number; name: string; width: number; height: number; caption: string; position: number }[];
  timeSpan: TimeSpan | null; timeLabel: string | null; timeProblems: string[];
  ownMap: { id: number; name: string } | null; pins: { pinId: number; mapId: number; mapName: string }[];
  names: Record<number, { name: string; typeColor: string | null }>;
  publication: { publishedAt: string; upToDate: boolean } | null;
};

const draftKey = (wid: number, id: number) => `wb-draft-entity-${wid}-${id}`;

export function EntityPage({ wid, id }: { wid: number; id: number }) {
  const [e, setE] = useState<EntityFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const rev = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [eras, setEras] = useState<Era[]>([]);
  const [types, setTypes] = useState<{ id: number; name: string; color: string }[]>([]);

  const apply = (x: EntityFull) => { rev.current = x.revision; setE(x); };
  const load = () => api<EntityFull>("GET", w(wid, `/entities/${id}`)).then(apply, (err: Error) => setError(err.message));
  useEffect(() => {
    load();
    api<Era[]>("GET", w(wid, "/eras")).then(setEras).catch(() => {});
    api<typeof types>("GET", w(wid, "/types")).then(setTypes).catch(() => {});
  }, [wid, id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Toutes les écritures passent par une file : chacune part avec la révision
   * renvoyée par la précédente, donc des modifications rapprochées ne se
   * bloquent pas entre elles. Un 409 signale une modification faite ailleurs.
   */
  const enqueue = <T,>(fn: () => Promise<T>) => {
    const p = queue.current.then(fn);
    queue.current = p.catch(() => {});
    return p;
  };
  const save = (patch: Record<string, unknown>) => enqueue(async () => {
    setStatus("Enregistrement…");
    try {
      apply(await api<EntityFull>("PATCH", w(wid, `/entities/${id}`), { ...patch, expectedRevision: rev.current }));
      setStatus("Enregistré ✓");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      setStatus(`Non enregistré : ${(err as Error).message}`);
      return false;
    }
  });
  const act = (fn: () => Promise<unknown>) => enqueue(async () => {
    try { await fn(); } catch (err) { toast((err as Error).message); }
    await load();
  });

  if (error) return <ErrorBox error={error} retry={() => { setError(null); load(); }} />;
  if (!e) return <Loading />;
  const href = (rid: number) => `#/w/${wid}/entities/${rid}`;
  const names = Object.fromEntries(Object.entries(e.names).map(([k, v]) => [k, v.name]));
  const main = e.images[0];

  return (
    <div className="stack">
      {conflict && <div className="warn row between"><span>Cette fiche a été modifiée dans un autre onglet. Rechargez pour voir la dernière version (votre texte en cours reste dans un brouillon local).</span><button className="btn small" onClick={() => location.reload()}>Recharger</button></div>}
      <Header wid={wid} e={e} types={types} save={save} act={act} status={status} />
      <div className="entity-grid">
        <div className="stack" style={{ minWidth: 0 }}>
          <Description wid={wid} e={e} names={names} save={save} href={href} />
          <Properties wid={wid} e={e} eras={eras} save={save} />
          <Dates e={e} eras={eras} save={save} wid={wid} />
          <Images wid={wid} e={e} act={act} />
          <RelationsPanel wid={wid} entityId={e.id} entityName={e.name} />
          <OnMaps wid={wid} e={e} />
          <Mentions wid={wid} id={e.id} />
        </div>
        <aside className="infobox">
          <div className="title" style={{ borderTop: `4px solid ${e.type?.color ?? "var(--border)"}` }}>{e.name}</div>
          {main && <img src={mediaUrl(wid, main.mediaId)} alt={main.caption || e.name} />}
          {main?.caption && <div className="muted small" style={{ textAlign: "center", padding: ".3rem .6rem 0" }}>{main.caption}</div>}
          <dl>
            <dt>Type</dt><dd>{e.type?.name ?? "—"}</dd>
            {e.timeLabel && <><dt>Date</dt><dd>{e.timeLabel}</dd></>}
            {e.properties.filter((p) => !p.def.archived && p.value !== null).map((p) => (
              <InfoRow key={p.def.id} label={p.def.name}>{displayValue(p.def.kind, p.value, eras, e.names, href)}</InfoRow>
            ))}
            {e.tags.length > 0 && <><dt>Étiquettes</dt><dd>{e.tags.map((t) => t.name).join(", ")}</dd></>}
            {e.ownMap && <><dt>Carte</dt><dd><a href={`#/w/${wid}/maps/${e.ownMap.id}`}>Voir la carte</a></dd></>}
          </dl>
        </aside>
      </div>
    </div>
  );
}

const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => <><dt>{label}</dt><dd>{children}</dd></>;

function displayValue(kind: string, v: unknown, eras: Era[], names: EntityFull["names"], href: (id: number) => string): ReactNode {
  if (v === null || v === undefined) return "—";
  switch (kind) {
    case "boolean": return v ? "Oui" : "Non";
    case "number": return (v as number).toLocaleString("fr-FR");
    case "date": return formatPoint(v as DatePoint, eras);
    case "entity": return names[v as number] ? <a href={href(v as number)}>{names[v as number].name}</a> : <span className="elink broken">fiche supprimée</span>;
    default: return String(v);
  }
}

type SaveFn = (patch: Record<string, unknown>) => Promise<boolean>;
type ActFn = (fn: () => Promise<unknown>) => Promise<void>;

function Header({ wid, e, types, save, act, status }: { wid: number; e: EntityFull; types: { id: number; name: string; color: string }[]; save: SaveFn; act: ActFn; status: string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e.name);
  const [allTags, setAllTags] = useState<{ id: number; name: string; color: string }[]>([]);
  const [tagEdit, setTagEdit] = useState(false);
  const [newTag, setNewTag] = useState("");
  useEffect(() => { if (tagEdit) api("GET", w(wid, "/tags")).then(setAllTags).catch(() => {}); }, [tagEdit, wid]);
  const tagIds = e.tags.map((t) => t.id);
  return (
    <div className="stack" style={{ gap: ".4rem" }}>
      <div className="row between">
        <a href={`#/w/${wid}/entities`} className="small" onClick={(ev) => { if (history.length > 1) { ev.preventDefault(); history.back(); } }}>← Retour</a>
        <span className="status" aria-live="polite">{status}</span>
      </div>
      <div className="topbar" style={{ marginBottom: 0 }}>
        {editing ? (
          <form className="row grow" onSubmit={async (ev) => { ev.preventDefault(); if (await save({ name })) setEditing(false); }}>
            <input className="grow title-input" value={name} onChange={(ev) => setName(ev.target.value)} autoFocus aria-label="Nom de la fiche" />
            <button className="btn primary small">Renommer</button><button type="button" className="btn small" onClick={() => { setEditing(false); setName(e.name); }}>Annuler</button>
          </form>
        ) : (
          <>
            <h1 style={{ cursor: "text" }} onClick={() => setEditing(true)} title="Cliquer pour renommer">{e.name}</h1>
            <button className="btn ghost small" onClick={() => setEditing(true)}>✎ Renommer</button>
          </>
        )}
      </div>
      <div className="row">
        <select value={e.typeId ?? ""} aria-label="Type de la fiche" onChange={(ev) => save({ typeId: ev.target.value ? Number(ev.target.value) : null })}>
          <option value="">Sans type</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {e.tags.map((t) => <span key={t.id} className="badge"><span className="dot" style={{ background: t.color }} />{t.name}</span>)}
        <button className="btn small" onClick={() => setTagEdit(true)}>🏷 Étiquettes</button>
        <span className="grow" />
        {e.publication ? (
          <>
            <span className="badge" title={`Publiée le ${e.publication.publishedAt}`}>{e.publication.upToDate ? "📖 Publiée" : "📖 Publiée (version antérieure)"}</span>
            {!e.publication.upToDate && <button className="btn small" onClick={() => act(() => api("POST", w(wid, `/entities/${e.id}/publish`)).then(() => toast("Nouvelle version publiée.")))}>Republier</button>}
            <a className="btn small" href={`#/read/${wid}/${e.id}`}>Voir</a>
            <button className="btn small" onClick={() => act(() => api("DELETE", w(wid, `/entities/${e.id}/publish`)))}>Dépublier</button>
          </>
        ) : <button className="btn small" onClick={() => act(() => api("POST", w(wid, `/entities/${e.id}/publish`)).then(() => toast("Fiche publiée pour les lecteurs.")))} title="Fige une copie lisible par les lecteurs">Publier</button>}
        <ConfirmButton label="Supprimer…" title="Supprimer la fiche ?" confirmLabel="Supprimer"
          message={<p>« {e.name} » sera supprimée avec ses relations et épingles. Les textes qui la citent sont conservés : leurs liens apparaîtront comme cassés.</p>}
          onConfirm={async () => { await api("DELETE", w(wid, `/entities/${e.id}`)); toast("Fiche supprimée."); go(`/w/${wid}/entities`); }} />
      </div>
      {e.hiddenValues > 0 && <p className="muted small">{e.hiddenValues} valeur(s) d'un type précédent sont conservées mais masquées ; elles réapparaîtront si vous remettez ce type.</p>}
      {tagEdit && (
        <Modal title="Étiquettes" onClose={() => setTagEdit(false)}>
          <div className="stack">
            <div className="row">{allTags.map((t) => (
              <button key={t.id} className={`badge tag-chip ${tagIds.includes(t.id) ? "on" : ""}`}
                onClick={() => save({ tagIds: tagIds.includes(t.id) ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id] })}>
                <span className="dot" style={{ background: t.color }} />{t.name}</button>
            ))}{allTags.length === 0 && <span className="muted small">Aucune étiquette dans ce monde.</span>}</div>
            <form className="row" onSubmit={async (ev) => {
              ev.preventDefault();
              const r = await api<{ id: number }>("POST", w(wid, "/tags"), { name: newTag });
              setNewTag(""); await save({ tagIds: [...new Set([...tagIds, r.id])] });
              setAllTags(await api("GET", w(wid, "/tags")));
            }}>
              <input className="grow" value={newTag} onChange={(ev) => setNewTag(ev.target.value)} placeholder="Nouvelle étiquette" />
              <button className="btn" disabled={!newTag.trim()}>Ajouter</button>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Description({ wid, e, names, save, href }: { wid: number; e: EntityFull; names: Record<number, string>; save: SaveFn; href: (id: number) => string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.description);
  const [summary, setSummary] = useState(e.summary);
  const [localNames, setLocalNames] = useState(names);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<string | null>(null);
  const [draft, setDraft] = useState<string | null>(() => {
    try { const d = localStorage.getItem(draftKey(wid, e.id)); return d && d !== e.description ? d : null; } catch { return null; }
  });
  // Autosauvegarde : brouillon local immédiat, envoi au serveur après une pause.
  const flush = async () => {
    clearTimeout(timer.current);
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    if (await save({ description: v })) { try { localStorage.removeItem(draftKey(wid, e.id)); } catch { /* stockage indisponible */ } }
  };
  useEffect(() => () => { void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => {
    setText(v);
    pending.current = v;
    try { localStorage.setItem(draftKey(wid, e.id), v); } catch { /* stockage indisponible */ }
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  };
  return (
    <section className="card">
      {draft !== null && (
        <div className="warn row between" style={{ marginBottom: ".8rem" }}>
          <span>Un brouillon local non enregistré existe pour cette description.</span>
          <span className="row"><button className="btn small" onClick={() => { setText(draft); setEditing(true); change(draft); setDraft(null); }}>Restaurer</button>
            <button className="btn small" onClick={() => { try { localStorage.removeItem(draftKey(wid, e.id)); } catch { /* */ } setDraft(null); }}>Ignorer</button></span>
        </div>
      )}
      <div className="section-title"><h2>Description</h2>
        <button className="btn small" onClick={async () => { if (editing) { await flush(); if (summary !== e.summary) await save({ summary }); } else { setText(e.description); setSummary(e.summary); setLocalNames(names); } setEditing(!editing); }}>{editing ? "Terminer" : "✎ Modifier"}</button>
      </div>
      {editing ? (
        <div className="stack">
          <label>Résumé (une phrase, affichée dans les listes)<input value={summary} onChange={(ev) => setSummary(ev.target.value)} onBlur={() => summary !== e.summary && save({ summary })} maxLength={500} /></label>
          <RichEditor wid={wid} value={text} onChange={change} names={localNames} onNames={setLocalNames} />
        </div>
      ) : (
        <>
          {e.summary && <p style={{ fontStyle: "italic" }}>{e.summary}</p>}
          <RichText text={e.description} names={names} href={href} />
        </>
      )}
    </section>
  );
}

function PropertyField({ wid, def, value, eras, names, save }: { wid: number; def: Def; value: unknown; eras: Era[]; names: EntityFull["names"]; save: SaveFn }) {
  const [v, setV] = useState<unknown>(value);
  const commit = (nv: unknown) => { if (JSON.stringify(nv) !== JSON.stringify(value)) save({ properties: { [def.id]: nv === "" ? null : nv } }); };
  let input: ReactNode;
  switch (def.kind) {
    case "longtext": input = <textarea rows={3} value={(v as string) ?? ""} onChange={(e) => setV(e.target.value)} onBlur={() => commit(v)} />; break;
    case "number": input = <input type="text" inputMode="decimal" value={v === null || v === undefined ? "" : String(v)} onChange={(e) => setV(e.target.value)} onBlur={() => commit(v === "" ? null : v)} />; break;
    case "boolean": input = (
      <select value={v === null || v === undefined ? "" : v ? "1" : "0"} onChange={(e) => { const nv = e.target.value === "" ? null : e.target.value === "1"; setV(nv); commit(nv); }}>
        <option value="">—</option><option value="1">Oui</option><option value="0">Non</option>
      </select>); break;
    case "date": input = (
      <div className="row">
        {v ? <DatePointEditor eras={eras} value={v as DatePoint} onChange={(d) => setV(d)} /> : <button className="btn small" onClick={() => setV({ eraId: eras[0]?.id, year: 1, month: null, day: null, approx: false })}>Ajouter une date</button>}
        {v !== null && v !== undefined && <><button className="btn small primary" onClick={() => commit(v)}>OK</button><button className="btn small" onClick={() => { setV(null); commit(null); }}>Effacer</button></>}
      </div>); break;
    case "entity": input = (
      <div className="row">
        {v ? (names[v as number] ? <a href={`#/w/${wid}/entities/${v}`}>{names[v as number].name}</a> : <span className="elink broken">fiche supprimée</span>) : null}
        <div className="grow" style={{ minWidth: 180 }}><EntityPicker wid={wid} allowCreate placeholder={v ? "Changer…" : "Choisir une fiche…"} onPick={(s) => { setV(s.id); commit(s.id); }} /></div>
        {v ? <button className="btn small" onClick={() => { setV(null); commit(null); }}>Retirer</button> : null}
      </div>); break;
    default: input = <input value={(v as string) ?? ""} onChange={(e) => setV(e.target.value)} onBlur={() => commit(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
  }
  return <div className="prop-row"><span>{def.name}{def.archived && <span className="muted small"> (archivée)</span>}</span>{input}</div>;
}

function Properties({ wid, e, eras, save }: { wid: number; e: EntityFull; eras: Era[]; save: SaveFn }) {
  if (!e.type) return null;
  return (
    <section className="card">
      <div className="section-title"><h2>Propriétés</h2><a className="small" href={`#/w/${wid}/types`}>Gérer les propriétés du type « {e.type.name} »</a></div>
      {e.properties.length === 0 ? <p className="muted small">Ce type n'a pas encore de propriété.</p>
        : e.properties.map((p) => <PropertyField key={p.def.id} wid={wid} def={p.def} value={p.value} eras={eras} names={e.names} save={save} />)}
    </section>
  );
}

function Dates({ e, eras, save, wid }: { e: EntityFull; eras: Era[]; save: SaveFn; wid: number }) {
  const [edit, setEdit] = useState(false);
  const [span, setSpan] = useState<TimeSpan | null>(e.timeSpan);
  const blank = (): DatePoint => ({ eraId: eras[0]?.id ?? 0, year: 1, month: null, day: null, approx: false });
  return (
    <section className="card">
      <div className="section-title"><h2>Dates</h2>
        {!edit && <button className="btn small" onClick={() => { setSpan(e.timeSpan ?? { start: blank(), end: null }); setEdit(true); }}>{e.timeSpan ? "✎ Modifier" : "＋ Dater"}</button>}
      </div>
      {!edit && (e.timeLabel ? <p>{e.timeLabel} · <a href={`#/w/${wid}/chronology`} className="small">voir la chronologie</a></p> : <p className="muted small">Aucune date. Une date ou une période place la fiche sur la frise chronologique.</p>)}
      {!edit && e.timeProblems.map((p) => <div key={p} className="warn small">⚠ {p}</div>)}
      {edit && span && (
        <div className="stack">
          <div><div className="muted small">Début (ou date unique)</div><DatePointEditor eras={eras} value={span.start} onChange={(d) => setSpan({ ...span, start: d! })} /></div>
          {span.end ? <div><div className="muted small">Fin</div><div className="row"><DatePointEditor eras={eras} value={span.end} onChange={(d) => setSpan({ ...span, end: d })} /><button className="btn small" onClick={() => setSpan({ ...span, end: null })}>Sans fin</button></div></div>
            : <button className="btn small" style={{ justifySelf: "start" }} onClick={() => setSpan({ ...span, end: blank() })}>＋ Ajouter une fin (période)</button>}
          <div className="row end">
            {e.timeSpan && <button className="btn small danger" onClick={async () => { if (await save({ timeSpan: null })) setEdit(false); }}>Retirer la date</button>}
            <button className="btn small" onClick={() => setEdit(false)}>Annuler</button>
            <button className="btn small primary" onClick={async () => { if (await save({ timeSpan: span })) setEdit(false); }}>Enregistrer</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Images({ wid, e, act }: { wid: number; e: EntityFull; act: ActFn }) {
  const [open, setOpen] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const img = open === null ? null : e.images.find((i) => i.mediaId === open) ?? null;
  const [caption, setCaption] = useState("");
  const order = e.images.map((i) => i.mediaId);
  const move = (mid: number, to: number) => {
    const next = order.filter((x) => x !== mid);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, mid);
    return act(() => api("PUT", w(wid, `/entities/${e.id}/images`), { order: next }));
  };
  return (
    <section className="card">
      <div className="section-title"><h2>Images</h2>
        <div className="row">
          <button className="btn small" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Envoi…" : "＋ Depuis l'ordinateur"}</button>
          <button className="btn small" onClick={() => setPicker(true)}>Choisir dans la médiathèque</button>
        </div>
      </div>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={async (ev) => {
        const files = [...(ev.target.files ?? [])];
        ev.target.value = "";
        setBusy(true);
        for (const f of files) {
          await act(async () => {
            const m = await uploadImage(wid, f);
            await api("POST", w(wid, `/entities/${e.id}/images`), { mediaId: m.id, caption: "" }).catch((err: ApiError) => { if (err.status !== 409) throw err; });
          });
        }
        setBusy(false);
      }} />
      {e.images.length === 0 ? <p className="muted small">Aucune image. La première image devient l'image principale de l'encadré (idéalement un carré de 800 à 1000 pixels).</p> : (
        <div className="gallery">{e.images.map((i, n) => (
          <figure key={i.mediaId}>
            <img src={mediaUrl(wid, i.mediaId)} alt={i.caption || i.name} loading="lazy" onClick={() => { setOpen(i.mediaId); setCaption(i.caption); }} />
            <figcaption>{n === 0 ? "★ " : ""}{i.caption || <span className="muted">{i.name}</span>}</figcaption>
          </figure>
        ))}</div>
      )}
      {img && (
        <Modal title={img.caption || img.name} onClose={() => setOpen(null)}>
          <div className="stack">
            <img className="lightbox" style={{ maxWidth: "100%" }} src={mediaUrl(wid, img.mediaId)} alt={img.caption || img.name} />
            <span className="muted small">{img.width} × {img.height} px{img.width !== img.height ? " — non carrée : recadrée au centre dans l'encadré" : ""}</span>
            <form className="row" onSubmit={(ev) => { ev.preventDefault(); act(() => api("PATCH", w(wid, `/entities/${e.id}/images/${img.mediaId}`), { caption })); }}>
              <input className="grow" value={caption} onChange={(ev) => setCaption(ev.target.value)} placeholder="Légende" />
              <button className="btn">Enregistrer la légende</button>
            </form>
            <div className="row">
              <button className="btn small" disabled={order[0] === img.mediaId} onClick={() => move(img.mediaId, 0)}>★ Image principale</button>
              <button className="btn small" disabled={order[0] === img.mediaId} onClick={() => move(img.mediaId, order.indexOf(img.mediaId) - 1)}>← Avant</button>
              <button className="btn small" disabled={order[order.length - 1] === img.mediaId} onClick={() => move(img.mediaId, order.indexOf(img.mediaId) + 1)}>Après →</button>
              <span className="grow" />
              <ConfirmButton label="Retirer de la fiche…" title="Retirer l'image ?" message={<p>L'image reste dans la médiathèque du monde.</p>}
                onConfirm={async () => { setOpen(null); await act(() => api("DELETE", w(wid, `/entities/${e.id}/images/${img.mediaId}`))); }} />
            </div>
          </div>
        </Modal>
      )}
      {picker && <MediaPickerModal wid={wid} exclude={order} onClose={() => setPicker(false)} onPick={(mid) => { setPicker(false); act(() => api("POST", w(wid, `/entities/${e.id}/images`), { mediaId: mid })); }} />}
    </section>
  );
}

export function MediaPickerModal({ wid, exclude = [], onPick, onClose }: { wid: number; exclude?: number[]; onPick: (id: number) => void; onClose: () => void }) {
  const media = useLoad(() => api<{ id: number; name: string }[]>("GET", w(wid, "/media")), [wid]);
  return (
    <Modal title="Choisir dans la médiathèque" onClose={onClose}>
      {media.error && <ErrorBox error={media.error} retry={media.reload} />}
      {media.data && media.data.length === 0 && <p className="muted">La médiathèque est vide.</p>}
      <div className="gallery">{media.data?.filter((m) => !exclude.includes(m.id)).map((m) => (
        <figure key={m.id}><img src={mediaUrl(wid, m.id)} alt={m.name} onClick={() => onPick(m.id)} style={{ cursor: "pointer" }} /><figcaption>{m.name}</figcaption></figure>
      ))}</div>
    </Modal>
  );
}

function OnMaps({ wid, e }: { wid: number; e: EntityFull }) {
  const [choose, setChoose] = useState(false);
  const maps = useLoad(() => (choose ? api<{ id: number; name: string }[]>("GET", w(wid, "/maps")) : Promise.resolve([])), [choose, wid]);
  return (
    <section className="card">
      <div className="section-title"><h2>Sur les cartes</h2><button className="btn small" onClick={() => setChoose(true)}>📍 Situer sur {e.pins.length ? "une autre " : "une "}carte</button></div>
      {e.ownMap && <p>Carte de cette fiche : <a href={`#/w/${wid}/maps/${e.ownMap.id}`}>{e.ownMap.name}</a></p>}
      {e.pins.length ? <ul className="rel-list">{e.pins.map((p) => <li key={p.pinId}>📍 <a href={`#/w/${wid}/maps/${p.mapId}?pin=${p.pinId}`}>{p.mapName}</a></li>)}</ul>
        : !e.ownMap && <p className="muted small">Cette fiche n'est épinglée sur aucune carte.</p>}
      {choose && (
        <Modal title="Situer sur une carte" onClose={() => setChoose(false)}>
          {maps.data?.length === 0 && <p className="muted">Aucune carte. <a href={`#/w/${wid}/maps`}>Créer une carte</a></p>}
          <ul className="rel-list">{maps.data?.map((m) => <li key={m.id}><a href={`#/w/${wid}/maps/${m.id}?placer=${e.id}`}>{m.name}</a></li>)}</ul>
        </Modal>
      )}
    </section>
  );
}

type Mention = { excerpts: { before: string; match: string; after: string }[]; total: number };
function Mentions({ wid, id }: { wid: number; id: number }) {
  const m = useLoad(() => api<{ sections: (Mention & { id: number; title: string; documentId: number; documentTitle: string; path: string[] })[]; entities: (Mention & { id: number; name: string })[] }>("GET", w(wid, `/entities/${id}/mentions`)), [wid, id]);
  const Ex = ({ x }: { x: Mention }) => <>{x.excerpts.map((ex, i) => <div key={i} className="small muted">{ex.before}<mark>{ex.match}</mark>{ex.after}</div>)}{x.total > x.excerpts.length && <div className="small muted">… et {x.total - x.excerpts.length} passage(s) de plus</div>}</>;
  return (
    <section className="card">
      <h2>Citée dans l'écriture</h2>
      {m.error && <ErrorBox error={m.error} retry={m.reload} />}
      {m.data && m.data.sections.length === 0 && m.data.entities.length === 0 && <p className="muted small">Aucun texte ne contient de lien vers cette fiche.</p>}
      <div className="stack">
        {m.data?.sections.map((s) => (
          <div key={s.id}><a href={`#/w/${wid}/documents/${s.documentId}?section=${s.id}`}>✒️ {[s.documentTitle, ...s.path, s.title].join(" › ")}</a><Ex x={s} /></div>
        ))}
        {m.data?.entities.map((s) => (
          <div key={s.id}><a href={`#/w/${wid}/entities/${s.id}`}>📇 {s.name}</a><Ex x={s} /></div>
        ))}
      </div>
    </section>
  );
}
