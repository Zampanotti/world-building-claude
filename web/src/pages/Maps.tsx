import { useEffect, useRef, useState } from "react";
import { api, w, mediaUrl } from "../api.ts";
import { go } from "../router.ts";
import { useLoad, Loading, ErrorBox, ConfirmButton, EntityPicker, Modal, toast } from "../ui.tsx";
import { uploadImage } from "../images.ts";
import { MediaPickerModal } from "./Entity.tsx";

type MapRow = { id: number; name: string; mediaId: number; width: number; height: number; entityId: number | null; entityName: string | null; pins: number };

export function MapsList({ wid }: { wid: number }) {
  const maps = useLoad(() => api<MapRow[]>("GET", w(wid, "/maps")), [wid]);
  const [name, setName] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const create = async (mediaId: number) => {
    const r = await api<{ id: number }>("POST", w(wid, "/maps"), { name: name.trim() || "Nouvelle carte", mediaId });
    go(`/w/${wid}/maps/${r.id}`);
  };
  return (
    <div className="stack">
      <h1>Cartes</h1>
      <div className="card stack">
        <div className="row">
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la nouvelle carte" />
          <button className="btn primary" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Envoi…" : "Image depuis l'ordinateur"}</button>
          <button className="btn" onClick={() => setPicker(true)}>Image de la médiathèque</button>
        </div>
        <p className="muted small">Une carte est une image (jusqu'à 6000 pixels de côté) sur laquelle on épingle des fiches. Une carte peut être rattachée à une fiche (pays, ville…) pour descendre d'une carte à l'autre.</p>
        <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          setBusy(true);
          try { const m = await uploadImage(wid, f, 6000); await create(m.id); } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
        }} />
      </div>
      {maps.error && <ErrorBox error={maps.error} retry={maps.reload} />}
      {maps.data?.length === 0 && <div className="empty card">Aucune carte pour l'instant.</div>}
      <div className="grid-cards">{maps.data?.map((m) => (
        <a key={m.id} className="card" href={`#/w/${wid}/maps/${m.id}`} style={{ color: "inherit", textDecoration: "none", padding: 0, overflow: "hidden" }}>
          <img src={mediaUrl(wid, m.mediaId)} alt="" style={{ width: "100%", aspectRatio: "3/2", objectFit: "cover", display: "block" }} loading="lazy" />
          <div style={{ padding: ".7rem .9rem" }}><strong>{m.name}</strong><div className="muted small">{m.pins} épingle(s){m.entityName ? ` · carte de ${m.entityName}` : ""}</div></div>
        </a>
      ))}</div>
      {picker && <MediaPickerModal wid={wid} onClose={() => setPicker(false)} onPick={(id) => { setPicker(false); create(id).catch((e) => toast(e.message)); }} />}
    </div>
  );
}

type Pin = { id: number; x: number; y: number; entityId: number; name: string; summary: string; typeName: string | null; typeColor: string | null; imageId: number | null; childMapId: number | null };
type MapFull = MapRow & { pins: Pin[]; breadcrumb: { id: number; name: string }[] };

