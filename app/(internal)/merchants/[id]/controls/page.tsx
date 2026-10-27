import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/money";
import { fmtDate, humanize } from "@/lib/format";
import { reserveBalances } from "@/lib/domain/controls/service";
import { CONTROL_LABEL, controlSummary } from "@/lib/domain/controls/text";
import { TimeSeries } from "@/components/charts/TimeSeries";
import { RemoveControl } from "@/components/controls/RemoveControl";
import { isoDay } from "@/lib/domain/reserves/calc";

export default async function ControlsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const tz = await viewerTz();
  const [m, controls, ledger, bal, users, reasons] = await Promise.all([
    db.merchant.findUniqueOrThrow({ where: { id }, select: { currency: true, status: true } }),
    db.control.findMany({ where: { merchantId: id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    db.reserveLedgerEntry.findMany({ where: { merchantId: id }, orderBy: [{ sourceDate: "asc" }, { createdAt: "asc" }] }),
    reserveBalances(id),
    db.user.findMany({ select: { id: true, name: true } }),
    db.reasonCode.findMany({ where: { category: "CONTROL", active: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const live = controls.filter((c) => c.status === "ACTIVE" || c.status === "PENDING_APPROVAL");
  const past = controls.filter((c) => c.status !== "ACTIVE" && c.status !== "PENDING_APPROVAL");
  // Balance per day, derived from the ledger.
  const perDay = new Map<string, bigint>();
  for (const e of ledger) perDay.set(isoDay(e.sourceDate), (perDay.get(isoDay(e.sourceDate)) ?? 0n) + (e.direction === "HOLD" ? e.amountMinor : -e.amountMinor));
  let run = 0n;
  const series = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, delta]) => {
    run += delta;
    return { date, value: Number(run) };
  });
  const canControl = can(user.role, "control.limit") || can(user.role, "control.propose");
  const ctrlName = new Map(controls.map((c) => [c.id, CONTROL_LABEL[c.type]]));

  const Table = ({ rows, removable }: { rows: typeof controls; removable: boolean }) => (
    <div className="table-wrap">
      <table className="data responsive-table">
        <thead>
          <tr>
            <th>Control</th>
            <th>Reason</th>
            <th>Since</th>
            <th>Review by</th>
            <th>Set by</th>
            {removable ? <th aria-label="Actions" /> : <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                {CONTROL_LABEL[c.type]}
                <span className="sub">{controlSummary(c.type, c.params as Record<string, unknown>, m.currency)}</span>
              </td>
              <td data-line2>
                <span className="id">{c.reasonCode}</span>
                <span className="sub truncate" style={{ maxWidth: 280 }} title={c.note}>{c.note}</span>
              </td>
              <td className="num">{fmtDate(c.effectiveFrom, tz)}</td>
              <td className="num">{fmtDate(c.reviewAt, tz)}</td>
              <td data-hide-phone>{name.get(c.createdById) ?? "—"}</td>
              {removable ? (
                <td className="n">
                  {c.status === "PENDING_APPROVAL" ? (
                    <Link className="pill warn" href={`/approvals?id=${c.approvalId}`}>Awaiting approval</Link>
                  ) : canControl ? (
                    <RemoveControl controlId={c.id} label={CONTROL_LABEL[c.type]} needsApproval={["ROLLING_RESERVE", "FIXED_RESERVE", "UPFRONT_RESERVE", "PAYOUT_HOLD"].includes(c.type)} reasons={reasons} />
                  ) : null}
                </td>
              ) : (
                <td>{humanize(c.status)}{c.removedAt ? ` · ${fmtDate(c.removedAt, tz)}` : ""}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="col">
      <section className="panel flush" aria-labelledby="live-h">
        <header>
          <h2 id="live-h">In force</h2>
          {canControl && ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"].includes(m.status) ? (
            <Link className="btn" href={`/merchants/${id}/controls?control=new`}>Add control</Link>
          ) : null}
        </header>
        <div style={{ marginTop: 8 }}>{live.length ? <Table rows={live} removable /> : <div style={{ padding: "0 20px 20px" }}><div className="empty">No controls in force.</div></div>}</div>
      </section>

      <div className="grid-2-1">
        <section className="panel" aria-labelledby="res-h">
          <header>
            <div>
              <h2 id="res-h">Reserve balance</h2>
              <div className="meta">Summed from the ledger, never stored</div>
            </div>
            <span className="money" style={{ fontSize: 20, fontWeight: 600 }}>{formatMoney(bal.total, m.currency)}</span>
          </header>
          {series.length > 1 ? <TimeSeries label="Reserve balance over time" fmt="money" data={series} height={180} /> : <div className="empty">No reserve has been held.</div>}
        </section>
        <section className="panel" aria-labelledby="per-h">
          <h2 id="per-h" style={{ marginBottom: 10 }}>By control</h2>
          {bal.perControl.size ? (
            <dl className="kv">
              {[...bal.perControl.entries()].map(([cid, s]) => (
                <div key={cid} style={{ display: "contents" }}>
                  <dt>{ctrlName.get(cid) ?? "Control"}</dt>
                  <dd className="money">{formatMoney(s.balance, m.currency)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="empty">Nothing held.</div>
          )}
        </section>
      </div>

      <section className="panel flush" aria-labelledby="led-h">
        <header>
          <h2 id="led-h">Reserve ledger</h2>
          <span className="meta">{ledger.length} entries · newest first</span>
        </header>
        {ledger.length ? (
          <div className="table-wrap" style={{ marginTop: 8, maxHeight: 420, overflow: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Sales date</th>
                  <th>Movement</th>
                  <th>Control</th>
                  <th>Releases</th>
                  <th className="n">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...ledger].reverse().slice(0, 300).map((e) => (
                  <tr key={e.id}>
                    <td className="num">{isoDay(e.sourceDate)}</td>
                    <td>{e.direction === "HOLD" ? "Held" : e.direction === "RELEASE" ? "Released" : "Applied to loss"}</td>
                    <td>{ctrlName.get(e.controlId) ?? "—"}</td>
                    <td className="num">{e.releaseAt ? isoDay(e.releaseAt) : "—"}</td>
                    <td className="n money" style={{ color: e.direction === "HOLD" ? undefined : "var(--muted)" }}>
                      {e.direction === "HOLD" ? "+" : "−"}
                      {formatMoney(e.amountMinor, e.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "0 20px 20px" }}><div className="empty">No reserve movements.</div></div>
        )}
      </section>

      {past.length ? (
        <section className="panel flush" aria-labelledby="past-h">
          <header>
            <h2 id="past-h">History</h2>
          </header>
          <div style={{ marginTop: 8 }}><Table rows={past} removable={false} /></div>
        </section>
      ) : null}
    </div>
  );
}
