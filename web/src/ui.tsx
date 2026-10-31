import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, w } from "./api.ts";
import type { DatePoint, Era } from "../../shared/time.ts";

/**
 * Chargement asynchrone qui ignore les réponses devenues obsolètes (nouvelle
 * recherche, changement de monde) : seule la dernière requête lancée s'affiche.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => { if (n === seq.current) setState({ data, error: null, loading: false }); },
      (e: Error) => { if (n === seq.current) setState((s) => ({ ...s, error: e.message, loading: false })); },
    );
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d: T) => setState((s) => ({ ...s, data: d })) };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  dispatchEvent(new CustomEvent("wb-toast", { detail: msg }));
}
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => { setMsg((e as CustomEvent).detail); clearTimeout(toastTimer); toastTimer = setTimeout(() => setMsg(null), 3500); };
    addEventListener("wb-toast", on);
    return () => removeEventListener("wb-toast", on);
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function Loading({ what = "Chargement…" }: { what?: string }) {
  return <p className="muted">{what}</p>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error row between" role="alert">
      <span>{error}</span>
      {retry && <button className="btn small" onClick={retry}>Réessayer</button>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between"><h2>{title}</h2><button className="btn ghost small" onClick={onClose} aria-label="Fermer">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Bouton qui demande confirmation dans une modale avant d'agir. */
export function ConfirmButton({ label, title, message, confirmLabel = "Confirmer", onConfirm, className = "btn danger small" }:
  { label: ReactNode; title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => Promise<unknown>; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className={className} onClick={() => { setOpen(true); setError(null); }}>{label}</button>
      {open && (
        <Modal title={title} onClose={() => !busy && setOpen(false)}>
          <div className="stack">
            <div>{message}</div>
            {error && <ErrorBox error={error} />}
            <div className="row end">
              <button className="btn" disabled={busy} onClick={() => setOpen(false)}>Annuler</button>
              <button className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await onConfirm(); setOpen(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
              }}>{confirmLabel}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function TypeBadge({ name, color }: { name?: string | null; color?: string | null }) {
  if (!name) return <span className="badge muted">Sans type</span>;
  return <span className="badge"><span className="dot" style={{ background: color ?? "#888" }} />{name}</span>;
}

export type Suggestion = { id: number; name: string; typeName: string | null; typeColor: string | null };

/** Champ de recherche d'une fiche du monde (20 suggestions par nom). */
export function EntityPicker({ wid, onPick, placeholder = "Rechercher une fiche…", exclude = [], autoFocus, allowCreate }:
  { wid: number; onPick: (s: Suggestion) => void; placeholder?: string; exclude?: number[]; autoFocus?: boolean; allowCreate?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      api<Suggestion[]>("GET", w(wid, `/entities/suggest?q=${encodeURIComponent(q)}`)).then((r) => { if (n === seq.current) { setItems(r.filter((x) => !exclude.includes(x.id))); setSel(0); } }).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [q, wid]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (s: Suggestion | "create") => {
    if (s === "create") {
      const r = await api<{ id: number }>("POST", w(wid, "/entities"), { name: q.trim() });
      s = { id: r.id, name: q.trim(), typeName: null, typeColor: null };
      toast(`Fiche « ${s.name} » créée.`);
    }
    onPick(s); setQ(""); setOpen(false);
  };
  const showCreate = allowCreate && q.trim().length > 0 && !items.some((i) => i.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <div style={{ position: "relative" }}>
      <input value={q} placeholder={placeholder} autoFocus={autoFocus} style={{ width: "100%" }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { setSel((s) => Math.min(s + 1, items.length - 1)); e.preventDefault(); }
          if (e.key === "ArrowUp") { setSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
          if (e.key === "Enter") { e.preventDefault(); if (items[sel]) pick(items[sel]); else if (showCreate) pick("create"); }
        }} />
      {open && (items.length > 0 || showCreate) && (
        <div className="popup" style={{ top: "100%", left: 0, right: 0 }}>
          {items.map((s, i) => (
            <button key={s.id} className={i === sel ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
              <span className="dot" style={{ background: s.typeColor ?? "#999" }} />{s.name}<span className="muted small" style={{ marginLeft: "auto" }}>{s.typeName ?? ""}</span>
            </button>
          ))}
          {showCreate && <button onMouseDown={(e) => { e.preventDefault(); pick("create"); }}>＋ Créer la fiche « {q.trim()} »</button>}
        </div>
      )}
    </div>
  );
}

/** Saisie d'une date relative à une ère. */
export function DatePointEditor({ eras, value, onChange }: { eras: Era[]; value: DatePoint | null; onChange: (d: DatePoint | null) => void }) {
  const v = value ?? { eraId: eras[0]?.id ?? 0, year: null, month: null, day: null, approx: false };
  const num = (s: string) => (s.trim() === "" ? null : Math.trunc(Number(s)));
  const mode = v.year === null ? "during" : v.year < 0 ? "before" : "in";
  const set = (patch: Partial<DatePoint>) => onChange({ ...v, ...patch });
  return (
    <div className="row" style={{ gap: ".4rem" }}>
      <select value={mode} onChange={(e) => set({ year: e.target.value === "during" ? null : e.target.value === "before" ? -Math.abs(v.year ?? 1) : Math.abs(v.year ?? 1) })} aria-label="Repère">
        <option value="in">An</option><option value="before">Ans avant</option><option value="during">Durant</option>
      </select>
      {mode !== "during" && <input type="number" min={1} style={{ width: "6em" }} value={v.year === null ? "" : Math.abs(v.year)} aria-label="Année"
        onChange={(e) => { const n = num(e.target.value); set({ year: n ? (mode === "before" ? -Math.abs(n) : Math.abs(n)) : 1 }); }} />}
      <select value={v.eraId} onChange={(e) => set({ eraId: Number(e.target.value) })} aria-label="Ère">
        {eras.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <input type="number" min={1} max={99} placeholder="mois" style={{ width: "5em" }} value={v.month ?? ""} aria-label="Mois" onChange={(e) => set({ month: num(e.target.value), day: num(e.target.value) === null ? null : v.day })} />
      <input type="number" min={1} max={99} placeholder="jour" style={{ width: "5em" }} value={v.day ?? ""} aria-label="Jour" disabled={v.month === null} onChange={(e) => set({ day: num(e.target.value) })} />
      <label className="row" style={{ display: "inline-flex", gap: ".3em" }}><input type="checkbox" checked={v.approx} onChange={(e) => set({ approx: e.target.checked })} />environ</label>
    </div>
  );
}

export function formatBytes(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(n / 1024)} Ko`;
}
