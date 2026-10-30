/** Erreur renvoyée par l'API, avec le statut HTTP (409 = conflit, 404 = introuvable…). */
export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {},
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable. Vérifiez que l'application tourne, puis réessayez.");
  }
  const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`, data?.details);
  return data as T;
}

/** Raccourci pour les routes d'un monde. */
export const w = (wid: number, path = "") => `/api/worlds/${wid}${path}`;
export const mediaUrl = (wid: number, id: number) => `/api/worlds/${wid}/media/${id}`;
