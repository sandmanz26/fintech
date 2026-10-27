"use client";

import { useId, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot } from "recharts";
import { niceTicks, axisLabel, valueLabel, shortDate, type Fmt } from "./scale";

export type Point = { date: string; value: number | null; compare?: number | null };
export type Marker = { date: string; label: string; kind: "alert" | "control" };

/**
 * One question, one series (app-screens §6). Straight segments, 3-5 faint gridlines, no y-axis
 * line, round ticks above the maximum, events annotated as 1px markers. Every chart carries a
 * data table for screen readers and a "Show table" toggle for everyone.
 */
export function TimeSeries({
  data,
  fmt,
  kind = "line",
  height = 200,
  markers = [],
  reference,
  label,
  compareLabel,
  highlightFrom,
}: {
  data: Point[];
  fmt: Fmt;
  kind?: "line" | "bar";
  height?: number;
  markers?: Marker[];
  reference?: { value: number; label: string };
  label: string;
  compareLabel?: string;
  highlightFrom?: string;
}) {
  const [table, setTable] = useState(false);
  const id = useId();
  const max = Math.max(0, ...data.map((d) => Math.max(d.value ?? 0, d.compare ?? 0)), reference?.value ?? 0);
  const ticks = useMemo(() => niceTicks(max, 4), [max]);
  const xTicks = useMemo(() => {
    if (data.length <= 6) return data.map((d) => d.date);
    const step = Math.ceil(data.length / 6);
    const out: string[] = [];
    for (let i = data.length - 1; i >= 0; i -= step) out.unshift(data[i].date);
    return out;
  }, [data]);
  // Group markers per date so labels never stack on one line.
  const byDate = new Map<string, Marker[]>();
  for (const m of markers) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const shownMarkers = [...byDate.entries()].filter(([d]) => data.some((p) => p.date === d)).sort(([a], [b]) => a.localeCompare(b));
  // Labels never collide: a marker is labelled only if it sits far enough from the last labelled
  // one (about a seventh of the plot); the rest keep their tick and show in the tooltip.
  const labelled = new Set<string>();
  {
    const idx = new Map(data.map((p, i) => [p.date, i]));
    const gap = Math.max(1, Math.round(data.length / 7));
    let last = -Infinity;
    for (const [d] of shownMarkers) {
      const i = idx.get(d)!;
      if (i - last >= gap) {
        labelled.add(d);
        last = i;
      }
    }
  }
  const allZero = data.every((d) => !d.value);

  return (
    <figure style={{ margin: 0 }} aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only" style={srOnly}>
        {label}
      </figcaption>
      {table ? (
        <div className="table-wrap" style={{ maxHeight: height + 40, overflow: "auto" }}>
          <DataTable data={data} fmt={fmt} label={label} compareLabel={compareLabel} />
        </div>
      ) : (
        <div style={{ height }} aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: shownMarkers.length ? 22 : 6, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="date" ticks={xTicks} tickFormatter={shortDate} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval={0} minTickGap={8} />
              <YAxis ticks={ticks} domain={[0, ticks.at(-1)!]} tickFormatter={(v) => axisLabel(v, fmt)} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                cursor={{ stroke: "var(--control)", strokeDasharray: "3 3" }}
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Point;
                  const ms = byDate.get(p.date) ?? [];
                  return (
                    <div className="menu" style={{ minWidth: 0, padding: "6px 10px", fontSize: 12 }}>
                      <div className="muted">{shortDate(p.date)}</div>
                      <div className="num" style={{ fontWeight: 500 }}>{valueLabel(p.value, fmt)}</div>
                      {p.compare !== undefined && compareLabel ? <div className="num muted">{compareLabel}: {valueLabel(p.compare ?? null, fmt)}</div> : null}
                      {ms.map((m, i) => (
                        <div key={i}>{m.kind === "alert" ? "Alert" : "Control"}: {m.label}</div>
                      ))}
                    </div>
                  );
                }}
              />
              {reference ? (
                <ReferenceLine y={reference.value} stroke="var(--negative)" strokeDasharray="4 3" label={{ value: reference.label, position: "insideTopRight", fill: "var(--negative)", fontSize: 12 }} />
              ) : null}
              {highlightFrom ? <ReferenceLine x={highlightFrom} stroke="var(--control)" /> : null}
              {shownMarkers.map(([d, ms]) => (
                <ReferenceLine
                  key={d}
                  x={d}
                  stroke={ms.some((m) => m.kind === "alert") ? "var(--muted)" : "var(--control)"}
                  strokeWidth={1}
                  label={labelled.has(d) ? { value: ms.length > 1 ? `${ms.length} events` : ms[0].label.toLowerCase().slice(0, 16), position: "top", fill: "var(--muted)", fontSize: 11 } : undefined}
                />
              ))}
              {kind === "bar" ? (
                <Bar dataKey="value" fill="var(--data)" isAnimationActive={false} maxBarSize={14} />
              ) : (
                <Line type="linear" dataKey="value" stroke="var(--data)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
              )}
              {data.some((d) => d.compare !== undefined) ? (
                <Line type="linear" dataKey="compare" stroke="var(--chart-muted)" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 3" />
              ) : null}
              {allZero ? <ReferenceDot x={data[0]?.date} y={0} r={0} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" className="link meta" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {!table ? (
        <div style={srOnly}>
          <DataTable data={data} fmt={fmt} label={label} compareLabel={compareLabel} />
        </div>
      ) : null}
    </figure>
  );
}

function DataTable({ data, fmt, label, compareLabel }: { data: Point[]; fmt: Fmt; label: string; compareLabel?: string }) {
  return (
    <table className="data">
      <caption style={srOnly}>{label}</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col" className="n">Value</th>
          {compareLabel ? <th scope="col" className="n">{compareLabel}</th> : null}
        </tr>
      </thead>
      <tbody>
        {[...data].reverse().map((d) => (
          <tr key={d.date}>
            <td className="num">{d.date}</td>
            <td className="n num">{valueLabel(d.value, fmt)}</td>
            {compareLabel ? <td className="n num">{valueLabel(d.compare ?? null, fmt)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 };
