import { createHash } from "node:crypto";
import { all, get, insert, run, type DB } from "../db.ts";
import { bad, conflict, notFound } from "../errors.ts";
import { owned } from "./common.ts";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Reconnaît le format par le contenu (jamais par l'extension) et lit les
 * dimensions. Le SVG est refusé : il peut contenir du script.
 */
export function sniffImage(b: Uint8Array): { mime: string; width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length > 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length > 10 && ascii(0, 4) === "GIF8") return { mime: "image/gif", width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { mime: "image/webp", width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") { const v = dv.getUint32(21, true); return { mime: "image/webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (chunk === "VP8X") return { mime: "image/webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: "image/jpeg", height: dv.getUint16(o + 5), width: dv.getUint16(o + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      o += 2 + dv.getUint16(o + 2);
    }
  }
  return null;
}

/** Ajoute une image à la médiathèque ; une image identique déjà présente est réutilisée. */
export function addMedia(db: DB, wid: number, name: string, data: Uint8Array) {
  if (!data.length) throw bad("Fichier vide.");
  if (data.length > MAX_IMAGE_BYTES) throw bad("Image trop lourde (20 Mo au plus).");
  const info = sniffImage(data);
  if (!info || !info.width || !info.height) throw bad("Format non reconnu : JPEG, PNG, WebP ou GIF uniquement.");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const existing = get<{ id: number }>(db, "SELECT id FROM media WHERE world_id = ? AND sha256 = ?", wid, sha256);
  if (existing) return { id: existing.id, reused: true };
  const id = insert(db, "INSERT INTO media (world_id, name, mime, size, width, height, sha256, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    wid, (name || "image").slice(0, 200), info.mime, data.length, info.width, info.height, sha256, data);
  return { id, reused: false };
}

export function listMedia(db: DB, wid: number) {
  const items = all<{ id: number }>(db, "SELECT id, name, mime, size, width, height, created_at AS createdAt FROM media WHERE world_id = ? ORDER BY id DESC", wid);
  const uses = all<{ mediaId: number; id: number; name: string }>(db, "SELECT em.media_id AS mediaId, e.id, e.name FROM entity_media em JOIN entity e ON e.id = em.entity_id WHERE e.world_id = ?", wid);
  const maps = all<{ mediaId: number; id: number; name: string }>(db, "SELECT media_id AS mediaId, id, name FROM map WHERE world_id = ?", wid);
  return items.map((m) => ({ ...m, entities: uses.filter((u) => u.mediaId === m.id).map(({ id, name }) => ({ id, name })), maps: maps.filter((u) => u.mediaId === m.id).map(({ id, name }) => ({ id, name })) }));
}

export function mediaFile(db: DB, wid: number, id: number) {
  const r = get<{ mime: string; data: Uint8Array; sha256: string }>(db, "SELECT mime, data, sha256 FROM media WHERE id = ? AND world_id = ?", id, wid);
  if (!r) throw notFound("Image introuvable dans ce monde.");
  return r;
}

export function deleteMedia(db: DB, wid: number, id: number) {
  owned(db, "media", id, wid, "Image");
  const used = Number(get<{ n: number }>(db, "SELECT (SELECT COUNT(*) FROM entity_media WHERE media_id = ?) + (SELECT COUNT(*) FROM map WHERE media_id = ?) AS n", id, id)!.n);
  if (used) throw conflict("Cette image est utilisée par une fiche ou une carte.");
  run(db, "DELETE FROM media WHERE id = ?", id);
  return { deleted: true };
}
