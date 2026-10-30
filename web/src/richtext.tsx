import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { LINK_RE, linkMarkup } from "../../shared/richtext.ts";
import { api, w } from "./api.ts";
import { EntityPicker, Modal, ErrorBox, toast, type Suggestion } from "./ui.tsx";

type Names = Record<number, string>;

/** Rendu du gras, de l'italique et des liens vers les fiches dans une ligne. */
function inline(text: string, names: Names, href: (id: number) => string | null, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  const fmt = (s: string) => s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, j) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={j}>{part.slice(2, -2)}</strong>
      : part.startsWith("*") && part.endsWith("*") && part.length > 2 ? <em key={j}>{part.slice(1, -1)}</em> : part);
  for (const m of text.matchAll(LINK_RE)) {
    out.push(<Fragment key={`${key}-t${i}`}>{fmt(text.slice(last, m.index))}</Fragment>);
    const id = Number(m[1]);
    const name = names[id];
    const h = name !== undefined ? href(id) : null;
    out.push(name === undefined
      ? <span key={`${key}-l${i}`} className="elink broken" title="Lien cassé : la fiche n'existe plus (ou n'est pas publiée)">{m[2]}</span>
      : h ? <a key={`${key}-l${i}`} className="elink" href={h}>{name}</a> : <span key={`${key}-l${i}`}>{name}</span>);
    last = m.index! + m[0].length;
    i++;
  }
  out.push(<Fragment key={`${key}-end`}>{fmt(text.slice(last))}</Fragment>);
  return out;
}

/**
 * Affiche un texte éditorial. Les liens montrent le NOM ACTUEL de la fiche
 * (renommage suivi) ; un lien vers une fiche disparue reste visible, barré.
 */
export function RichText({ text, names, href }: { text: string; names: Names; href: (id: number) => string | null }) {
  if (!text.trim()) return <p className="muted">Rien d'écrit pour l'instant.</p>;
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) { const k = `p${blocks.length}`; blocks.push(<p key={k}>{para.flatMap((l, i) => [...(i ? [<br key={`${k}br${i}`} />] : []), ...inline(l, names, href, `${k}-${i}`)])}</p>); para = []; }
    if (list.length) { const k = `u${blocks.length}`; blocks.push(<ul key={k}>{list.map((l, i) => <li key={i}>{inline(l, names, href, `${k}-${i}`)}</li>)}</ul>); list = []; }
  };
  lines.forEach((line, i) => {
    const k = `b${i}`;
    if (!line.trim()) return flush();
    if (line.startsWith("## ")) { flush(); blocks.push(<h4 key={k}>{inline(line.slice(3), names, href, k)}</h4>); }
    else if (line.startsWith("# ")) { flush(); blocks.push(<h3 key={k}>{inline(line.slice(2), names, href, k)}</h3>); }
    else if (line.startsWith("> ")) { flush(); blocks.push(<blockquote key={k}>{inline(line.slice(2), names, href, k)}</blockquote>); }
    else if (line.startsWith("- ")) { if (para.length) { const l = list; list = []; flush(); list = l; } list.push(line.slice(2)); }
    else { if (list.length) { const p = para; para = []; flush(); para = p; } para.push(line); }
  });
  flush();
  return <div className="prose">{blocks}</div>;
}

type TypeOpt = { id: number; name: string };

/**
 * Éditeur du texte éditorial : une zone de texte avec barre d'outils.
 * - « [[ » ouvre la recherche de fiches et insère un lien stable (identifiant) ;
 * - « Créer une fiche » transforme la sélection en nouvelle fiche liée.
 */
