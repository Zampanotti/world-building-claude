/** Erreur métier traduite en réponse HTTP (message en français pour l'interface). */
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (msg = "Introuvable.") => new HttpError(404, msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);

/** Lecture validée des champs d'un corps JSON. */
export function str(v: unknown, field: string, { max = 200, allowEmpty = false } = {}): string {
  if (typeof v !== "string") throw bad(`Champ « ${field} » manquant.`);
  const s = v.trim();
  if (!allowEmpty && !s) throw bad(`Le champ « ${field} » ne peut pas être vide.`);
  if (s.length > max) throw bad(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
}

export function int(v: unknown, field: string): number {
  if (typeof v === "string" && /^-?\d+$/.test(v)) v = Number(v);
  if (!Number.isSafeInteger(v)) throw bad(`Champ « ${field} » invalide.`);
  return v as number;
}

export function optInt(v: unknown, field: string): number | null {
  return v === null || v === undefined || v === "" ? null : int(v, field);
}

export function color(v: unknown): string {
  if (v === undefined) return "#64748b";
  if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad("Couleur invalide.");
  return v;
}