export function MapViewer({ wid, id, query }: { wid: number; id: number; query: URLSearchParams }) {
  const map = useLoad(() => api<MapFull>("GET", w(wid, `/maps/${id}`)), [wid, id]);
  const view = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [sel, setSel] = useState<number | null>(Number(query.get("pin")) || null);
  const [placing, setPlacing] = useState<{ entityId: number; name: string; pinId?: number } | null>(null);
  const [choose, setChoose] = useState(false);
  const [attach, setAttach] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, startDist: 0, startS: 1, mid: { x: 0, y: 0 } });

  const fit = () => {
    const m = map.data, v = view.current;
    if (!m || !v) return;
    const s = Math.min(v.clientWidth / m.width, v.clientHeight / m.height);
    setT({ s, x: (v.clientWidth - m.width * s) / 2, y: (v.clientHeight - m.height * s) / 2 });
  };
  useEffect(fit, [map.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Arrivée depuis une fiche avec ?placer=<fiche> : mode pose direct (ou sélection si déjà épinglée).
  useEffect(() => {
    const p = Number(query.get("placer"));
    if (!p || !map.data) return;
    const existing = map.data.pins.find((x) => x.entityId === p);
    if (existing) setSel(existing.id);
    else api<{ name: string }>("GET", w(wid, `/entities/${p}`)).then((e) => setPlacing({ entityId: p, name: e.name })).catch(() => {});
  }, [map.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = v.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  });

  const zoomAt = (mx: number, my: number, f: number) => setT((c) => {
    const s = Math.max(0.05, Math.min(c.s * f, 8));
    return { s, x: mx - (mx - c.x) * (s / c.s), y: my - (my - c.y) * (s / c.s) };
  });
  const local = (e: React.PointerEvent) => { const r = view.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  if (map.error) return <ErrorBox error={map.error} retry={map.reload} />;
  if (!map.data) return <Loading />;
  const m = map.data;
  const selected = m.pins.find((p) => p.id === sel) ?? null;

  const place = async (px: number, py: number) => {
    const x = (px - t.x) / t.s / m.width, y = (py - t.y) / t.s / m.height;
    if (x < 0 || x > 1 || y < 0 || y > 1 || !placing) return;
    try {
      if (placing.pinId) await api("PATCH", w(wid, `/maps/${id}/pins/${placing.pinId}`), { x, y });
      else { const r = await api<{ id: number }>("POST", w(wid, `/maps/${id}/pins`), { entityId: placing.entityId, x, y }); setSel(r.id); }
      setPlacing(null); map.reload(); toast("Épingle placée.");
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="stack">
      <div className="row small">
        <a href={`#/w/${wid}/maps`}>Cartes</a>
        {m.breadcrumb.map((b) => <span key={b.id}>› <a href={`#/w/${wid}/maps/${b.id}`}>{b.name}</a></span>)}
        <span>› {m.name}</span>
      </div>
      <div className="topbar" style={{ marginBottom: 0 }}>
        {rename !== null ? (
          <form className="row grow" onSubmit={async (e) => { e.preventDefault(); await api("PATCH", w(wid, `/maps/${id}`), { name: rename }); setRename(null); map.reload(); }}>
            <input className="grow" value={rename} onChange={(e) => setRename(e.target.value)} autoFocus /><button className="btn primary small">OK</button>
          </form>
        ) : <><h1>{m.name}</h1><button className="btn ghost small" onClick={() => setRename(m.name)}>✎</button></>}
        <span className="grow" />
        <button className="btn primary small" onClick={() => setChoose(true)}>📍 Épingler une fiche</button>
        {m.entityId ? <span className="row small">Carte de <a href={`#/w/${wid}/entities/${m.entityId}`}>{m.entityName}</a>
          <button className="btn ghost small" onClick={async () => { await api("PATCH", w(wid, `/maps/${id}`), { entityId: null }); map.reload(); }}>Détacher</button></span>
          : <button className="btn small" onClick={() => setAttach(true)}>Rattacher à une fiche…</button>}
        <ConfirmButton label="Supprimer…" title="Supprimer la carte ?" message={<p>Les épingles disparaissent ; l'image reste dans la médiathèque et les fiches ne changent pas.</p>}
          onConfirm={async () => { await api("DELETE", w(wid, `/maps/${id}`)); go(`/w/${wid}/maps`); }} />
      </div>
      {placing && <div className="warn row between"><span>Touchez la carte à l'endroit de « {placing.name} ».</span><button className="btn small" onClick={() => setPlacing(null)}>Annuler</button></div>}
      <div ref={view} className={`map-view ${placing ? "placing" : ""}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          gesture.current.moved = 0;
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current.startDist = Math.hypot(a.x - b.x, a.y - b.y);
            gesture.current.startS = t.s;
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 1) {
            gesture.current.moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
            setT((c) => ({ ...c, x: c.x + p.x - prev.x, y: c.y + p.y - prev.y }));
          } else if (pointers.current.size === 2) {
            gesture.current.moved += 10;
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const target = gesture.current.startS * (d / gesture.current.startDist);
            zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / t.s);
          }
        }}
        onPointerUp={(e) => {
          const p = local(e);
          const wasClick = pointers.current.size === 1 && gesture.current.moved < 6;
          pointers.current.delete(e.pointerId);
          if (wasClick) { if (placing) place(p.x, p.y); else setSel(null); }
        }}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onDoubleClick={(e) => { const r = view.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8); }}>
        <div className="map-layer" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, width: m.width, height: m.height }}>
          <img src={mediaUrl(wid, m.mediaId)} width={m.width} height={m.height} alt={m.name} draggable={false} />
          {m.pins.map((p) => (
            <div key={p.id} className={`pin ${p.id === sel ? "sel" : ""}`} title={p.name}
              style={{ left: p.x * m.width, top: p.y * m.height, transform: `translate(-50%, -100%) scale(${1 / t.s})`, transformOrigin: "50% 100%", pointerEvents: placing ? "none" : "auto" }}
              onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => { e.stopPropagation(); setSel(p.id); }}>
              <div className="head" style={{ background: p.typeColor ?? "#ef4444" }} />
              <div className="lbl">{p.childMapId ? "▱ " : ""}{p.name}</div>
            </div>
          ))}
        </div>
        <div className="map-controls" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <button className="btn small" onClick={() => zoomAt(view.current!.clientWidth / 2, view.current!.clientHeight / 2, 1.4)} aria-label="Zoomer">＋</button>
          <button className="btn small" onClick={() => zoomAt(view.current!.clientWidth / 2, view.current!.clientHeight / 2, 1 / 1.4)} aria-label="Dézoomer">－</button>
          <button className="btn small" onClick={fit}>Ajuster</button>
        </div>
        {selected && !placing && (
          <div className="card pin-card" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              {selected.imageId && <img src={mediaUrl(wid, selected.imageId)} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />}
              <div className="grow"><strong>{selected.name}</strong><div className="muted small">{selected.typeName ?? "Sans type"}</div>{selected.summary && <div className="small">{selected.summary}</div>}</div>
              <button className="btn ghost small" onClick={() => setSel(null)} aria-label="Fermer">✕</button>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <a className="btn small" href={`#/w/${wid}/entities/${selected.entityId}`}>Ouvrir la fiche</a>
              {selected.childMapId && <a className="btn small primary" href={`#/w/${wid}/maps/${selected.childMapId}`}>▱ Ouvrir sa carte</a>}
              <button className="btn small" onClick={() => setPlacing({ entityId: selected.entityId, name: selected.name, pinId: selected.id })}>Déplacer</button>
              <ConfirmButton label="Retirer…" title="Retirer l'épingle ?" message={<p>« {selected.name} » ne sera plus épinglée ici. La fiche n'est pas modifiée.</p>}
                onConfirm={async () => { await api("DELETE", w(wid, `/maps/${id}/pins/${selected.id}`)); setSel(null); map.reload(); }} />
            </div>
          </div>
        )}
      </div>
      {m.pins.length > 0 && (
        <div className="card"><h2>Épingles</h2>
          <div className="row">{m.pins.map((p) => <button key={p.id} className={`badge tag-chip ${p.id === sel ? "on" : ""}`} onClick={() => setSel(p.id)}><span className="dot" style={{ background: p.typeColor ?? "#ef4444" }} />{p.name}</button>)}</div>
        </div>
      )}
      {choose && (
        <Modal title="Épingler une fiche" onClose={() => setChoose(false)}>
          <p className="muted small">Choisissez la fiche, puis touchez la carte à son emplacement. Les fiches déjà épinglées sont exclues.</p>
          <EntityPicker wid={wid} autoFocus allowCreate exclude={m.pins.map((p) => p.entityId)} onPick={(s) => { setChoose(false); setPlacing({ entityId: s.id, name: s.name }); }} />
        </Modal>
      )}
      {attach && (
        <Modal title="Rattacher la carte à une fiche" onClose={() => setAttach(false)}>
          <p className="muted small">Les épingles de cette fiche sur d'autres cartes mèneront ici. Une fiche n'a qu'une carte.</p>
          <EntityPicker wid={wid} autoFocus onPick={async (s) => { try { await api("PATCH", w(wid, `/maps/${id}`), { entityId: s.id }); setAttach(false); map.reload(); } catch (e) { toast((e as Error).message); } }} />
        </Modal>
      )}
    </div>
  );
}
