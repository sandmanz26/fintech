/** Browser-side API helper: JSON in/out, the PRD error envelope surfaced as an Error. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? "ERROR", e.message ?? `Request failed (${res.status})`, e.details);
  }
  return data as T;
}

/** Minor-unit string from a major-unit input ("1,250.50" -> "125050"); null when invalid. */
export function toMinor(input: string): string | null {
  const clean = input.replace(/[,\s$]/g, "");
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(clean);
  if (!m) return null;
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
}

export function fromMinor(minor: string | number | bigint): string {
  const v = BigInt(minor);
  const whole = v / 100n;
  const frac = (v % 100n).toString().padStart(2, "0");
  return frac === "00" ? whole.toString() : `${whole}.${frac}`;
}
