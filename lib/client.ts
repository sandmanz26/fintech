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

/** Demo mode is flagged on <html data-demo>; API calls then go through the server-action bridge. */
export const inDemo = () => typeof document !== "undefined" && document.documentElement.dataset.demo === "1";

/** One API call, either over HTTP or, in demo mode, through the bridge (lib/demo/bridge.ts). */
export async function apiRaw(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; contentType: string; text?: string; blob?: Blob; filename?: string }> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  if (inDemo()) {
    const { invokeApi } = await import("@/lib/demo/bridge");
    const r = await invokeApi(method, path, init.body);
    const blob = r.base64 !== undefined ? new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: r.contentType }) : undefined;
    return { status: r.status, contentType: r.contentType, text: r.text, blob, filename: r.filename };
  }
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: init.body !== undefined && !isForm ? { "content-type": "application/json" } : undefined,
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (/^(application\/json|text\/)/.test(contentType)) return { status: res.status, contentType, text: await res.text() };
  return { status: res.status, contentType, blob: await res.blob() };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await apiRaw(path, init);
  const data = res.text ? JSON.parse(res.text) : null;
  if (res.status >= 400) {
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
