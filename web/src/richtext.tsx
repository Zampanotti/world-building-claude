import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LINK_RE, linkMarkup, splitLinks } from "../../shared/richtext.ts";
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
 * Zone d'édition : le texte reste du balisage `[[id|libellé]]`, mais chaque lien
 * est affiché comme une pastille non modifiable portant le nom actuel de la fiche.
 * Le DOM n'est reconstruit que lorsque la valeur change de l'extérieur (lien
 * inséré, brouillon restauré…) : pendant la frappe, le navigateur garde la main,
 * ce qui préserve le curseur et l'annulation native.
 */
function paint(el: HTMLElement, value: string, names: Names) {
  el.replaceChildren();
  for (const seg of splitLinks(value)) {
    if (seg.kind === "text") { el.append(document.createTextNode(seg.text)); continue; }
    const chip = document.createElement("span");
    const name = names[seg.id];
    chip.className = name === undefined ? "elink broken" : "elink";
    chip.contentEditable = "false";
    chip.dataset.markup = seg.raw;
    chip.title = name === undefined ? "Lien cassé : la fiche n'existe plus" : "Lien vers une fiche";
    chip.textContent = name ?? seg.label;
    el.append(chip);
  }
  // Un saut de ligne final n'est visible que suivi d'un <br>, ignoré à la relecture.
  if (value.endsWith("\n")) { const br = document.createElement("br"); br.dataset.end = ""; el.append(br); }
}

/** Relit le balisage à partir du DOM (ou d'un fragment) de la zone d'édition. */
function serialize(node: Node): string {
  let out = "";
  node.childNodes.forEach((c, i) => {
    if (c.nodeType === Node.TEXT_NODE) out += (c as Text).data;
    else if (c instanceof HTMLElement) {
      if (c.dataset.markup !== undefined) out += c.dataset.markup;
      else if (c.tagName === "BR") { if (c.dataset.end === undefined && !(c === node.lastChild && out.endsWith("\n"))) out += "\n"; }
      else if (c.tagName === "DIV" || c.tagName === "P") out += (i > 0 && !out.endsWith("\n") ? "\n" : "") + serialize(c);
      else out += serialize(c);
    }
  });
  return out;
}

/** Position d'un point du DOM, comptée en caractères du balisage. */
function offsetOf(el: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, offset);
  return serialize(r.cloneContents()).length;
}

