import type { NextRequest } from "next/server";

/**
 * Fixed-window rate limiter for the public portal (ROAST.md §6). In memory, so per server
 * instance: enough to stop one client hammering a link. Behind several instances, put the same
 * limits in the load balancer or a shared store.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function hit(key: string, limit: number, windowMs: number, nowMs = Date.now()): { ok: boolean; retryAfterS: number } {
  const w = windows.get(key);
  if (!w || w.resetAt <= nowMs) {
    windows.set(key, { count: 1, resetAt: nowMs + windowMs });
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.resetAt <= nowMs) windows.delete(k);
    return { ok: true, retryAfterS: 0 };
  }
  w.count++;
  return { ok: w.count <= limit, retryAfterS: Math.ceil((w.resetAt - nowMs) / 1000) };
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** Returns a 429 response when any of the limits is exceeded, else null. */
export function limited(checks: { key: string; limit: number; windowMs: number }[]): Response | null {
  for (const c of checks) {
    const r = hit(c.key, c.limit, c.windowMs);
    if (!r.ok) {
      // Same error shape as lib/api errorResponse; kept free of the auth imports so it stays testable.
      return Response.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again." } },
        { status: 429, headers: { "Retry-After": String(r.retryAfterS) } },
      );
    }
  }
  return null;
}
