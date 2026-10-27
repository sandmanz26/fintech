import Link from "next/link";
import { portfolioSummary } from "@/lib/queries/portfolio";
import { requireStaff, viewerTz } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtPct, humanize } from "@/lib/format";
import { BandPill, SeverityPill } from "@/components/ui/badges";
import { CONTROL_LABEL, controlSummary } from "@/lib/domain/controls/text";

export const metadata = { title: "Portfolio" };

const BAND_FILL: Record<string, string> = { LOW: "var(--pill-neutral-bg)", MEDIUM: "var(--pill-warning-bg)", HIGH: "var(--pill-negative-bg)", PROHIBITED: "var(--pill-ink-bg)" };

/** "Where is our exposure, and who is close to a network threshold?" (DESIGN.md §3) */
export default async function PortfolioPage() {
  await requireStaff();
  const [p, tz] = await Promise.all([portfolioSummary(), viewerTz()]);
  const m = (v: bigint) => formatMoney(v, p.currency);
  const coverage = p.totals.exposure ? Number((p.totals.reserve * 1000n) / p.totals.exposure) / 1000 : 0;
  const { lines, portfolioNetwork: pn } = p;
  const earlyShare = lines.vampWarning / lines.vampLine;
  const pastWarning = p.network.filter((n) => n.share >= earlyShare);
  const maxExposure = p.bands.reduce((a, b) => (b.exposure > a ? b.exposure : a), 1n);
  const pv = pn.vamp30.ratio;
  const acquirerTier = pv === null ? null : pv >= lines.acquirerExcessive ? "excessive" : pv >= lines.acquirerAboveStandard ? "above standard" : null;
  const finding =
    `${pastWarning.length ? `${pastWarning.length} merchant${pastWarning.length === 1 ? " is" : "s are"}` : "No merchant is"} past the early-warning line on Visa or Mastercard. ` +
    `Portfolio Visa VAMP is ${fmtPct(pv)}${acquirerTier ? `, in the acquirer's ${acquirerTier} tier` : pv !== null && pv >= lines.acquirerAboveStandard * earlyShare ? `, close to the acquirer's ${fmtPct(lines.acquirerAboveStandard, 1)} line` : `, under the acquirer's ${fmtPct(lines.acquirerAboveStandard, 1)} line`}; reserves cover ${fmtPct(coverage, 0)} of total exposure.`;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Portfolio</h1>
          <div className="sub" data-testid="portfolio-finding">{finding}</div>
        </div>
        <div className="row-gap">
          <span className="meta">As of {fmtDate(p.today, tz)}</span>
          <ReportsMenu />
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Total exposure</div><div className="kpi-value money">{m(p.totals.exposure)}</div><div className="kpi-sub">future delivery + dispute window</div></div>
        <div className="kpi"><div className="kpi-label">Reserve held</div><div className="kpi-value money">{m(p.totals.reserve)}</div><div className="kpi-sub">covers {fmtPct(coverage, 0)}</div></div>
        <div className="kpi"><div className="kpi-label">Volume, 30 days</div><div className="kpi-value money">{m(p.totals.volume30)}</div><div className="kpi-sub">{p.totals.merchants} merchants processing</div></div>
        <div className="kpi" title={`${lines.label}. The sponsor acquirer is assessed on the whole portfolio.`}>
          <div className="kpi-label">Portfolio Visa VAMP, 30 days</div>
          <div className="kpi-value num" style={{ color: acquirerTier || (pv !== null && pv >= lines.acquirerAboveStandard * earlyShare) ? "var(--negative)" : undefined }}>{fmtPct(pv)}</div>
          <div className="kpi-sub num">acquirer lines {fmtPct(lines.acquirerAboveStandard, 1)} / {fmtPct(lines.acquirerExcessive, 1)} · {pn.vampLastMonth.basis} {fmtPct(pn.vampLastMonth.ratio)}</div>
        </div>
        <div className="kpi"><div className="kpi-label">Past an early-warning line</div><div className="kpi-value num" style={{ color: pastWarning.length ? "var(--negative)" : undefined }}>{pastWarning.length}</div><div className="kpi-sub">{fmtPct(earlyShare, 0)} of the Visa or Mastercard line</div></div>
      </div>



      <div className="grid-2-1" style={{ marginBottom: 16, alignItems: "stretch" }}>
        <section className="panel" aria-labelledby="exp-h">
          <header>
            <div>
              <h2 id="exp-h">Exposure against reserve, by band</h2>
              <div className="meta">Bar length is exposure; the blue part is the reserve held against it</div>
            </div>
          </header>
          <table className="data" style={{ marginLeft: -20, marginRight: -20, width: "calc(100% + 40px)" }}>
            <thead>
              <tr><th>Band</th><th className="n">Merchants</th><th style={{ width: "34%" }}><span className="sr-only">Exposure bar</span></th><th className="n">Exposure</th><th className="n">Reserve</th><th className="n">Covered</th></tr>
            </thead>
            <tbody>
              {p.bands.map((b) => (
                <tr key={b.band}>
                  <td><BandPill band={b.band} /></td>
                  <td className="n num">{b.merchants}</td>
                  <td aria-hidden>
                    <div style={{ position: "relative", height: 10, width: `${Math.max(2, Number((b.exposure * 1000n) / maxExposure) / 10)}%`, background: "var(--active)", borderRadius: 2 }}>
                      <div style={{ position: "absolute", left: 0, top: 2, height: 6, width: `${b.exposure ? Math.min(100, Number((b.reserve * 1000n) / b.exposure) / 10) : 0}%`, background: "var(--data)", borderRadius: 2 }} />
                    </div>
                  </td>
                  <td className="n money">{m(b.exposure)}</td>
                  <td className="n money" style={{ color: b.reserve ? undefined : "var(--muted)" }}>{m(b.reserve)}</td>
                  <td className="n num">{b.exposure ? fmtPct(Number((b.reserve * 1000n) / b.exposure) / 1000, 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 600, borderTop: "1px solid var(--border)" }}>Total</td>
                <td className="n num" style={{ borderTop: "1px solid var(--border)" }}>{p.totals.merchants}</td>
                <td style={{ borderTop: "1px solid var(--border)" }} />
                <td className="n money" style={{ fontWeight: 600, borderTop: "1px solid var(--border)" }}>{m(p.totals.exposure)}</td>
                <td className="n money" style={{ fontWeight: 600, borderTop: "1px solid var(--border)" }}>{m(p.totals.reserve)}</td>
                <td className="n num" style={{ fontWeight: 600, borderTop: "1px solid var(--border)" }}>{fmtPct(coverage, 0)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="meta" style={{ margin: "10px 0 0" }}>Exposure per merchant = ADV × delivery days + ADV × {"dispute window"} × (chargeback + refund rate), the same formula as each merchant&apos;s calculator.</p>
        </section>
        <section className="panel" aria-labelledby="net-h" data-testid="network-watchlist">
          <header>
            <div>
              <h2 id="net-h">Network watchlist</h2>
              <div className="meta">Visa VAMP over 30 days and Mastercard ECM this month, each against its own line · {lines.label.toLowerCase()} · {lines.warningMinCount} counts or more</div>
            </div>
          </header>
          {p.network.length ? (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {p.network.slice(0, 6).map((n) => {
                const watched = n.share >= 0.5;
                const visaLeads = n.vampShare >= n.ecmShare;
                const lead = visaLeads ? { name: "Visa VAMP", ratio: n.vamp.ratio, share: n.vampShare } : { name: "Mastercard ECM", ratio: n.ecm.ratio, share: n.ecmShare };
                const other = visaLeads ? `Mastercard, ${n.ecm.basis} ${fmtPct(n.ecm.ratio)}` : `Visa, 30 days ${fmtPct(n.vamp.ratio)}`;
                return (
                  <li key={n.id} style={{ padding: "8px 0", borderTop: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <Link className="link truncate" href={`/merchants/${n.id}`} style={{ color: watched ? undefined : "var(--muted)", fontWeight: watched ? 500 : 400 }}>{n.name}</Link>
                      <span className="num" style={{ flex: "none" }}>{lead.name} {fmtPct(lead.ratio)}</span>
                    </div>
                    <div aria-hidden style={{ position: "relative", height: 6, marginTop: 6, background: "var(--rule)", borderRadius: 2 }}>
                      <div style={{ height: 6, width: `${Math.min(100, (n.share / 1.25) * 100)}%`, background: n.share >= earlyShare ? "var(--negative)" : watched ? "var(--text)" : "var(--chart-muted)", borderRadius: 2 }} />
                      {[0.5, earlyShare, 1].map((t) => (
                        <span key={t} style={{ position: "absolute", left: `${(t / 1.25) * 100}%`, top: -3, width: 1, height: 12, background: t === 1 ? "var(--text)" : "var(--control)" }} />
                      ))}
                    </div>
                    <div className="meta num" style={{ marginTop: 4 }}>{Math.round(lead.share * 100)}% of the {visaLeads ? "Visa" : "Mastercard"} line · {other} · {fmtPct(n.contribution, 0)} of the portfolio&apos;s Visa count</div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="empty">No merchant has {lines.warningMinCount} or more Visa fraud reports and disputes in 30 days, or Mastercard chargebacks this month.</div>
          )}
          <div className="meta" style={{ marginTop: 8 }}>Ticks at 50%, {fmtPct(earlyShare, 0)} and 100% of the line. Below 50% in grey, for reference.</div>
          {p.contributors.length ? (
            <div style={{ marginTop: 14 }} data-testid="vamp-contributors">
              <h3 style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px" }}>Largest contributors to portfolio VAMP</h3>
              <div className="meta" style={{ marginBottom: 4 }}>
                {pn.vamp30.count.toLocaleString()} Visa fraud reports and disputes over {pn.vamp30.denominator.toLocaleString()} card-not-present sales, 30 days
              </div>
              {p.contributors.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
                  <Link className="link truncate" href={`/merchants/${c.id}`}>{c.name}</Link>
                  <span className="num" style={{ flex: "none" }}>{fmtPct(c.contribution, 0)} <span className="meta">{c.vamp.count}</span></span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
      <div className="grid-1-1" style={{ marginBottom: 16, alignItems: "stretch" }}>
        <section className="panel" aria-labelledby="band-h">
          <header>
            <div>
              <h2 id="band-h">Merchants by band</h2>
              <div className="meta">From assessment history</div>
            </div>
          </header>
          <table className="data" style={{ marginLeft: -20, marginRight: -20, width: "calc(100% + 40px)" }}>
            <thead><tr><th>Band</th>{p.trend.map((t) => <th key={t.daysAgo} className="n">{t.daysAgo ? `${t.daysAgo} d ago` : "Today"}</th>)}<th className="n">Change</th></tr></thead>
            <tbody>
              {p.bands.map((b) => (
                <tr key={b.band}>
                  <td style={{ whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: BAND_FILL[b.band], boxShadow: "inset 0 0 0 1px var(--control)", marginRight: 8 }} />{humanize(b.band)}</td>
                  {p.trend.map((t, i) => (
                    <td key={t.daysAgo} className="n num" style={{ fontWeight: i === p.trend.length - 1 ? 600 : 400 }}>{t.counts[b.band]}</td>
                  ))}
                  <td className="n num muted">{(() => { const d = p.trend.at(-1)!.counts[b.band] - p.trend[0].counts[b.band]; return d === 0 ? "—" : `${d > 0 ? "+" : ""}${d}`; })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="meta" style={{ marginTop: 8 }}>Volume, 30 days: {p.bands.map((b) => `${humanize(b.band)} ${formatMoney(b.volume30, p.currency, { compact: true })}`).join(" · ")}</div>
        </section>
        <section className="panel" aria-labelledby="q-h">
          <header><h2 id="q-h">Queue health</h2><Link className="link meta" href="/queues/breaching-sla">Breaching SLA</Link></header>
          <table className="data" style={{ marginLeft: -20, marginRight: -20, width: "calc(100% + 40px)" }}>
            <thead><tr><th>Priority</th><th className="n">Open</th><th className="n">Within SLA</th><th className="n">Average age</th></tr></thead>
            <tbody>
              {p.queue.map((q) => (
                <tr key={q.priority}>
                  <td><SeverityPill severity={q.priority} /></td>
                  <td className="n num">{q.open}</td>
                  <td className="n num" style={{ color: q.open && q.inSla / q.open < 0.9 ? "var(--negative)" : undefined }}>{q.open ? fmtPct(q.inSla / q.open, 0) : "—"}</td>
                  <td className="n num">{q.open ? (q.avgAgeHours >= 48 ? `${(q.avgAgeHours / 24).toFixed(1)} d` : `${q.avgAgeHours.toFixed(0)} h`) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="meta" style={{ marginTop: 8 }}>Target: 90% of cases closed within SLA.</div>
        </section>
      </div>
      <div className="grid-2-1" style={{ alignItems: "stretch" }}>
        <section className="panel flush" aria-labelledby="rp-h">
          <header><h2 id="rp-h">Rule performance</h2><Link className="link meta" href="/rules">All {p.rules.length} rules</Link></header>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data">
              <thead><tr><th>Rule</th><th className="n">Alerts</th><th className="n">Dismissed</th><th className="n">Led to action</th></tr></thead>
              <tbody>
                {[...p.rules].sort((a, b) => (b.stats?.total ?? 0) - (a.stats?.total ?? 0)).slice(0, 6).map((r) => {
                  const s = r.stats;
                  const reviewed = s ? s.total - s.open : 0;
                  return (
                    <tr key={r.key}>
                      <td>{r.name}<span className="sub id">{r.key}</span></td>
                      <td className="n num">{s?.total ?? 0}</td>
                      <td className="n num">{reviewed ? fmtPct(s!.dismissed / reviewed, 0) : <span className="muted">—</span>}</td>
                      <td className="n num">{reviewed ? fmtPct(s!.actioned / reviewed, 0) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel" aria-labelledby="cd-h">
          <header><h2 id="cd-h">Controls due for review</h2><span className="meta">Next 14 days</span></header>
          {p.controlsDue.length ? (
            <div className="list-rows">
              {p.controlsDue.map((c) => (
                <Link key={c.id} href={`/merchants/${c.merchant.id}/controls`} className="list-row" style={{ alignItems: "flex-start" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="truncate" style={{ display: "block", fontWeight: 500 }}>{c.merchant.dbaName ?? c.merchant.legalName}</span>
                    <span className="meta">{CONTROL_LABEL[c.type]} · {controlSummary(c.type, c.params as Record<string, unknown>, c.merchant.currency)}</span>
                  </span>
                  <span className="num" style={{ color: c.reviewAt < p.today ? "var(--negative)" : undefined, flex: "none" }}>{fmtDate(c.reviewAt, tz)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">No control reviews due in the next 14 days.</div>
          )}
        </section>
      </div>
    </>
  );
}

function ReportsMenu() {
  const reports = [
    { key: "underwriting-decisions", label: "Underwriting decisions" },
    { key: "active-controls", label: "Active controls" },
    { key: "terminations", label: "Terminations" },
    { key: "sla-by-analyst", label: "SLA by analyst" },
  ];
  return (
    <details style={{ position: "relative" }}>
      <summary className="btn" style={{ listStyle: "none" }}>Download CSV</summary>
      <div className="menu" style={{ position: "absolute", right: 0, top: 38 }}>
        {reports.map((r) => (
          <a key={r.key} className="menu-item" href={`/api/v1/reports/${r.key}.csv`} download data-testid={`csv-${r.key}`}>{r.label}</a>
        ))}
      </div>
    </details>
  );
}