export function RichEditor({ wid, value, onChange, names, onNames, minHeight = 260, placeholder }:
  { wid: number; value: string; onChange: (v: string) => void; names: Names; onNames: (n: Names) => void; minHeight?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [ac, setAc] = useState<{ q: string; start: number } | null>(null);
  const [acItems, setAcItems] = useState<Suggestion[]>([]);
  const [acSel, setAcSel] = useState(0);
  const [modal, setModal] = useState<null | { kind: "link" | "create"; start: number; end: number; text: string }>(null);

  useEffect(() => {
    if (!ac) return;
    let live = true;
    api<Suggestion[]>("GET", w(wid, `/entities/suggest?q=${encodeURIComponent(ac.q)}`)).then((r) => { if (live) { setAcItems(r); setAcSel(0); } }).catch(() => {});
    return () => { live = false; };
  }, [ac?.q, wid]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (start: number, end: number, insert: string) => {
    const next = value.slice(0, start) + insert + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => { const t = ref.current; if (t) { t.focus(); t.selectionStart = t.selectionEnd = start + insert.length; } });
  };
  const insertLink = (s: { id: number; name: string }, start: number, end: number, label?: string) => {
    onNames({ ...names, [s.id]: s.name });
    replace(start, end, linkMarkup(s.id, label || s.name));
  };
  const detectAc = () => {
    const t = ref.current!;
    // Lu dans la zone de texte elle-même : l'état React peut avoir une frappe de retard.
    const before = t.value.slice(0, t.selectionStart);
    const m = before.match(/\[\[([^[\]|\n]{0,40})$/);
    setAc(m ? { q: m[1], start: t.selectionStart - m[0].length } : null);
  };
  const wrap = (mark: string) => {
    const t = ref.current!;
    const { selectionStart: a, selectionEnd: b } = t;
    replace(a, b, mark + (value.slice(a, b) || "texte") + mark);
  };
  const linePrefix = (prefix: string) => {
    const t = ref.current!;
    const a = value.lastIndexOf("\n", t.selectionStart - 1) + 1;
    onChange(value.slice(0, a) + prefix + value.slice(a));
  };
  const openModal = (kind: "link" | "create") => {
    const t = ref.current!;
    const text = value.slice(t.selectionStart, t.selectionEnd);
    if (kind === "create" && !text.trim()) { toast("Sélectionnez d'abord le nom de la fiche dans le texte."); return; }
    setModal({ kind, start: t.selectionStart, end: t.selectionEnd, text });
  };

  return (
    <div className="editor">
      <div className="toolbar">
        <button className="btn small" type="button" onClick={() => wrap("**")} title="Gras"><b>G</b></button>
        <button className="btn small" type="button" onClick={() => wrap("*")} title="Italique"><i>I</i></button>
        <button className="btn small" type="button" onClick={() => linePrefix("# ")} title="Titre">Titre</button>
        <button className="btn small" type="button" onClick={() => linePrefix("> ")} title="Citation">❝</button>
        <button className="btn small" type="button" onClick={() => linePrefix("- ")} title="Liste">• Liste</button>
        <button className="btn small" type="button" onClick={() => openModal("link")} title="Lier une fiche (ou tapez [[ )">🔗 Lier une fiche</button>
        <button className="btn small" type="button" onClick={() => openModal("create")} title="Créer une fiche à partir du texte sélectionné">✚ Fiche depuis la sélection</button>
        <button className={`btn small ${preview ? "primary" : ""}`} type="button" onClick={() => setPreview(!preview)}>Aperçu</button>
      </div>
      <div className={preview ? "split" : ""}>
        <div style={{ position: "relative" }}>
          <textarea ref={ref} value={value} placeholder={placeholder ?? "Écrivez ici… Tapez [[ pour lier une fiche."} style={{ minHeight }}
            onChange={(e) => { onChange(e.target.value); requestAnimationFrame(detectAc); }}
            onKeyDown={(e) => {
              if (!ac || !acItems.length) return;
              if (e.key === "ArrowDown") { setAcSel((s) => Math.min(s + 1, acItems.length - 1)); e.preventDefault(); }
              else if (e.key === "ArrowUp") { setAcSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
              else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertLink(acItems[acSel], ac.start, ref.current!.selectionStart); setAc(null); }
              else if (e.key === "Escape") setAc(null);
            }}
            onBlur={() => setTimeout(() => setAc(null), 150)} />
          {ac && acItems.length > 0 && (
            <div className="popup" style={{ left: 12, top: 40 }}>
              <div className="muted small" style={{ padding: ".3em .7em" }}>Lier une fiche — Entrée pour choisir</div>
              {acItems.map((s, i) => (
                <button key={s.id} className={i === acSel ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); insertLink(s, ac.start, ref.current!.selectionStart); setAc(null); }}>
                  <span className="dot" style={{ background: s.typeColor ?? "#999" }} />{s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {preview && <div className="card"><RichText text={value} names={names} href={(id) => `#/w/${wid}/entities/${id}`} /></div>}
      </div>
      {modal?.kind === "link" && (
        <Modal title="Lier une fiche" onClose={() => setModal(null)}>
          <p className="muted small">{modal.text ? `Le texte « ${modal.text} » deviendra un lien.` : "Le lien sera inséré à la position du curseur."}</p>
          <EntityPicker wid={wid} autoFocus allowCreate onPick={(s) => { insertLink(s, modal.start, modal.end, modal.text.trim() || undefined); setModal(null); }} />
        </Modal>
      )}
      {modal?.kind === "create" && <CreateFromSelection wid={wid} text={modal.text.trim()} onClose={() => setModal(null)}
        onCreated={(s) => { insertLink(s, modal.start, modal.end, modal.text.trim()); setModal(null); }} />}
    </div>
  );
}

function CreateFromSelection({ wid, text, onClose, onCreated }: { wid: number; text: string; onClose: () => void; onCreated: (s: { id: number; name: string }) => void }) {
  const [name, setName] = useState(text);
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [typeId, setTypeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<TypeOpt[]>("GET", w(wid, "/types")).then(setTypes).catch(() => {}); }, [wid]);
  return (
    <Modal title="Créer une fiche depuis le texte" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const r = await api<{ id: number }>("POST", w(wid, "/entities"), { name, typeId: typeId ? Number(typeId) : null });
          toast(`Fiche « ${name} » créée et liée.`);
          onCreated({ id: r.id, name });
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Type<select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Sans type</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        {error && <ErrorBox error={error} />}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={busy || !name.trim()}>Créer et lier</button></div>
      </form>
    </Modal>
  );
}
