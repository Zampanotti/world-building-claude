import { openDb } from "../server/db.ts";
import { createApp } from "../server/main.ts";
import type { AddressInfo } from "node:net";

/** Serveur complet sur une base en mémoire et un port libre. */
export async function startServer() {
  const db = openDb(":memory:");
  const server = createApp(db, { dataDir: null });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const ct = res.headers.get("content-type") ?? "";
    return { status: res.status, data: ct.includes("json") ? await res.json() : await res.arrayBuffer() } as { status: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { db, api, close: () => new Promise((r) => server.close(r)) };
}
