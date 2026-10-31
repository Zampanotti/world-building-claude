import { useEffect, useRef, useState } from "react";
import { api, w, ApiError } from "../api.ts";
import { go } from "../router.ts";
import { useLoad, Loading, ErrorBox, ConfirmButton, toast } from "../ui.tsx";
import { RichEditor, RichText } from "../richtext.tsx";

type Sec = { id: number; parentId: number | null; title: string; position: number; words: number };
type Doc = { id: number; title: string; sections: Sec[] };

export function Writing({ wid, docId, query }: { wid: number; docId: number | null; query: URLSearchParams }) {
  const docs = useLoad(() => api<Doc[]>("GET", w(wid, "/documents")), [wid]);
  const [title, setTitle] = useState("");
  if (docs.error) return <ErrorBox error={docs.error} retry={docs.reload} />;
  if (!docs.data) return <Loading />;
  const doc = docId ? docs.data.find((d) => d.id === docId) : null;
  if (docId && !doc) return <ErrorBox error="Document introuvable dans ce monde." />;
  if (!doc) {
    return (
      <div className="stack">
        <h1>Textes</h1>
        <form className="card row" onSubmit={async (e) => { e.preventDefault(); const r = await api<{ id: number; sectionId: number }>("POST", w(wid, "/documents"), { title }); go(`/w/${wid}/documents/${r.id}?section=${r.sectionId}`); }}>
          <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre d'un nouveau document (roman, nouvelle, notes…)" />
          <button className="btn primary" disabled={!title.trim()}>Créer</button>
        </form>
        {docs.data.length === 0 && <div className="empty card">Aucun document. Les textes peuvent contenir des liens vers les fiches : tapez [[ en écrivant.</div>}
        <div className="grid-cards">{docs.data.map((d) => (
          <a key={d.id} className="card" href={`#/w/${wid}/documents/${d.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            <h2 style={{ fontFamily: "var(--serif)" }}>{d.title}</h2>
            <span className="muted small">{d.sections.length} section(s) · {d.sections.reduce((n, s) => n + Number(s.words), 0).toLocaleString("fr-FR")} mots</span>
          </a>
        ))}</div>
      </div>
    );
  }
  const sid = Number(query.get("section")) || null;
  return <DocumentView key={doc.id} wid={wid} doc={doc} sid={sid} reload={docs.reload} />;
}

function DocumentView({ wid, doc, sid, reload }: { wid: number; doc: Doc; sid: number | null; reload: () => void }) {
  const [mode, setMode] = useState<"edit" | "read">(sid ? "edit" : "read");
  // Un lien vers une section (recherche, citations…) l'ouvre en édition, même depuis la lecture continue.
  useEffect(() => { if (sid) setMode("edit"); }, [sid]);
  const [newTitle, setNewTitle] = useState("");
  const children = (p: number | null) => doc.sections.filter((s) => s.parentId === p).sort((a, b) => a.position - b.position);
  const open = (id: number) => { setMode("edit"); go(`/w/${wid}/documents/${doc.id}?section=${id}`); };
  const move = async (id: number, direction: string) => {
    try { await api("POST", w(wid, `/sections/${id}/move`), { direction }); reload(); } catch (e) { toast((e as Error).message); }
  };
  const Tree = ({ parent, depth }: { parent: number | null; depth: number }) => (
    <ul className="tree" style={{ paddingLeft: depth ? ".9rem" : 0 }}>{children(parent).map((s) => (
      <li key={s.id}>
        <div className={`node ${s.id === sid && mode === "edit" ? "active" : ""}`} onClick={() => open(s.id)}>
          <span className="title">{s.title}</span>
          {s.id === sid && mode === "edit" && <span className="row" style={{ gap: 0 }} onClick={(e) => e.stopPropagation()}>
            <button className="btn ghost small" title="Monter" onClick={() => move(s.id, "up")}>↑</button>
            <button className="btn ghost small" title="Descendre" onClick={() => move(s.id, "down")}>↓</button>
            <button className="btn ghost small" title="Ranger sous la précédente" onClick={() => move(s.id, "indent")}>→</button>
            <button className="btn ghost small" title="Remonter d'un niveau" onClick={() => move(s.id, "outdent")}>←</button>
          </span>}
        </div>
        <Tree parent={s.id} depth={depth + 1} />
      </li>
    ))}</ul>
  );
  return (
    <div className="stack">
      <div className="row between">
        <a href={`#/w/${wid}/documents`} className="small">← Tous les documents</a>
        <div className="row">
          <button className={`btn small ${mode === "read" ? "primary" : ""}`} onClick={() => setMode("read")}>📖 Lecture continue</button>
          <ConfirmButton label="Supprimer le document…" title="Supprimer le document ?" message={<p>« {doc.title} » et toutes ses sections seront supprimés définitivement.</p>}
            onConfirm={async () => { await api("DELETE", w(wid, `/documents/${doc.id}`)); go(`/w/${wid}/documents`); reload(); }} />
        </div>
      </div>
      <input className="title-input" style={{ fontSize: "1.9rem" }} defaultValue={doc.title} aria-label="Titre du document"
        onBlur={(e) => e.target.value.trim() && e.target.value !== doc.title && api("PATCH", w(wid, `/documents/${doc.id}`), { title: e.target.value }).then(reload)} />
      <div className="writing">
        <aside className="card">
          <Tree parent={null} depth={0} />
          <form className="row" style={{ marginTop: ".7rem" }} onSubmit={async (e) => {
            e.preventDefault();
            const r = await api<{ id: number }>("POST", w(wid, `/documents/${doc.id}/sections`), { title: newTitle });
            setNewTitle(""); reload(); open(r.id);
          }}>
            <input className="grow" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Nouvelle section" style={{ width: "100%" }} />
            <button className="btn small" disabled={!newTitle.trim()}>＋</button>
          </form>
          {sid && mode === "edit" && <button className="btn ghost small" style={{ marginTop: ".4rem" }} onClick={async () => {
            const t = prompt("Titre de la sous-section");
            if (t?.trim()) { const r = await api<{ id: number }>("POST", w(wid, `/documents/${doc.id}/sections`), { title: t, parentId: sid }); reload(); open(r.id); }
          }}>＋ Sous-section de la section ouverte</button>}
        </aside>
        <div style={{ minWidth: 0 }}>
          {mode === "read" || !sid ? <ContinuousReading wid={wid} docId={doc.id} onOpen={open} />
            : <SectionEditor key={sid} wid={wid} sid={sid} onSaved={reload} onDeleted={() => { reload(); go(`/w/${wid}/documents/${doc.id}`); setMode("read"); }} />}
        </div>
      </div>
    </div>
  );
}

function ContinuousReading({ wid, docId, onOpen }: { wid: number; docId: number; onOpen: (id: number) => void }) {
  const d = useLoad(() => api<{ sections: { id: number; title: string; content: string; depth: number }[]; names: Record<number, string> }>("GET", w(wid, `/documents/${docId}`)), [wid, docId]);
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  return (
    <article className="card">
      {d.data.sections.map((s) => (
        <section key={s.id} style={{ marginBottom: "1.5rem" }}>
          <div className="row between"><h2 style={{ fontFamily: "var(--serif)", fontSize: `${1.5 - s.depth * 0.15}rem` }}>{s.title}</h2><button className="btn ghost small" onClick={() => onOpen(s.id)}>✎</button></div>
          <RichText text={s.content} names={d.data!.names} href={(id) => `#/w/${wid}/entities/${id}`} />
        </section>
      ))}
    </article>
  );
}

type Section = { id: number; title: string; content: string; revision: number; names: Record<number, string> };
type Draft = { title: string; content: string; baseRevision: number; savedAt: number };

/**
 * Éditeur d'une section avec autosauvegarde.
 * - Chaque frappe est copiée dans un brouillon local (navigateur) avant l'envoi.
 * - L'envoi part après une pause d'une seconde, avec la révision attendue :
 *   si la section a changé ailleurs, rien n'est écrasé (409) et le brouillon reste.
 * - Le composant est recréé à chaque changement de section, et une réponse
 *   arrivée après coup n'est jamais affichée dans une autre section.
 */
function SectionEditor({ wid, sid, onSaved, onDeleted }: { wid: number; sid: number; onSaved: () => void; onDeleted: () => void }) {
  const key = `wb-draft-section-${wid}-${sid}`;
  const [sec, setSec] = useState<Section | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [names, setNames] = useState<Record<number, string>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState(false);
  const rev = useRef(0);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ title: "", content: "" });
  const alive = useRef(true);
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    alive.current = true;
    api<Section>("GET", w(wid, `/sections/${sid}`)).then((s) => {
      if (!alive.current) return;
      rev.current = s.revision;
      setSec(s); setTitle(s.title); setContent(s.content); setNames(s.names);
      latest.current = { title: s.title, content: s.content };
      try {
        const d = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
        if (d && (d.content !== s.content || d.title !== s.title)) setDraft(d); else localStorage.removeItem(key);
      } catch { /* stockage indisponible */ }
    }, (e: Error) => alive.current && setError(e.message));
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    addEventListener("beforeunload", warn);
    return () => { alive.current = false; removeEventListener("beforeunload", warn); void flush(); };
  }, [wid, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return saving.current;
    dirty.current = false;
    const body = { ...latest.current };
    saving.current = saving.current.then(async () => {
      if (alive.current) setStatus("Enregistrement…");
      try {
        const s = await api<Section>("PATCH", w(wid, `/sections/${sid}`), { ...body, expectedRevision: rev.current });
        rev.current = s.revision;
        try { const d = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null; if (d && d.content === body.content && d.title === body.title) localStorage.removeItem(key); } catch { /* */ }
        if (alive.current) setStatus(`Enregistré à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
        if (body.title !== sec?.title) onSaved();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) { if (alive.current) setConflict(true); }
        else dirty.current = true; // panne réseau : on réessaiera à la prochaine frappe
        if (alive.current) setStatus(`Non enregistré : ${(e as Error).message} (brouillon local conservé)`);
      }
    });
    return saving.current;
  };
  const change = (patch: Partial<{ title: string; content: string }>) => {
    latest.current = { ...latest.current, ...patch };
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.content !== undefined) setContent(patch.content);
    dirty.current = true;
    setStatus("Modifications en attente…");
    try { localStorage.setItem(key, JSON.stringify({ ...latest.current, baseRevision: rev.current, savedAt: Date.now() } satisfies Draft)); } catch { /* */ }
    clearTimeout(timer.current);
    if (!conflict) timer.current = setTimeout(flush, 1000);
  };

  if (error) return <ErrorBox error={error} />;
  if (!sec) return <Loading />;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  return (
    <div className="card stack">
      {draft && (
        <div className="warn row between">
          <span>Un brouillon local du {new Date(draft.savedAt).toLocaleString("fr-FR")} diffère de la version enregistrée.</span>
          <span className="row">
            <button className="btn small" onClick={() => { change({ title: draft.title, content: draft.content }); setDraft(null); }}>Restaurer le brouillon</button>
            <button className="btn small" onClick={() => { try { localStorage.removeItem(key); } catch { /* */ } setDraft(null); }}>Ignorer</button>
          </span>
        </div>
      )}
      {conflict && <div className="warn row between"><span>Cette section a été modifiée ailleurs : l'enregistrement automatique est suspendu. Votre texte est gardé en brouillon local ; rechargez pour comparer.</span><button className="btn small" onClick={() => location.reload()}>Recharger</button></div>}
      <div className="row between">
        <input className="title-input grow" value={title} onChange={(e) => change({ title: e.target.value })} aria-label="Titre de la section" />
        <ConfirmButton label="Supprimer" title="Supprimer la section ?" message={<p>« {title} » et ses sous-sections seront supprimées définitivement.</p>}
          onConfirm={async () => { clearTimeout(timer.current); dirty.current = false; await api("DELETE", w(wid, `/sections/${sid}`)); try { localStorage.removeItem(key); } catch { /* */ } toast("Section supprimée."); onDeleted(); }} />
      </div>
      <RichEditor wid={wid} value={content} onChange={(v) => change({ content: v })} names={names} onNames={setNames} minHeight={420} />
      <div className="row between status"><span aria-live="polite">{status}</span><span>{words.toLocaleString("fr-FR")} mots</span></div>
    </div>
  );
}
