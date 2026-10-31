import { deflateSync } from "node:zlib";
import { get, type DB } from "../db.ts";
import { createWorld, uniqueWorldName } from "./worlds.ts";
import { createEntity, updateEntity, attachImage } from "./entities.ts";
import { createRelation } from "./relations.ts";
import { saveEras } from "./chronology.ts";
import { addMedia } from "./media.ts";
import { createMap, addPin } from "./maps.ts";
import { createDocument, updateSection, createSection } from "./documents.ts";
import { linkMarkup } from "../../shared/richtext.ts";

// ---- Petite carte générée (PNG sans dépendance) -------------------------------------

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

function png(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

/** Bruit de valeur lissé, déterministe : un continent façon parchemin. */
export function generateMapPng(width = 960, height = 640, seed = 7): Uint8Array {
  const rand = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const smooth = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rand(xi, yi), b = rand(xi + 1, yi), c = rand(xi, yi + 1), d = rand(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let n = 0, amp = 1, f = 1 / 160;
    for (let o = 0; o < 5; o++) { n += smooth(x * f, y * f) * amp; amp /= 2; f *= 2; }
    n /= 1.9375;
    const dx = (x / width - 0.5) * 2, dy = (y / height - 0.5) * 2;
    const h = n - Math.sqrt(dx * dx + dy * dy) * 0.55;
    const grain = (rand(x, y) - 0.5) * 10;
    let c: [number, number, number];
    if (h < 0.08) c = [170, 196, 205];
    else if (h < 0.11) c = [214, 200, 160];
    else if (h < 0.3) c = [190, 196, 140];
    else if (h < 0.4) c = [160, 170, 115];
    else if (h < 0.47) c = [150, 130, 100];
    else c = [235, 230, 220];
    const contour = h > 0.08 && Math.abs(((h * 40) % 1) - 0.5) < 0.04 ? -18 : 0;
    const i = (y * width + x) * 3;
    rgb[i] = Math.max(0, Math.min(255, c[0] + grain + contour));
    rgb[i + 1] = Math.max(0, Math.min(255, c[1] + grain + contour));
    rgb[i + 2] = Math.max(0, Math.min(255, c[2] + grain + contour));
  }
  return png(width, height, rgb);
}

// ---- Monde d'exemple ------------------------------------------------------------------

/** Crée un monde de démonstration complet pour découvrir l'application. */
export function createExampleWorld(db: DB) {
  const { id: wid } = createWorld(db, { name: uniqueWorldName(db, "Les Terres d'Aldémar (exemple)"), description: "Un monde de démonstration : modifiez-le ou supprimez-le librement." });
  const typeId = (n: string) => get<{ id: number }>(db, "SELECT id FROM entity_type WHERE world_id = ? AND name = ?", wid, n)!.id;
  const relId = (n: string) => get<{ id: number }>(db, "SELECT id FROM relation_type WHERE world_id = ? AND name = ?", wid, n)!.id;
  const defId = (t: string, n: string) => get<{ id: number }>(db, "SELECT id FROM property_def WHERE type_id = ? AND name = ?", typeId(t), n)!.id;
  const eras = saveEras(db, wid, { eras: [
    { name: "l'Âge des Fondateurs", duration: 400, gapBefore: 0, color: "#a855f7" },
    { name: "la Longue Nuit", duration: 120, gapBefore: 0, color: "#475569" },
    { name: "l'Ère des Couronnes", duration: 312, gapBefore: 3, color: "#f59e0b" },
  ] });
  const [founders, night, crowns] = eras.map((e) => e.id);
  const E: Record<string, number> = {};
  const mk = (name: string, type: string, summary: string) => (E[name] = createEntity(db, wid, { name, typeId: typeId(type), summary }).id);
  mk("Aldémar", "Lieu", "Le continent principal, bordé par la mer d'Opale.");
  mk("Royaume de Valcrest", "Lieu", "Royaume des plaines du nord, gouverné depuis Haute-Cendre.");
  mk("Haute-Cendre", "Lieu", "Capitale de Valcrest, bâtie sur un ancien volcan.");
  mk("Forêt de Morneval", "Lieu", "Forêt ancienne où la Longue Nuit a commencé.");
  mk("Isolde de Valcrest", "Personnage", "Reine de Valcrest, stratège redoutée.");
  mk("Edric le Gris", "Personnage", "Archiviste de l'Ordre de la Lanterne.");
  mk("Maelis", "Personnage", "Fille d'Isolde, héritière du trône.");
  mk("Ordre de la Lanterne", "Organisation", "Gardiens du savoir d'avant la Longue Nuit.");
  mk("La Couronne de braise", "Objet", "Couronne forgée dans la lave de Haute-Cendre.");
  mk("Le Sacre d'Isolde", "Événement", "Couronnement qui met fin à la guerre de succession.");
  mk("La Longue Nuit", "Événement", "Cent vingt ans sans soleil.");

  const rev = (id: number) => get<{ r: number }>(db, "SELECT revision AS r FROM entity WHERE id = ?", id)!.r;
  const L = (n: string) => linkMarkup(E[n], n);
  const set = (n: string, body: Record<string, unknown>) => updateEntity(db, wid, E[n], { expectedRevision: rev(E[n]), ...body });
  set("Isolde de Valcrest", {
    description: `# Jeunesse\nNée à ${L("Haute-Cendre")}, Isolde grandit dans l'ombre des guerres de succession.\n\n# Règne\nAprès ${L("Le Sacre d'Isolde")}, elle porte ${L("La Couronne de braise")} et s'allie à l'${L("Ordre de la Lanterne")}.\n\n> « Une couronne ne pèse que ce que pèse la promesse. »`,
    properties: { [defId("Personnage", "Titre")]: "Reine de Valcrest", [defId("Personnage", "Espèce")]: "Humaine", [defId("Personnage", "Naissance")]: { eraId: crowns, year: 271, month: 3, day: 14, approx: false } },
    timeSpan: { start: { eraId: crowns, year: 271, month: 3, day: 14, approx: false }, end: null },
  });
  set("Edric le Gris", { description: `Archiviste de l'${L("Ordre de la Lanterne")}, il a consigné la chute de la ${L("Forêt de Morneval")}.`,
    properties: { [defId("Personnage", "Titre")]: "Grand archiviste" }, timeSpan: { start: { eraId: crowns, year: 230, month: null, day: null, approx: true }, end: null } });
  set("Maelis", { timeSpan: { start: { eraId: crowns, year: 296, month: null, day: null, approx: false }, end: null } });
  set("Ordre de la Lanterne", { properties: { [defId("Organisation", "Devise")]: "Que la flamme se souvienne.", [defId("Organisation", "Dirigeant")]: E["Edric le Gris"] },
    timeSpan: { start: { eraId: night, year: 12, month: null, day: null, approx: true }, end: null } });
  set("La Couronne de braise", { properties: { [defId("Objet", "Matériau")]: "Obsidienne et or", [defId("Objet", "Magique")]: true } });
  set("Le Sacre d'Isolde", { timeSpan: { start: { eraId: crowns, year: 290, month: 6, day: 1, approx: false }, end: null } });
  set("La Longue Nuit", { description: `Commencée dans la ${L("Forêt de Morneval")}, elle dura toute une ère.`, timeSpan: { start: { eraId: night, year: null, month: null, day: null, approx: false }, end: { eraId: night, year: 120, month: null, day: null, approx: false } } });
  set("Haute-Cendre", { properties: { [defId("Lieu", "Population")]: 48000, [defId("Lieu", "Climat")]: "Chaud et sec" }, timeSpan: { start: { eraId: founders, year: 88, month: null, day: null, approx: true }, end: null } });

  const rel = (a: string, t: string, b: string) => createRelation(db, wid, { typeId: relId(t), sourceId: E[a], targetId: E[b] });
  rel("Royaume de Valcrest", "situé dans", "Aldémar");
  rel("Haute-Cendre", "situé dans", "Royaume de Valcrest");
  rel("Forêt de Morneval", "situé dans", "Aldémar");
  rel("Isolde de Valcrest", "parent de", "Maelis");
  rel("Isolde de Valcrest", "possède", "La Couronne de braise");
  rel("Edric le Gris", "membre de", "Ordre de la Lanterne");
  rel("Isolde de Valcrest", "allié de", "Ordre de la Lanterne");

  const { id: mediaId } = addMedia(db, wid, "carte-aldemar.png", generateMapPng());
  attachImage(db, wid, E["Aldémar"], { mediaId, caption: "Le continent d'Aldémar" });
  const { id: mapId } = createMap(db, wid, { name: "Carte d'Aldémar", mediaId, entityId: E["Aldémar"] });
  addPin(db, wid, mapId, { entityId: E["Haute-Cendre"], x: 0.52, y: 0.38 });
  addPin(db, wid, mapId, { entityId: E["Forêt de Morneval"], x: 0.36, y: 0.62 });
  addPin(db, wid, mapId, { entityId: E["Royaume de Valcrest"], x: 0.6, y: 0.3 });

  const doc = createDocument(db, wid, { title: "Les Chroniques de Braise" });
  updateSection(db, wid, doc.sectionId, { expectedRevision: 1, title: "Prologue", content:
    `La nuit était tombée sur ${L("Aldémar")} depuis si longtemps que plus personne ne se souvenait de la couleur du ciel.\n\nÀ ${L("Haute-Cendre")}, ${L("Edric le Gris")} referma son registre. **La Longue Nuit touchait à sa fin.**` });
  const ch = createSection(db, wid, doc.id, { title: "Chapitre 1 — Le Sacre" });
  updateSection(db, wid, ch.id, { expectedRevision: 1, content: `${L("Isolde de Valcrest")} s'agenouilla. Quand ${L("La Couronne de braise")} toucha son front, la salle entière retint son souffle.` });
  const sub = createSection(db, wid, doc.id, { title: "Scène 1 — La veille", parentId: ch.id });
  updateSection(db, wid, sub.id, { expectedRevision: 1, content: `La veille du sacre, ${L("Maelis")} avait fui le palais.` });
  return { id: wid };
}
