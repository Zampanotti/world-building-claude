import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.ts";

const s = await startServer();
after(() => s.close());

const world = async (name: string) => (await s.api("POST", "/api/worlds", { name })).data.id as number;
const typeId = async (w: number, name: string) => (await s.api("GET", `/api/worlds/${w}/types`)).data.find((t: { name: string }) => t.name === name).id;
const relType = async (w: number, name: string) => (await s.api("GET", `/api/worlds/${w}/relation-types`)).data.find((t: { name: string }) => t.name === name).id;

test("création de monde : types et relations par défaut, nom unique", async () => {
  const w = await world("Alpha");
  const types = (await s.api("GET", `/api/worlds/${w}/types`)).data;
  assert.ok(types.some((t: { name: string }) => t.name === "Personnage"));
  assert.equal((await s.api("POST", "/api/worlds", { name: "alpha" })).status, 409);
  assert.equal((await s.api("POST", "/api/worlds", "{pas du json")).status, 400);
});

test("isolation : une fiche d'un autre monde est introuvable et ne peut pas être reliée", async () => {
  const a = await world("Iso A"), b = await world("Iso B");
  const ea = (await s.api("POST", `/api/worlds/${a}/entities`, { name: "Secret" })).data.id;
  const eb = (await s.api("POST", `/api/worlds/${b}/entities`, { name: "Autre" })).data.id;
  assert.equal((await s.api("GET", `/api/worlds/${b}/entities/${ea}`)).status, 404);
  assert.equal((await s.api("PATCH", `/api/worlds/${b}/entities/${ea}`, { expectedRevision: 1, name: "x" })).status, 404);
  const rt = await relType(b, "allié de");
  assert.equal((await s.api("POST", `/api/worlds/${b}/relations`, { typeId: rt, sourceId: eb, targetId: ea })).status, 404);
  const search = (await s.api("GET", `/api/worlds/${b}/search?q=secret`)).data;
  assert.equal(search.counts.all, 0);
  const explore = (await s.api("GET", `/api/worlds/${b}/entities`)).data;
  assert.deepEqual(explore.items.map((e: { name: string }) => e.name), ["Autre"]);
});

test("fiche : révision attendue, propriétés typées, conflit 409", async () => {
  const w = await world("Props");
  const t = await typeId(w, "Lieu");
  const id = (await s.api("POST", `/api/worlds/${w}/entities`, { name: "Port", typeId: t })).data.id;
  let e = (await s.api("GET", `/api/worlds/${w}/entities/${id}`)).data;
  const pop = e.properties.find((p: { def: { name: string } }) => p.def.name === "Population").def.id;
  const r1 = await s.api("PATCH", `/api/worlds/${w}/entities/${id}`, { expectedRevision: e.revision, properties: { [pop]: "1200,5" } });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.properties.find((p: { def: { id: number } }) => p.def.id === pop).value, 1200.5);
  assert.equal((await s.api("PATCH", `/api/worlds/${w}/entities/${id}`, { expectedRevision: e.revision, name: "Écrasé" })).status, 409);
  assert.equal((await s.api("PATCH", `/api/worlds/${w}/entities/${id}`, { expectedRevision: r1.data.revision, properties: { [pop]: "beaucoup" } })).status, 400);
  e = (await s.api("GET", `/api/worlds/${w}/entities/${id}`)).data;
  assert.equal(e.name, "Port");
});