/** Place le curseur à une position du balisage (DOM tel que peint par `paint`). */
function placeCaret(el: HTMLElement, pos: number) {
  const r = document.createRange();
  let left = pos;
  let done = false;
  for (const c of Array.from(el.childNodes)) {
    const len = c.nodeType === Node.TEXT_NODE ? (c as Text).data.length : (c as HTMLElement).dataset.markup?.length ?? 0;
    if (c.nodeType === Node.TEXT_NODE && left <= len) { r.setStart(c, left); done = true; break; }
    if (c.nodeType !== Node.TEXT_NODE && len && left < len) { r.setStartBefore(c); done = true; break; }
    left -= len;
  }
  if (!done) { r.selectNodeContents(el); r.collapse(false); }
  r.collapse(true);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * Éditeur du texte éditorial : une zone de texte avec barre d'outils.
 * - « [[ » ouvre la recherche de fiches et insère un lien stable (identifiant) ;
 * - « Créer une fiche » transforme la sélection en nouvelle fiche liée.
 */
export function RichEditor({ wid, value, onChange, names, onNames, minHeight = 260, placeholder }:
  { wid: number; value: string; onChange: (v: string) => void; names: Names; onNames: (n: Names) => void; minHeight?: number; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<{ value: string; names: Names } | null>(null);
  const sel = useRef({ start: 0, end: 0 });
  const caretAfterPaint = useRef<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [ac, setAc] = useState<{ q: string; start: number } | null>(null);
  const [acItems, setAcItems] = useState<Suggestion[]>([]);
  const [acSel, setAcSel] = useState(0);
  const [modal, setModal] = useState<null | { kind: "link" | "create"; start: number; end: number; text: string }>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (shown.current?.value === value && shown.current.names === names) return;
    const focused = document.activeElement === el;
    const caret = caretAfterPaint.current ?? (focused ? sel.current.end : null);
    caretAfterPaint.current = null;
    paint(el, value, names);
    shown.current = { value, names };
    if (caret !== null) { el.focus(); placeCaret(el, caret); readSelection(); }
  }, [value, names]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Mémorise la sélection : les boutons de la barre d'outils s'en servent. */
  const readSelection = () => {
    const el = ref.current;
    const s = getSelection();
    if (!el || !s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return;
    sel.current = { start: offsetOf(el, r.startContainer, r.startOffset), end: offsetOf(el, r.endContainer, r.endOffset) };
  };
  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ac) return;
    let live = true;
    api<Suggestion[]>("GET", w(wid, `/entities/suggest?q=${encodeURIComponent(ac.q)}`)).then((r) => { if (live) { setAcItems(r); setAcSel(0); } }).catch(() => {});
    return () => { live = false; };
  }, [ac?.q, wid]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Texte affiché : en avance sur `value` tant que React n'a pas rendu la dernière frappe. */
  const current = () => shown.current?.value ?? value;
  const replace = (start: number, end: number, insert: string) => {
    const v = current();
    caretAfterPaint.current = start + insert.length;
    onChange(v.slice(0, start) + insert + v.slice(end));
  };
  const insertLink = (s: { id: number; name: string }, start: number, end: number, label?: string) => {
    onNames({ ...names, [s.id]: s.name });
    replace(start, end, linkMarkup(s.id, label || s.name));
  };
  const onInput = () => {
    const el = ref.current!;
    const v = serialize(el);
    shown.current = { value: v, names };
    readSelection();
    onChange(v);
    // Lu dans le DOM lui-même : l'état React peut avoir une frappe de retard.
    const m = v.slice(0, sel.current.end).match(/\[\[([^[\]|\n]{0,40})$/);
    setAc(m ? { q: m[1], start: sel.current.end - m[0].length } : null);
  };
  const wrap = (mark: string) => {
    const { start: a, end: b } = sel.current;
    replace(a, b, mark + (current().slice(a, b) || "texte") + mark);
  };
  const linePrefix = (prefix: string) => {
    const v = current();
    const a = v.lastIndexOf("\n", sel.current.start - 1) + 1;
    caretAfterPaint.current = sel.current.end + prefix.length;
    onChange(v.slice(0, a) + prefix + v.slice(a));
  };
  const openModal = (kind: "link" | "create") => {
    const { start, end } = sel.current;
    const text = current().slice(start, end);
    if (kind === "create" && !text.trim()) { toast("Sélectionnez d'abord le nom de la fiche dans le texte."); return; }
    setModal({ kind, start, end, text });
  };

  return (
    <div className="editor">
      <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
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
          <div ref={ref} className="rich-input" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
            data-placeholder={placeholder ?? "Écrivez ici… Tapez [[ pour lier une fiche."} style={{ minHeight }}
            onInput={onInput}
            onPaste={(e) => { e.preventDefault(); replace(sel.current.start, sel.current.end, e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n")); }}
            onDrop={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (ac && acItems.length) {
                if (e.key === "ArrowDown") { setAcSel((s) => Math.min(s + 1, acItems.length - 1)); e.preventDefault(); return; }
                if (e.key === "ArrowUp") { setAcSel((s) => Math.max(s - 1, 0)); e.preventDefault(); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertLink(acItems[acSel], ac.start, sel.current.end); setAc(null); return; }
                if (e.key === "Escape") { setAc(null); return; }
              }
              if (e.key === "Enter") { e.preventDefault(); replace(sel.current.start, sel.current.end, "\n"); }
              else if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "i")) { e.preventDefault(); wrap(e.key === "b" ? "**" : "*"); }
            }}
            onBlur={() => setTimeout(() => setAc(null), 150)} />
          {ac && acItems.length > 0 && (
            <div className="popup" style={{ left: 12, top: 40 }}>
              <div className="muted small" style={{ padding: ".3em .7em" }}>Lier une fiche — Entrée pour choisir</div>
              {acItems.map((s, i) => (
                <button key={s.id} className={i === acSel ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); insertLink(s, ac.start, sel.current.end); setAc(null); }}>
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
