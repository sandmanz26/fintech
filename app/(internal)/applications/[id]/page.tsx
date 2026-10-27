import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can, canDecideBand } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtBps, humanize } from "@/lib/format";
import { latestAssessment, exposureFor } from "@/lib/queries/merchant";
import { getActivePolicy } from "@/lib/domain/policy";
import { missingItems, type Checklist as CL } from "@/lib/domain/underwriting/checklist";
import { BandPill, MerchantStatusPill } from "@/components/ui/badges";
import { ScoreLedger } from "@/components/risk/ScoreLedger";
import { ExposureCard } from "@/components/risk/ExposureCard";
import { Checklist } from "@/components/underwriting/Checklist";
import { DecisionPanel } from "@/components/underwriting/DecisionPanel";
import { DocReview } from "@/components/merchant/DocReview";
import { simToday } from "@/lib/clock";
import { isoDay } from "@/lib/domain/reserves/calc";

export const metadata = { title: "Underwriting review" };

const DELIVERY: Record<string, string> = { IMMEDIATE: "At purchase", DIGITAL: "Digital", SHIPPED: "Shipped", SUBSCRIPTION: "Subscription", FUTURE_SERVICE: "Future service" };

/** "Can I decide this application, and what is missing?" (DESIGN.md §3) */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const app = await db.application.findUnique({ where: { id }, include: { merchant: { include: { owners: { include: { hits: true } }, documents: { orderBy: { uploadedAt: "desc" } } } } } });
  if (!app) notFound();
  const m = app.merchant;
  const [tz, a, exposure, policy, reasons, users, today, pendingOverride, rfi] = await Promise.all([
    viewerTz(),
    latestAssessment(m.id),
    exposureFor(m.id),
    getActivePolicy(),
    db.reasonCode.findMany({ where: { active: true, category: { in: ["UNDERWRITING", "CONTROL"] } }, orderBy: { code: "asc" } }),
    db.user.findMany({ select: { id: true, name: true } }),
    simToday(),
    db.approvalRequest.findFirst({ where: { actionType: "OVERRIDE_PROHIBITED", status: "PENDING", payload: { path: ["applicationId"], equals: id } } }),
    db.rfi.findFirst({ where: { merchantId: m.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const checklist = app.checklist as unknown as CL;
  const missing = missingItems(checklist);
  const band = m.currentBand;
  const canStd = can(user.role, "underwriting.decide.standard");
  const bandOk = band ? canDecideBand(user.role, band === "PROHIBITED" ? "MEDIUM" : band) : canStd;
  const decided = !!app.decidedAt;
  const inReview = ["IN_UNDERWRITING", "PENDING_INFO"].includes(m.status);
  const cannotReason = !canStd
    ? "Your role can read applications but not decide them."
    : !bandOk
      ? "High-risk applications are decided by a senior underwriter. You can still work the checklist and ask for documents."
      : pendingOverride
        ? "An override request is waiting for the head of risk."
        : null;
  const userNames = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const decider = app.decidedById ? userNames[app.decidedById] : null;

  return (
    <>
      <div className="crumbs">
        <Link href={band === "HIGH" || band === "PROHIBITED" ? "/queues/underwriting-enhanced" : "/queues/underwriting-standard"}>Underwriting</Link>
        <span aria-hidden>/</span>
        <span>{m.dbaName ?? m.legalName}</span>
      </div>
      <div className="title-row">
        <div>
          <div className="row-gap">
            <h1>{m.dbaName ?? m.legalName}</h1>
            <MerchantStatusPill status={m.status} />
            <BandPill band={band} score={m.currentScore} />
          </div>
          <div className="sub">
            Applied {fmtDate(app.submittedAt, tz)} · {policy.params.scoring.mccNames[m.mcc] ?? m.mcc} <span className="id">{m.mcc}</span> · {m.country}
            {rfi && rfi.status !== "ANSWERED" && m.status === "PENDING_INFO" ? ` · documents requested, due ${fmtDate(rfi.dueAt, tz)}` : ""}
          </div>
        </div>
        <Link className="btn" href={`/merchants/${m.id}`}>Open merchant</Link>
      </div>

      {decided ? (
        <div className="notice info" style={{ marginBottom: 16 }} data-testid="decided-banner">
          <strong>{humanize(app.decision ?? "")}</strong> by {decider ?? "—"} on {fmtDate(app.decidedAt, tz)} · <span className="id">{app.decisionReasonCode}</span>
          {app.decisionNote ? ` · “${app.decisionNote}”` : ""}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr) minmax(0, 380px)", gap: 16, alignItems: "start" }} className="uw-grid">
        <div className="col">
          <section className="panel" aria-labelledby="biz-h">
            <h2 id="biz-h" style={{ marginBottom: 10 }}>Application</h2>
            <dl className="kv" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <dt>Legal name</dt>
              <dd>{m.legalName}</dd>
              <dt>Registration</dt>
              <dd className="id">{m.registrationNo}</dd>
              <dt>Incorporated</dt>
              <dd>{fmtDate(m.incorporatedAt, tz)}</dd>
              <dt>Website</dt>
              <dd className="truncate" style={{ maxWidth: 150 }} title={m.website ?? ""}>{m.website ? m.website.replace(/^https?:\/\//, "") : "—"}</dd>
              <dt>Delivery</dt>
              <dd>{DELIVERY[m.deliveryModel]}{m.avgDeliveryDays ? `, ${m.avgDeliveryDays} days` : ""}</dd>
              <dt>Monthly volume</dt>
              <dd className="money">{formatMoney(m.expectedMonthlyVolumeMinor, m.currency)}</dd>
              <dt>Average ticket</dt>
              <dd className="money">{formatMoney(m.expectedAvgTicketMinor, m.currency)}</dd>
              <dt>Prior chargebacks</dt>
              <dd className="num">{m.priorCbRatioBps !== null ? fmtBps(m.priorCbRatioBps) : "—"}</dd>
            </dl>
          </section>
          <section className="panel" aria-labelledby="own-h">
            <header>
              <h2 id="own-h">Owners</h2>
              <Link className="link meta" href={`/merchants/${m.id}/ownership`}>Details</Link>
            </header>
            <div className="list-rows">
              {m.owners.map((o) => (
                <div key={o.id} className="list-row" style={{ minHeight: 36, padding: "6px 0" }}>
                  <span style={{ flex: 1, minWidth: 0 }} className="truncate">{o.fullName}</span>
                  {o.screeningStatus === "POTENTIAL_MATCH" ? <span className="pill warn">Possible match</span> : o.screeningStatus === "CONFIRMED_MATCH" ? <span className="pill ink">Match</span> : null}
                  <span className="money">{Number(o.ownershipPct).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </section>
          <section className="panel" aria-labelledby="doc-h">
            <h2 id="doc-h" style={{ marginBottom: 6 }}>Documents</h2>
            {m.documents.length ? (
              <div className="list-rows">
                {m.documents.map((d) => (
                  <div key={d.id} style={{ padding: "8px 0" }}>
                    <div className="row-gap" style={{ justifyContent: "space-between" }}>
                      <a className="link" href={`/api/v1/documents/${d.id}/file`} target="_blank" rel="noreferrer">{humanize(d.type)}</a>
                      <span className={`pill ${d.status === "ACCEPTED" ? "" : d.status === "PENDING_REVIEW" ? "warn" : "neg"}`}>{d.status === "PENDING_REVIEW" ? "To review" : humanize(d.status)}</span>
                    </div>
                    {d.status === "PENDING_REVIEW" && canStd && !decided ? (
                      <div className="row-gap" style={{ marginTop: 6 }}>
                        <DocReview docId={d.id} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No documents uploaded.</div>
            )}
          </section>
        </div>

        <div className="col">
          <Checklist applicationId={id} merchantId={m.id} items={checklist.items} editable={canStd && !decided && inReview} users={userNames} />
          {a ? <ScoreLedger score={a.score} band={a.band} factors={a.factors} hardStops={a.hardStops} bands={a.bands} policyVersion={a.policyVersion} createdAt={a.createdAt} trigger={a.trigger} previous={a.previous} tz={tz} /> : null}
        </div>

        <div className="col">
          {!decided && inReview ? (
            <DecisionPanel
              applicationId={id}
              merchantId={m.id}
              merchantName={m.dbaName ?? m.legalName}
              band={band}
              missing={missing.map((x) => x.label.toLowerCase())}
              canDecide={!cannotReason}
              cannotReason={cannotReason}
              canOverride={can(user.role, "underwriting.decide.high")}
              reasons={reasons}
              today={isoDay(today)}
              decided={decided}
            />
          ) : null}
          <ExposureCard e={exposure} />
        </div>
      </div>
    </>
  );
}
