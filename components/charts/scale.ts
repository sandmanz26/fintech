/** Round, even ticks with the top tick above the maximum (app-screens §6.3). */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * mag >= raw) ?? 10) * mag;
  let top = Math.ceil(max / step) * step;
  if (top <= max) top += step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export type Fmt = "money" | "pct" | "count" | "ratio";

/** Compact axis labels in the text face: $12K, 1.2%, 340. Values are minor units for money. */
export function axisLabel(v: number, fmt: Fmt): string {
  if (fmt === "money") {
    const major = v / 100;
    if (major >= 1_000_000) return `$${(major / 1_000_000).toFixed(major % 1_000_000 ? 1 : 0)}M`;
    if (major >= 1_000) return `$${(major / 1_000).toFixed(major % 1_000 ? 1 : 0)}K`;
    return `$${major.toFixed(0)}`;
  }
  if (fmt === "pct" || fmt === "ratio") return `${(v * 100).toFixed(v * 100 < 1 && v !== 0 ? 2 : 1).replace(/\.0+$/, "")}%`;
  return Intl.NumberFormat("en-US", { notation: v >= 10_000 ? "compact" : "standard" }).format(v);
}

export function valueLabel(v: number | null, fmt: Fmt): string {
  if (v === null || Number.isNaN(v)) return "—";
  if (fmt === "money") return `$${(v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (fmt === "pct" || fmt === "ratio") return `${(v * 100).toFixed(2)}%`;
  return v.toLocaleString("en-US");
}

export function shortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
