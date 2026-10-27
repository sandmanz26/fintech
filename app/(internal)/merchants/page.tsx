import Link from "next/link";
import type { Prisma, RiskBand, MerchantStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { simToday } from "@/lib/clock";
import { addDays } from "@/lib/domain/reserves/calc";
import { formatMoney } from "@/lib/money";
import { fmtPct } from "@/lib/format";
import { BandPill, MerchantStatusPill } from "@/components/ui/badges";
import { getActivePolicy } from "@/lib/domain/policy";
import { RowLink } from "@/components/ui/RowLink";

export const metadata = { title: "Merchants" };

const BANDS: RiskBand[] = ["LOW", "MEDIUM", "HIGH", "PROHIBITED"];
const STATUS_GROUPS: { key: string; label: string; statuses: MerchantStatus[] }[] = [
  { key: "processing", label: "Processing", statuses: ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"] },
  { key: "review", label: "Under review", statuses: ["UNDER_REVIEW", "RESTRICTED"] },
  { key: "onboarding", label: "Onboarding", statuses: ["SUBMITTED", "IN_UNDERWRITING", "PENDING_INFO", "APPROVED"] },
  { key: "offboarding", label: "Offboarding", statuses: ["TERMINATION_PENDING", "TERMINATED", "CLOSED", "DECLINED"] },
];

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ q?: string; band?: string; group?: string; page?: string }> }) {
  const sp = await searchParams;
  const where: Prisma.MerchantWhereInput = {};
  if (sp.band && BANDS.includes(sp.band as RiskBand)) where.currentBand = sp.band as RiskBand;
  const group = STATUS_GROUPS.find((g) => g.key === sp.group);
  if (group) where.status = { in: group.statuses };
  if (sp.q) where.OR = [{ legalName: { contains: sp.q, mode: "insensitive" } }, { dbaName: { contains: sp.q, mode: "insensitive" } }, { registrationNo: { contains: sp.q, mode: "insensitive" } }];
  const pageN = Math.max(1, Number(sp.page) || 1);
  const size = 50;
  const [total, list, today, policy] = await Promise.all([
    db.merchant.count({ where }),
    db.merchant.findMany({ where, orderBy: [{ currentScore: { sort: "desc", nulls: "last" } }, { legalName: "asc" }], skip: (pageN - 1) * size, take: size, include: { _count: { select: { controls: { where: { status: "ACTIVE" } } } } } }),
    simToday(),
    getActivePolicy(),
  ]);
  const ids = list.map((m) => m.id);
  const agg = await db.dailyMerchantMetric.groupBy({ by: ["merchantId"], where: { merchantId: { in: ids }, date: { gte: addDays(today, -30), lt: today } }, _sum: { grossVolumeMinor: true, settledCount: true, chargebackCount: true } });
  const by = new Map(agg.map((a) => [a.merchantId, a._sum]));
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, band: sp.band, group: sp.group, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/merchants${p.size ? `?${p}` : ""}`;
  };
  const threshold = policy.params.network.cbRatioThresholdBps / 10_000;
  return (
    <>
      <div className="title-row">
        <div>
          <h1>Merchants</h1>
          <div className="sub">Sorted by risk score, highest first</div>
        </div>
      </div>
      <div className="row-gap" style={{ marginBottom: 16, justifyContent: "space-between" }}>
        <form className="row-gap" action="/merchants" role="search">
          <label className="sr-only" htmlFor="q">Search merchants</label>
          <input id="q" name="q" className="input" style={{ width: 280, height: 32 }} placeholder="Name or registration number" defaultValue={sp.q} />
          {sp.band ? <input type="hidden" name="band" value={sp.band} /> : null}
          {sp.group ? <input type="hidden" name="group" value={sp.group} /> : null}
          <button className="btn">Search</button>
        </form>
        <div className="row-gap">
          <div className="segmented" role="group" aria-label="Status">
            <Link href={qs({ group: undefined, page: undefined })} aria-current={!sp.group ? "true" : undefined}>All</Link>
            {STATUS_GROUPS.map((g) => (
              <Link key={g.key} href={qs({ group: g.key, page: undefined })} aria-current={sp.group === g.key ? "true" : undefined}>{g.label}</Link>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Band">
            <Link href={qs({ band: undefined, page: undefined })} aria-current={!sp.band ? "true" : undefined}>Any band</Link>
            {BANDS.map((b) => (
              <Link key={b} href={qs({ band: b, page: undefined })} aria-current={sp.band === b ? "true" : undefined}>{b[0] + b.slice(1).toLowerCase()}</Link>
            ))}
          </div>
        </div>
      </div>
      <section className="panel flush">
        <div className="meta" style={{ padding: "12px 20px 0" }}>{total.toLocaleString()} merchants</div>
        {list.length ? (
          <div className="table-wrap">
            <table className="data responsive-table" data-keynav>
              <thead>
                <tr>
                  <th style={{ width: "34%" }}>Merchant</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th className="n">Volume, 30 days</th>
                  <th className="n">Chargebacks, 30 days</th>
                  <th className="n">Controls</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const s = by.get(m.id);
                  const settled = s?.settledCount ?? 0;
                  const cb = settled ? (s?.chargebackCount ?? 0) / settled : null;
                  return (
                    <RowLink key={m.id} href={`/merchants/${m.id}`}>
                      <td>
                        <Link href={`/merchants/${m.id}`} className="link" tabIndex={-1}>{m.dbaName ?? m.legalName}</Link>
                        <span className="sub">{policy.params.scoring.mccNames[m.mcc] ?? m.mcc} · {m.country}</span>
                      </td>
                      <td><MerchantStatusPill status={m.status} /></td>
                      <td data-line2><BandPill band={m.currentBand} score={m.currentScore} /></td>
                      <td className="n money">{s?.grossVolumeMinor ? formatMoney(s.grossVolumeMinor, m.currency) : <span className="muted">—</span>}</td>
                      <td className="n num" style={{ color: cb !== null && cb >= threshold * 0.8 && (s?.chargebackCount ?? 0) >= 10 ? "var(--negative)" : undefined }}>
                        {cb === null ? <span className="muted">—</span> : fmtPct(cb)}
                        {s?.chargebackCount ? <span className="sub">{s.chargebackCount}</span> : null}
                      </td>
                      <td className="n num" data-hide-phone>{m._count.controls || <span className="muted">0</span>}</td>
                    </RowLink>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20 }}><div className="empty">No merchants match these filters.</div></div>
        )}
        <div className="meta" style={{ padding: "12px 20px", display: "flex", justifyContent: "space-between" }}>
          <span className="num">{total ? `${(pageN - 1) * size + 1}–${Math.min(total, pageN * size)} of ${total}` : ""}</span>
          <span className="row-gap">
            {pageN > 1 ? <Link className="link" href={qs({ page: String(pageN - 1) })}>Previous</Link> : null}
            {pageN * size < total ? <Link className="link" href={qs({ page: String(pageN + 1) })}>Next</Link> : null}
          </span>
        </div>
      </section>
    </>
  );
}