test("relations : inverses, déductions transitives, boucle refusée, doublon symétrique", async () => {
  const w = await world("Rel");
  const mk = async (name: string) => (await s.api("POST", `/api/worlds/${w}/entities`, { name })).data.id as number;
  const [ville, pays, continent] = [await mk("Ville"), await mk("Pays"), await mk("Continent")];
  const inside = await relType(w, "situé dans");
  assert.equal((await s.api("POST", `/api/worlds/${w}/relations`, { typeId: inside, sourceId: ville, targetId: pays })).status, 201);
  assert.equal((await s.api("POST", `/api/worlds/${w}/relations`, { typeId: inside, sourceId: pays, targetId: continent })).status, 201);
  const r = (await s.api("GET", `/api/worlds/${w}/entities/${ville}/relations`)).data;
  assert.equal(r.direct[0].other.name, "Pays");
  assert.deepEqual(r.inferred.map((x: { other: { name: string }; via: string[] }) => [x.other.name, x.via]), [["Continent", ["Pays"]]]);
  const rc = (await s.api("GET", `/api/worlds/${w}/entities/${continent}/relations`)).data;
  assert.equal(rc.inverse[0].label, "contient");
  assert.equal(rc.inferred[0].label, "contient");
  const loop = await s.api("POST", `/api/worlds/${w}/relations`, { typeId: inside, sourceId: continent, targetId: ville });
  assert.equal(loop.status, 409);
  assert.match(loop.data.error, /Ville → Pays → Continent/);
  const ally = await relType(w, "allié de");
  assert.equal((await s.api("POST", `/api/worlds/${w}/relations`, { typeId: ally, sourceId: ville, targetId: pays })).status, 201);
  assert.equal((await s.api("POST", `/api/worlds/${w}/relations`, { typeId: ally, sourceId: pays, targetId: ville })).status, 409);
});

test("explorateur : curseur stable, sans doublon ni oubli au-delà d'une page", async () => {
  const w = await world("Explo");
  for (let i = 0; i < 120; i++) await s.api("POST", `/api/worlds/${w}/entities`, { name: `Fiche ${String(i % 7)}` });
  const seen = new Set<number>();
  let cursor: string | null = "";
  while (cursor !== null) {
    const page: { data: { items: { id: number }[]; nextCursor: string | null } } = await s.api("GET", `/api/worlds/${w}/entities?limit=50${cursor ? "&cursor=" + cursor : ""}`);
    for (const it of page.data.items) { assert.ok(!seen.has(it.id)); seen.add(it.id); }
    cursor = page.data.nextCursor;
  }
  assert.equal(seen.size, 120);
});

test("écriture : sections imbriquées, autosauvegarde protégée, citations et liens cassés", async () => {
  const w = await world("Écrit");
  const hero = (await s.api("POST", `/api/worlds/${w}/entities`, { name: "Héroïne" })).data.id;
  const doc = (await s.api("POST", `/api/worlds/${w}/documents`, { title: "Roman" })).data;
  const save = await s.api("PATCH", `/api/worlds/${w}/sections/${doc.sectionId}`, { expectedRevision: 1, content: `Il était une fois [[${hero}|Héroïne]] qui partit.` });
  assert.equal(save.status, 200);
  assert.equal((await s.api("PATCH", `/api/worlds/${w}/sections/${doc.sectionId}`, { expectedRevision: 1, content: "vieux" })).status, 409);
  const sub = (await s.api("POST", `/api/worlds/${w}/documents/${doc.id}/sections`, { title: "Scène", parentId: doc.sectionId })).data.id;
  await s.api("POST", `/api/worlds/${w}/documents/${doc.id}/sections`, { title: "Ch2" });
  const full = (await s.api("GET", `/api/worlds/${w}/documents/${doc.id}`)).data;
  assert.deepEqual(full.sections.map((x: { title: string; depth: number }) => [x.title, x.depth]), [["Chapitre 1", 0], ["Scène", 1], ["Ch2", 0]]);
  assert.equal((await s.api("POST", `/api/worlds/${w}/sections/${sub}/move`, { direction: "outdent" })).status, 201);
  // Renommage : les citations suivent l'identifiant, pas le texte.
  const e = (await s.api("GET", `/api/worlds/${w}/entities/${hero}`)).data;
  await s.api("PATCH", `/api/worlds/${w}/entities/${hero}`, { expectedRevision: e.revision, name: "Reine" });
  const m = (await s.api("GET", `/api/worlds/${w}/entities/${hero}/mentions`)).data;
  assert.equal(m.sections.length, 1);
  assert.equal(m.sections[0].excerpts[0].match, "Reine");
  const sec = (await s.api("GET", `/api/worlds/${w}/sections/${doc.sectionId}`)).data;
  assert.equal(sec.names[hero], "Reine");
  // Suppression : le texte reste intact, le lien n'a plus de nom (cassé).
  await s.api("DELETE", `/api/worlds/${w}/entities/${hero}`);
  const after = (await s.api("GET", `/api/worlds/${w}/sections/${doc.sectionId}`)).data;
  assert.match(after.content, /\[\[\d+\|Héroïne\]\]/);
  assert.equal(after.names[hero], undefined);
});

