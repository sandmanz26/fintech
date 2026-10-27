import { db } from "@/lib/db";
import { viewerTz } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { fmtDate, humanize } from "@/lib/format";
import { now, simToday } from "@/lib/clock";
import { metricSeries } from "@/lib/queries/merchant";
import { TimeSeries } from "@/components/charts/TimeSeries";
import { addDays } from "@/lib/domain/reserves/calc";

export default async function DisputesTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tz = await viewerTz();
  const at = await now();
  const today = await simToday();
  // Only disputes that have arrived; scheduled ones are the simulator's future.
  const where = { merchantId: id, receivedAt: { lte: at } };
  const [rows, byReason, series, m] = await Promise.all([
    db.dispute.findMany({ where, orderBy: { receivedAt: "desc" }, take: 100 }),
    db.dispute.groupBy({ by: ["reasonCategory"], where: { ...where, receivedAt: { gte: addDays(today, -90), lte: at } }, _count: true, _sum: { amountMinor: true } }),
    metricSeries(id, 90),
    db.merchant.findUniqueOrThrow({ where: { id }, select: { currency: true } }),
  ]);
  const total90 = byReason.reduce((a, r) => a + r._count, 0);
  const sorted = [...byReason].sort((a, b) => b._count - a._count);
  return (
    <div className="col">
      <div className="grid-2-1">
        <section className="panel" aria-labelledby="cbs-h">
          <header>
            <h2 id="cbs-h">Chargebacks received per day</h2>
            <span className="meta">Last 90 days</span>
          </header>
          <TimeSeries label="Chargebacks received per day, last 90 days" fmt="count" kind="bar" data={series.map((r) => ({ date: r.date, value: r.chargebacks }))} height={180} />
        </section>
        <section className="panel" aria-labelledby="rsn-h">
          <header>
            <h2 id="rsn-h">By reason</h2>
            <span className="meta num">{total90} in 90 days</span>
          </header>
          {sorted.length ? (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {sorted.map((r, i) => (
                <li key={r.reasonCategory} style={{ padding: "6px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{humanize(r.reasonCategory)}</span>
                    <span className="num">{r._count}</span>
                  </div>
                  <div style={{ height: 2, marginTop: 4, background: "var(--rule)" }}>
                    <div style={{ height: 2, width: `${(r._count / sorted[0]._count) * 100}%`, background: i === 0 ? "var(--text)" : "var(--chart-muted)" }} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty">No chargebacks in 90 days.</div>
          )}
        </section>
      </div>
      <section className="panel flush" aria-labelledby="dl-h">
        <header>
          <h2 id="dl-h">Disputes</h2>
          <span className="meta">Latest 100</span>
        </header>
        {rows.length ? (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data responsive-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Transaction</th>
                  <th className="n">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="num">{fmtDate(d.receivedAt, tz)}</td>
                    <td>{humanize(d.reasonCategory)}</td>
                    <td><span className={`pill ${d.status === "LOST" ? "neg" : d.status === "OPEN" ? "warn" : ""}`}>{humanize(d.status)}</span></td>
                    <td className="id" data-line2>{d.transactionId.slice(-10)}</td>
                    <td className="n money">{formatMoney(d.amountMinor, m.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            <div className="empty">No disputes received.</div>
          </div>
        )}
      </section>
    </div>
  );
}
