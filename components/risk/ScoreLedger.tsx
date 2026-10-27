import type { FactorResult } from "@/lib/domain/scoring";
import type { RiskBand } from "@prisma/client";
import { BandPill } from "@/components/ui/badges";
import { fmtDate, humanize } from "@/lib/format";

/**
 * Sentinel's signature element (DESIGN.md §2.1): the risk score drawn as an addition.
 * Contributing factors first, largest first; zero-point factors fold into one line.
 * Hard stops print above the sum because they override the arithmetic.
 */
export function ScoreLedger({
  score,
  band,
  factors,
  hardStops,
  bands,
  policyVersion,
  createdAt,
  trigger,
  previous,
  tz,
  compact = false,
}: {
  score: number;
  band: RiskBand;
  factors: FactorResult[];
  hardStops: { key: string; label: string }[];
  bands: { mediumFrom: number; highFrom: number };
  policyVersion: number;
  createdAt: Date;
  trigger: string;
  previous?: { score: number; band: RiskBand; createdAt: Date } | null;
  tz: string;
  compact?: boolean;
}) {
  const contributing = factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points);
  const zero = factors.filter((f) => f.points === 0);
  const delta = previous ? score - previous.score : null;
  const words = (e: string) => e.replace(/\s*->\s*[+-]?\d+$/, "");
  return (
    <section className="panel" aria-labelledby="score-h" data-testid="score-ledger">
      <header>
        <div>
          <h2 id="score-h">Risk score</h2>
          <div className="meta">
            Policy v{policyVersion} · {humanize(trigger)} · {fmtDate(createdAt, tz)}
          </div>
        </div>
        <BandPill band={band} />
      </header>

      {hardStops.length ? (
        <div role="alert" style={{ background: "var(--pill-ink-bg)", color: "var(--pill-ink-ink)", borderRadius: 6, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>Hard stop: prohibited regardless of score</div>
          {hardStops.map((h) => (
            <div key={h.key} style={{ fontSize: 13 }}>{h.label}</div>
          ))}
        </div>
      ) : null}

      <ol aria-label="Factors that added points" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {contributing.map((f) => (
          <li key={f.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 64px 72px", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{f.label}</div>
              {!compact ? <div className="muted" style={{ fontSize: 12, lineHeight: "16px" }}>{words(f.explanation)}</div> : null}
            </div>
            <div aria-hidden style={{ height: 4, background: "var(--rule)", borderRadius: 2 }}>
              <div style={{ width: `${(f.points / f.maxPoints) * 100}%`, height: 4, background: "var(--text)", borderRadius: 2 }} />
            </div>
            <div className="money" style={{ textAlign: "right" }}>
              +{f.points}
              <span className="muted"> /{f.maxPoints}</span>
            </div>
          </li>
        ))}
      </ol>
      {zero.length ? (
        <details style={{ borderTop: "1px solid var(--rule)", padding: "8px 0" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            {zero.length} factors added nothing
          </summary>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {zero.map((f) => (
              <li key={f.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 13 }}>
                <span className="muted">{words(f.explanation)}</span>
                <span className="money muted">0</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 2 }}>
        <span style={{ fontWeight: 600 }}>Total</span>
        <span>
          <span className="money" style={{ fontSize: 24, fontWeight: 600 }} data-testid="score-total">{score}</span>
          <span className="money muted"> /100</span>
        </span>
      </div>
      <BandStrip score={score} bands={bands} prohibited={band === "PROHIBITED"} />
      <div className="meta" style={{ marginTop: 6 }}>
        {previous && delta !== null
          ? delta === 0
            ? `Unchanged since ${fmtDate(previous.createdAt, tz)}`
            : `${delta > 0 ? "+" : ""}${delta} since ${fmtDate(previous.createdAt, tz)} (was ${previous.score}, ${previous.band.toLowerCase()})`
          : "First assessment"}
      </div>
    </section>
  );
}

/** 0-100 strip with the policy's band thresholds and the score marked in the data hue. */
export function BandStrip({ score, bands, prohibited }: { score: number; bands: { mediumFrom: number; highFrom: number }; prohibited?: boolean }) {
  const segs = [
    { from: 0, to: bands.mediumFrom, fill: "var(--pill-neutral-bg)", label: "Low" },
    { from: bands.mediumFrom, to: bands.highFrom, fill: "var(--pill-warning-bg)", label: "Medium" },
    { from: bands.highFrom, to: 100, fill: "var(--pill-negative-bg)", label: "High" },
  ];
  return (
    <div style={{ marginTop: 10 }} role="img" aria-label={`Score ${score} of 100. Medium from ${bands.mediumFrom}, high from ${bands.highFrom}.${prohibited ? " A hard stop makes it prohibited." : ""}`}>
      <div style={{ position: "relative", height: 10, display: "flex", gap: 2 }}>
        {segs.map((s) => (
          <div key={s.label} style={{ flex: s.to - s.from, background: s.fill, borderRadius: 2 }} />
        ))}
        <div style={{ position: "absolute", left: `calc(${Math.min(100, score)}% - 1px)`, top: -3, width: 3, height: 16, background: "var(--data)", borderRadius: 2 }} />
      </div>
      <div style={{ position: "relative", height: 16, fontSize: 11 }} className="muted">
        <span style={{ position: "absolute", left: 0 }}>0</span>
        <span style={{ position: "absolute", left: `${bands.mediumFrom}%`, transform: "translateX(-50%)" }}>{bands.mediumFrom}</span>
        <span style={{ position: "absolute", left: `${bands.highFrom}%`, transform: "translateX(-50%)" }}>{bands.highFrom}</span>
        <span style={{ position: "absolute", right: 0 }}>100</span>
      </div>
    </div>
  );
}
