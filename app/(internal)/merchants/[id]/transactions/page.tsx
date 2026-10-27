import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { viewerTz } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { fmtDateTime, humanize } from "@/lib/format";
import { simToday } from "@/lib/clock";
import { addDays } from "@/lib/domain/reserves/calc";

const STATUSES = ["SETTLED", "DECLINED", "REFUNDED", "CHARGEBACK"];

export default async function TransactionsTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; cursor?: string; flag?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tz = await viewerTz();
  const today = await simToday();
  const where: Prisma.TransactionWhereInput = { merchantId: id, occurredAt: { lt: addDays(today, 1) } };
  if (sp.status && STATUSES.includes(sp.status)) where.status = sp.status;
  if (sp.flag) where.flags = { has: sp.flag };
  const take = 50;
  const [rows, total] = await Promise.all([
    db.transaction.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: take + 1, ...(sp.cursor ? { cursor: { id: sp.cursor }, skip: 1 } : {}) }),
    db.transaction.count({ where }),
  ]);
  const more = rows.length > take;
  const list = rows.slice(0, take);
  const href = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ status: sp.status, flag: sp.flag, ...q }).filter(([, v]) => v) as [string, string][]);
    return `/merchants/${id}/transactions${p.size ? `?${p}` : ""}`;
  };
  return (
    <section className="panel flush" aria-labelledby="tx-h">
      <header style={{ flexWrap: "wrap" }}>
        <h2 id="tx-h">Transactions</h2>
        <div className="row-gap">
          <div className="segmented" role="group" aria-label="Status">
            <Link href={href({ status: undefined, cursor: undefined })} aria-current={!sp.status ? "true" : undefined}>All</Link>
            {STATUSES.map((s) => (
              <Link key={s} href={href({ status: s, cursor: undefined })} aria-current={sp.status === s ? "true" : undefined}>
                {humanize(s)}
              </Link>
            ))}
          </div>
          <Link className={`chip`} href={href({ flag: sp.flag ? undefined : "OVER_LIMIT", cursor: undefined })} aria-pressed={!!sp.flag}>
            {sp.flag ? "Showing over-limit only" : "Over limit only"}
          </Link>
          <span className="meta num">{total.toLocaleString()} transactions</span>
        </div>
      </header>
      {list.length ? (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data responsive-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>ID</th>
                <th>Status</th>
                <th>Card</th>
                <th className="n">Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td className="num">{fmtDateTime(t.occurredAt, tz)}</td>
                  <td className="id" data-hide-phone title={t.id}>{t.id.slice(-10)}</td>
                  <td>
                    <span className={`pill ${t.status === "CHARGEBACK" ? "neg" : t.status === "DECLINED" ? "outline" : ""}`}>{humanize(t.status)}</span>
                    {t.flags.map((f) => (
                      <span key={f} className="pill warn" style={{ marginLeft: 6 }}>{humanize(f)}</span>
                    ))}
                  </td>
                  <td data-line2>
                    <span className="id">{t.cardBin}••</span> · {t.cardCountry}
                    {t.isCrossBorder ? " · cross-border" : ""}
                  </td>
                  <td className="n money">{formatMoney(t.amountMinor, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 20 }}>
          <div className="empty">No transactions match.</div>
        </div>
      )}
      <div style={{ padding: "12px 20px", display: "flex", justifyContent: "space-between" }} className="meta">
        <span>Showing {list.length} of {total.toLocaleString()}</span>
        {more ? <Link className="link" href={href({ cursor: list.at(-1)!.id })}>Older</Link> : null}
      </div>
    </section>
  );
}
