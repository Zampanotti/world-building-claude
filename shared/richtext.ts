/**
 * Format du texte éditorial (descriptions des fiches et sections d'écriture).
 *
 * Choix : un texte brut « Markdown léger » plutôt qu'un JSON d'éditeur riche.
 * Les liens vers les fiches sont écrits `[[<id>|<libellé>]]` : la référence repose
 * sur l'identifiant stable de la fiche, jamais sur une position dans le texte.
 * Le libellé n'est qu'un repli d'affichage : à l'écran, le nom actuel de la fiche
 * est utilisé, ce qui rend les liens insensibles aux renommages. Si la fiche est
 * supprimée, le texte reste intact et le lien est affiché comme cassé.
 */

export const LINK_RE = /\[\[(\d+)\|([^\]|\n]*)\]\]/g;

/** Retire les caractères qui casseraient la syntaxe d'un lien. */
export function sanitizeLabel(label: string): string {
  return label.replace(/[[\]|\n]/g, " ").replace(/\s+/g, " ").trim() || "?";
}

export function linkMarkup(id: number, label: string): string {
  return `[[${id}|${sanitizeLabel(label)}]]`;
}

/** Identifiants distincts des fiches citées dans un texte. */
export function linkedIds(text: string): number[] {
  const ids = new Set<number>();
  for (const m of text.matchAll(LINK_RE)) ids.add(Number(m[1]));
  return [...ids];
}

export type Segment = { kind: "text"; text: string } | { kind: "link"; id: number; label: string; raw: string };

/**
 * Découpe un texte en morceaux de texte brut et en liens. Recoller les `text`
 * et les `raw` dans l'ordre redonne exactement le texte d'origine : l'éditeur
 * s'en sert pour afficher les liens comme des liens sans perdre leur balisage.
 */
export function splitLinks(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "link", id: Number(m[1]), label: m[2], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/**
 * Convertit les identifiants des liens (import d'archive). Un identifiant absent
 * de la table devient 0, qui ne désigne jamais une fiche : une référence déjà
 * invalide reste invalide au lieu de pointer par hasard vers une autre fiche.
 */
export function remapLinks(text: string, map: Map<number, number>): string {
  return text.replace(LINK_RE, (_all, id: string, label: string) => `[[${map.get(Number(id)) ?? 0}|${label}]]`);
}

/** Texte lisible : liens remplacés par leur libellé, marques Markdown retirées. */
export function toPlainText(text: string, names?: Map<number, string>): string {
  return text
    .replace(LINK_RE, (_a, id: string, label: string) => names?.get(Number(id)) ?? label)
    .replace(/^(#{1,3}|>|-)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

/** Normalisation pour la recherche : casse, accents et ligatures ignorés. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Découpe une requête : mots isolés et expressions entre guillemets. */
export function parseQuery(q: string): string[] {
  const terms: string[] = [];
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = normalize((m[1] ?? m[2]).trim());
    if (t) terms.push(t);
  }
  return terms;
}

/** Extrait d'environ `radius` caractères autour d'une position, avec la zone à surligner. */
export function excerptAround(text: string, start: number, length: number, radius = 60) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, start + length + radius);
  return {
    before: (from > 0 ? "…" : "") + text.slice(from, start),
    match: text.slice(start, start + length),
    after: text.slice(start + length, to) + (to < text.length ? "…" : ""),
  };
}

export type Excerpt = ReturnType<typeof excerptAround>;

/**
 * Cherche des termes normalisés dans un texte et renvoie les extraits. La
 * normalisation peut changer la longueur (œ → oe) ; on travaille donc sur une
 * table de correspondance des positions pour surligner le texte d'origine.
 */
export function findExcerpts(text: string, terms: string[], max = 3): Excerpt[] {
  const map: number[] = [];
  let norm = "";
  for (let i = 0; i < text.length; i++) {
    const n = normalize(text[i]);
    for (let k = 0; k < n.length; k++) map.push(i);
    norm += n;
  }
  map.push(text.length);
  const out: Excerpt[] = [];
  for (const term of terms) {
    let idx = norm.indexOf(term);
    while (idx >= 0 && out.length < max) {
      const s = map[idx];
      const e = map[idx + term.length - 1] + 1;
      out.push(excerptAround(text, s, e - s));
      idx = norm.indexOf(term, idx + term.length);
      if (out.length >= max) break;
    }
  }
  return out.slice(0, max);
}
