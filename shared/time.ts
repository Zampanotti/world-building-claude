/**
 * Modèle temporel des mondes.
 *
 * Un monde définit des ères ordonnées. Chaque ère a une durée en années
 * (facultative pour la dernière, qui est « en cours ») et un écart éventuel
 * après la fin de la précédente. Les dates des fiches sont relatives à une ère ;
 * aucune année absolue n'est stockée : elle est recalculée à l'affichage, donc
 * modifier une durée ne réécrit aucune date enregistrée.
 */

export interface Era {
  id: number;
  name: string;
  position: number;
  duration: number | null;
  gapBefore: number;
  color: string;
}

export interface DatePoint {
  eraId: number;
  /** null : « durant l'ère » ; > 0 : an N de l'ère ; < 0 : N ans avant l'ère. Jamais 0. */
  year: number | null;
  month: number | null;
  day: number | null;
  approx: boolean;
}

export interface TimeSpan {
  start: DatePoint;
  end: DatePoint | null;
}

/** Année absolue de début de chaque ère (la première commence à 0). */
export function eraStarts(eras: Era[]): Map<number, number> {
  const sorted = [...eras].sort((a, b) => a.position - b.position);
  const starts = new Map<number, number>();
  let cursor = 0;
  sorted.forEach((era, i) => {
    if (i > 0) cursor += era.gapBefore;
    starts.set(era.id, cursor);
    cursor += era.duration ?? 0;
  });
  return starts;
}

/** Clé de tri absolue d'une date ; null si l'ère n'existe plus. */
export function absoluteKey(p: DatePoint, starts: Map<number, number>): number | null {
  const start = starts.get(p.eraId);
  if (start === undefined) return null;
  const year = p.year === null ? start : p.year > 0 ? start + p.year - 1 : start + p.year;
  return year * 10000 + (p.month ?? 0) * 100 + (p.day ?? 0);
}

export function absoluteYear(p: DatePoint, starts: Map<number, number>): number | null {
  const k = absoluteKey(p, starts);
  return k === null ? null : Math.floor(k / 10000);
}

export function formatPoint(p: DatePoint, eras: Era[]): string {
  const era = eras.find((e) => e.id === p.eraId);
  const eraName = era ? era.name : "ère supprimée";
  let s: string;
  if (p.year === null) s = `durant ${eraName}`;
  else if (p.year < 0) s = `${-p.year} an${p.year < -1 ? "s" : ""} avant ${eraName}`;
  else s = `an ${p.year} de ${eraName}`;
  if (p.day && p.month) s = `jour ${p.day}, mois ${p.month}, ${s}`;
  else if (p.month) s = `mois ${p.month}, ${s}`;
  return (p.approx ? "≈ " : "") + s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatSpan(span: TimeSpan, eras: Era[]): string {
  const a = formatPoint(span.start, eras);
  return span.end ? `${a} → ${formatPoint(span.end, eras)}` : a;
}

/** Contradictions signalées sans jamais corriger les données. */
export function spanProblems(span: TimeSpan, eras: Era[]): string[] {
  const starts = eraStarts(eras);
  const problems: string[] = [];
  for (const [label, p] of [["début", span.start], ["fin", span.end]] as const) {
    if (!p) continue;
    const era = eras.find((e) => e.id === p.eraId);
    if (!era) problems.push(`L'ère de la date de ${label} n'existe plus.`);
    else if (era.duration !== null && p.year !== null && p.year > era.duration) {
      const last = [...eras].sort((x, y) => y.position - x.position)[0];
      // La dernière ère est en cours : une date au-delà de sa durée n'est pas une erreur.
      if (last.id !== era.id) problems.push(`La date de ${label} dépasse la durée de l'ère « ${era.name} » (${era.duration} ans).`);
    }
  }
  if (span.end) {
    const a = absoluteKey(span.start, starts);
    const b = absoluteKey(span.end, starts);
    if (a !== null && b !== null && b < a) problems.push("La fin est avant le début.");
  }
  return problems;
}

/** Validation stricte d'une date reçue du navigateur ; message d'erreur ou null. */
export function validatePoint(p: unknown): string | null {
  if (!p || typeof p !== "object") return "Date invalide.";
  const d = p as Record<string, unknown>;
  if (!Number.isInteger(d.eraId)) return "Ère manquante.";
  if (d.year !== null && (!Number.isInteger(d.year) || d.year === 0 || Math.abs(d.year as number) > 1e7)) return "L'année doit être un entier non nul.";
  for (const k of ["month", "day"] as const) {
    if (d[k] !== null && (!Number.isInteger(d[k]) || (d[k] as number) < 1 || (d[k] as number) > 99)) return `Le ${k === "month" ? "mois" : "jour"} doit être entre 1 et 99.`;
  }
  if (d.day !== null && d.month === null) return "Un jour exige un mois.";
  if (typeof d.approx !== "boolean") return "Date invalide.";
  return null;
}