test("recherche : accents, plusieurs mots, expression exacte, onglets", async () => {
  const w = await world("Cherche");
  const id = (await s.api("POST", `/api/worlds/${w}/entities`, { name: "Cœur de Forêt" })).data.id;
  const e = (await s.api("GET", `/api/worlds/${w}/entities/${id}`)).data;
  await s.api("PATCH", `/api/worlds/${w}/entities/${id}`, { expectedRevision: e.revision, description: "Un arbre millénaire garde la clairière." });
  const doc = (await s.api("POST", `/api/worlds/${w}/documents`, { title: "Notes" })).data;
  await s.api("PATCH", `/api/worlds/${w}/sections/${doc.sectionId}`, { expectedRevision: 1, content: "La clairière brûle." });
  const r = (await s.api("GET", `/api/worlds/${w}/search?q=${encodeURIComponent("coeur foret")}`)).data;
  assert.equal(r.items[0].name, "Cœur de Forêt");
  const both = (await s.api("GET", `/api/worlds/${w}/search?q=clairiere`)).data;
  assert.deepEqual(both.counts, { all: 2, world: 1, writing: 1 });
  assert.equal((await s.api("GET", `/api/worlds/${w}/search?q=${encodeURIComponent('"arbre garde"')}`)).data.counts.all, 0);
  assert.equal((await s.api("GET", `/api/worlds/${w}/search?q=x`)).status, 400);
});

test("chronologie : ères, dates relatives, contradictions signalées, ère utilisée protégée", async () => {
  const w = await world("Temps");
  const eras = (await s.api("PUT", `/api/worlds/${w}/eras`, { eras: [{ name: "Ancienne", duration: 100 }, { name: "Nouvelle", duration: null, gapBefore: 10 }] })).data;
  const id = (await s.api("POST", `/api/worlds/${w}/entities`, { name: "Bataille" })).data.id;
  const span = { start: { eraId: eras[1].id, year: 5, month: null, day: null, approx: false }, end: { eraId: eras[0].id, year: 101, month: null, day: null, approx: false } };
  const up = await s.api("PATCH", `/api/worlds/${w}/entities/${id}`, { expectedRevision: 1, timeSpan: span });
  assert.equal(up.status, 200);
  assert.ok(up.data.timeProblems.some((p: string) => /fin est avant/.test(p)));
  assert.ok(up.data.timeProblems.some((p: string) => /dépasse/.test(p)));
  const chrono = (await s.api("GET", `/api/worlds/${w}/chronology`)).data;
  assert.equal(chrono.items[0].startYear, 114); // 100 ans + 10 d'écart + an 5 (débute à 1)
  assert.equal((await s.api("PUT", `/api/worlds/${w}/eras`, { eras: [{ id: eras[0].id, name: "Ancienne", duration: 100 }] })).status, 409);
});

