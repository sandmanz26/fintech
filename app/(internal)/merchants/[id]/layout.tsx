import Link from "next/link";
import { merchantHeader } from "@/lib/queries/merchant";
import { requireStaff } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/money";
import { fmtPct, fmtDate } from "@/lib/format";
import { BandPill, MerchantStatusPill } from "@/components/ui/badges";
import { TabNav } from "@/components/ui/TabNav";
import { CONTROL_LABEL, controlSummary } from "@/lib/domain/controls/text";
import { MerchantActions } from "@/components/merchant/MerchantActions";
import { PROCESSING_STATES } from "@/lib/domain/merchantStateMachine";

/**
 * Merchant 360 header (PRD §9): name, status, band and score, 30-day volume and the active
 * controls as chips. It stays above every tab.
 */
export default async function MerchantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const h = await merchantHeader(id);
  const { m } = h;
  const base = `/merchants/${id}`;
  // Red only when material: the same 10-chargeback floor the network-proximity rule uses.
  const nearNetwork = h.cbRatio !== null && h.cbRatio >= h.networkThreshold * 0.8 && h.cbCount >= 10;
  const processing = PROCESSING_STATES.includes(m.status);
  return (
    <>
      <div className="crumbs">
        <Link href="/merchants">Merchants</Link>
        <span aria-hidden>/</span>
        <span className="truncate">{m.dbaName ?? m.legalName}</span>
      </div>
      <div className="title-row" style={{ marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row-gap">
            <h1>{m.dbaName ?? m.legalName}</h1>
            <MerchantStatusPill status={m.status} />
            <BandPill band={m.currentBand} score={m.currentScore} />
          </div>
          <div className="sub">
            {m.legalName} · {h.mccName} <span className="id">{m.mcc}</span> · {m.country} · <span className="id">{m.registrationNo}</span>
            {m.activatedAt ? ` · processing since ${fmtDate(m.activatedAt)}` : ""}
          </div>
        </div>
        <MerchantActions
          merchantId={id}
          canControl={can(user.role, "control.propose") || can(user.role, "control.limit")}
          canRescore={can(user.role, "merchant.rescore")}
          canTerminate={processing && can(user.role, "control.propose")}
          processing={processing}
        />
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi">
          <div className="kpi-label">Volume, 30 days</div>
          <div className="kpi-value money">{formatMoney(h.volume30, m.currency)}</div>
          <div className="kpi-sub num">
            {h.settled30.toLocaleString()} settled · declared {formatMoney(m.expectedMonthlyVolumeMinor, m.currency)}/mo
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Chargeback ratio, 30 days</div>
          <div className="kpi-value num" style={{ color: nearNetwork ? "var(--negative)" : undefined }}>{fmtPct(h.cbRatio)}</div>
          <div className="kpi-sub num">
            {h.cbCount} chargebacks · network line {fmtPct(h.networkThreshold, 1)}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Refund ratio, 30 days</div>
          <div className="kpi-value num">{fmtPct(h.refundRatio)}</div>
          <div className="kpi-sub">of settled transactions</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Reserve held</div>
          <div className="kpi-value money" style={{ color: h.reserve === 0n ? "var(--muted)" : undefined }}>{formatMoney(h.reserve, m.currency)}</div>
          <div className="kpi-sub">from the reserve ledger</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Open cases</div>
          <div className="kpi-value num">{h.openCases}</div>
          <div className="kpi-sub">{h.openCases ? <Link className="link" href={`${base}/cases`}>View cases</Link> : "None open"}</div>
        </div>
      </div>

      {m.controls.length ? (
        <div className="row-gap" style={{ marginBottom: 16 }} aria-label="Controls in force">
          {m.controls.map((c) => (
            <Link key={c.id} href={`${base}/controls`} className="chip" title={c.note}>
              <strong style={{ fontWeight: 500 }}>{CONTROL_LABEL[c.type]}</strong>
              <span className="muted">{controlSummary(c.type, c.params as Record<string, unknown>, m.currency)}</span>
              {c.status === "PENDING_APPROVAL" ? <span className="pill warn" style={{ height: 18 }}>Awaiting approval</span> : null}
            </Link>
          ))}
        </div>
      ) : (
        <div className="meta" style={{ marginBottom: 16 }}>No controls in force</div>
      )}

      <TabNav
        label="Merchant sections"
        tabs={[
          { href: base, label: "Overview", exact: true },
          { href: `${base}/ownership`, label: "Ownership" },
          { href: `${base}/documents`, label: "Documents" },
          { href: `${base}/transactions`, label: "Transactions" },
          { href: `${base}/disputes`, label: "Disputes" },
          { href: `${base}/controls`, label: "Controls" },
          { href: `${base}/cases`, label: "Cases", count: h.openCases || undefined },
          { href: `${base}/timeline`, label: "Timeline" },
        ]}
      />
      {children}
    </>
  );
}
