"use server";

import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { API_ROUTES } from "./apiRegistry";
import { isMockMode } from "@/lib/mode";

/**
 * Demo-mode bridge (see DECISIONS.md): Vercel puts pages and API route handlers in separate
 * serverless functions, and in demo mode each function holds its own copy of the embedded
 * database. So the UI sends its API calls through this server action, which always runs in the
 * page function, and calls the very same route handler there: same validation, RBAC and audit.
 */

export type BridgeResult = { status: number; contentType: string; text?: string; base64?: string; filename?: string; instance?: string };

function match(pathname: string): { methods: (typeof API_ROUTES)[number]["methods"]; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean);
  for (const r of API_ROUTES) {
    const pat = r.pattern.split("/").filter(Boolean);
    if (pat.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      const m = /^\[(\w+)\]$/.exec(pat[i]);
      if (m) params[m[1]] = decodeURIComponent(parts[i]);
      else if (pat[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { methods: r.methods, params };
  }
  return null;
}

export async function invokeApi(method: string, path: string, payload?: unknown): Promise<BridgeResult> {
  const { DEMO_INSTANCE } = await import("@/lib/mockdb");
  const r = await run(method, path, payload);
  return { ...r, instance: DEMO_INSTANCE };
}

async function run(method: string, path: string, payload?: unknown): Promise<BridgeResult> {
  if (!isMockMode()) return { status: 404, contentType: "application/json", text: JSON.stringify({ error: { code: "NOT_FOUND", message: "The demo bridge only runs in demo mode." } }) };
  const url = new URL(`/api/v1${path}`, "http://sentinel.local");
  const route = match(url.pathname.replace(/^\/api\/v1/, ""));
  const handler = route?.methods[method.toUpperCase()];
  if (!route || !handler) return { status: 404, contentType: "application/json", text: JSON.stringify({ error: { code: "NOT_FOUND", message: "No such endpoint." } }) };

  const h = await headers();
  const fwd = new Headers();
  for (const k of ["cookie", "x-forwarded-for", "x-real-ip", "user-agent"]) {
    const v = h.get(k);
    if (v) fwd.set(k, v);
  }
  let body: BodyInit | undefined;
  if (payload instanceof FormData) body = payload;
  else if (payload !== undefined) {
    body = JSON.stringify(payload);
    fwd.set("content-type", "application/json");
  }
  const req = new NextRequest(url, { method: method.toUpperCase(), headers: fwd, body });
  const res = await handler(req, { params: Promise.resolve(route.params) });

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const filename = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  if (/^(application\/json|text\/)/.test(contentType)) return { status: res.status, contentType, text: await res.text(), filename };
  return { status: res.status, contentType, base64: Buffer.from(await res.arrayBuffer()).toString("base64"), filename };
}
