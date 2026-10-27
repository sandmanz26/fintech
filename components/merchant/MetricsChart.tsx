"use client";

import { useState } from "react";
import { TimeSeries, type Marker } from "@/components/charts/TimeSeries";

type Row = { date: string; volume: number; settled: number; chargebacks: number; refunds: number; cbRatio30: number | null; declines: number; attempts: number };

const METRICS = [
  { key: "volume", label: "Volume", fmt: "money" as const, kind: "line" as const },
  { key: "cb", label: "Chargeback ratio", fmt: "ratio" as const, kind: "line" as const },
  { key: "refunds", label: "Refunds", fmt: "count" as const, kind: "bar" as const },
  { key: "declines", label: "Decline rate", fmt: "ratio" as const, kind: "line" as const },
];

/** 90 days, one metric at a time (switched, never overlaid), with alerts and controls marked. */
export function MetricsChart({ rows, markers, networkThreshold, networkLabel }: { rows: Row[]; markers: Marker[]; networkThreshold: number; networkLabel: string }) {
  const [metric, setMetric] = useState("volume");
  const m = METRICS.find((x) => x.key === metric)!;
  const data = rows.map((r) => ({
    date: r.date,
    value: metric === "volume" ? r.volume : metric === "cb" ? r.cbRatio30 : metric === "refunds" ? r.refunds : r.attempts ? r.declines / r.attempts : null,
  }));
  return (
    <section className="panel" aria-labelledby="chart-h">
      <header style={{ flexWrap: "wrap" }}>
        <div>
          <h2 id="chart-h">Last 90 days</h2>
          <div className="meta">{metric === "cb" ? "Rolling 30-day ratio of chargebacks received to settled sales" : "Daily, settled sales"} · ticks mark alerts and controls</div>
        </div>
        <div className="segmented" role="group" aria-label="Metric">
          {METRICS.map((x) => (
            <button key={x.key} type="button" aria-pressed={metric === x.key} onClick={() => setMetric(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
      </header>
      <TimeSeries
        label={`${m.label}, last 90 days`}
        fmt={m.fmt}
        kind={m.kind}
        data={data}
        markers={markers}
        height={220}
        reference={metric === "cb" ? { value: networkThreshold, label: `Network line ${(networkThreshold * 100).toFixed(1)}% · ${networkLabel.toLowerCase()}` } : undefined}
      />
    </section>
  );
}