test("publication : instantané figé, lecteur public sans brouillon", async () => {
  const w = await world("Pub");
  const id = (await s.api("POST", `/api/worlds/${w}/entities`, { name: "Version publiée" })).data.id;
  const hidden = (await s.api("POST", `/api/worlds/${w}/entities`, { name: "Brouillon" })).data.id;
  await s.api("POST", `/api/worlds/${w}/entities/${id}/publish`);
  await s.api("PATCH", `/api/worlds/${w}/entities/${id}`, { expectedRevision: 1, name: "Version de travail" });
  const pub = (await s.api("GET", `/api/public/${w}/entities/${id}`)).data;
  assert.equal(pub.name, "Version publiée");
  assert.equal((await s.api("GET", `/api/public/${w}/entities/${hidden}`)).status, 404);
  const e = (await s.api("GET", `/api/worlds/${w}/entities/${id}`)).data;
  assert.equal(e.publication.upToDate, false);
});

test("monde d'exemple, export/import aller-retour avec conversion des références", async () => {
  const ex = (await s.api("POST", "/api/worlds/example")).data.id;
  const archive = (await s.api("GET", `/api/worlds/${ex}/export`)).data;
  const json = archive;
  assert.equal(json.format, "world-building-claude");
  assert.equal(json.media.length, 1);
  const imp = await s.api("POST", "/api/worlds/import", json);
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  const nw = imp.data.id;
  assert.notEqual(nw, ex);
  const list = (await s.api("GET", `/api/worlds/${nw}/entities?q=Isolde`)).data.items;
  const isolde = (await s.api("GET", `/api/worlds/${nw}/entities/${list[0].id}`)).data;
  // Chaque lien du texte désigne une fiche du NOUVEAU monde.
  for (const id of Object.keys(isolde.names)) assert.equal((await s.api("GET", `/api/worlds/${nw}/entities/${id}`)).status, 200);
  assert.ok(Object.keys(isolde.names).length >= 3);
  assert.equal(isolde.timeLabel, "Jour 14, mois 3, an 271 de l'Ère des Couronnes");
  const maps = (await s.api("GET", `/api/worlds/${nw}/maps`)).data;
  assert.equal(maps[0].pins, 3);
  const rel = (await s.api("GET", `/api/worlds/${nw}/entities/${list[0].id}/relations`)).data;
  assert.equal(rel.direct.length, 3);
  // Archive invalide : rien n'est créé.
  const before = (await s.api("GET", "/api/worlds")).data.length;
  json.relations.push({ typeId: 999999, sourceId: 1, targetId: 2, note: "" });
  assert.equal((await s.api("POST", "/api/worlds/import", json)).status, 400);
  assert.equal((await s.api("GET", "/api/worlds")).data.length, before);
});

test("médias : format reconnu par le contenu, image utilisée protégée", async () => {
  const w = await world("Médias");
  const svg = await s.api("POST", `/api/worlds/${w}/media?name=x.png`, "<svg xmlns='http://www.w3.org/2000/svg'/>");
  assert.equal(svg.status, 400);
  const ex = (await s.api("GET", "/api/worlds")).data.find((x: { name: string }) => x.name.startsWith("Les Terres"));
  const media = (await s.api("GET", `/api/worlds/${ex.id}/media`)).data;
  assert.equal(media[0].width, 960);
  assert.equal((await s.api("DELETE", `/api/worlds/${ex.id}/media/${media[0].id}`)).status, 409);
  assert.equal((await s.api("GET", `/api/worlds/${w}/media/${media[0].id}`)).status, 404);
});

test("suppression d'un monde : nom exact exigé, tout est retiré", async () => {
  const w = await world("À jeter");
  await s.api("POST", `/api/worlds/${w}/entities`, { name: "x" });
  assert.equal((await s.api("DELETE", `/api/worlds/${w}`, { confirmName: "a jeter" })).status, 400);
  assert.equal((await s.api("DELETE", `/api/worlds/${w}`, { confirmName: "À jeter" })).status, 200);
  assert.equal((await s.api("GET", `/api/worlds/${w}`)).status, 404);
  assert.equal(Number((s.db.prepare("SELECT COUNT(*) AS n FROM entity WHERE world_id = ?").get(w) as { n: number }).n), 0);
});
