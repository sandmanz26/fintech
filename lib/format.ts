import { formatMoney } from "@/lib/money";

/** Display helpers. Stored values are UTC; these render in the viewer's time zone. */

export { formatMoney };

export function fmtPct(ratio: number | null | undefined, digits = 2): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

export function fmtInt(n: number | bigint | null | undefined, locale = "en-US"): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(locale).format(n as number);
}

export function fmtDate(d: Date | string | null | undefined, tz = "UTC", locale = "en-US"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { timeZone: tz, year: "numeric", month: "short", day: "numeric" }).format(new Date(d));
}

export function fmtIsoDate(d: Date | string | null | undefined, tz = "UTC"): string {
  if (!d) return "—";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return p;
}

export function fmtDateTime(d: Date | string | null | undefined, tz = "UTC", locale = "en-US"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(d));
}

export function fmtTime(d: Date | string, tz = "UTC"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
}

/** "3 h 20 m", "2 d 4 h", "45 m" */
export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
  if (h >= 1) return `${h} h${m % 60 ? ` ${m % 60} m` : ""}`;
  return `${Math.max(1, m)} m`;
}

/** Relative age in words: "Today", "Yesterday", "6 days ago". */
export function fmtAgo(d: Date | string, now: Date): string {
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(new Date(d)).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type SlaState = { kind: "breached" | "soon" | "ok" | "done"; text: string };

export function slaState(due: Date | string, now: Date, resolved = false): SlaState {
  if (resolved) return { kind: "done", text: "Resolved" };
  const diff = new Date(due).getTime() - now.getTime();
  if (diff < 0) return { kind: "breached", text: `Breached ${fmtDuration(diff)} ago` };
  if (diff < 2 * 3_600_000) return { kind: "soon", text: `${fmtDuration(diff)} left` };
  return { kind: "ok", text: `${fmtDuration(diff)} left` };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Mask PII for list views: "•••• 4821", "••/••/1984". */
export function maskId(v: string | null | undefined): string {
  if (!v) return "—";
  return `•••• ${v.slice(-4)}`;
}
export function maskDob(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `••/••/${new Date(d).getUTCFullYear()}`;
}

export function humanize(code: string): string {
  const s = code.toLowerCase().replace(/_/g, " ");
  return s[0].toUpperCase() + s.slice(1);
}
