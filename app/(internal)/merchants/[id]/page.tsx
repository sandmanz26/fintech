import Link from "next/link";
import { db } from "@/lib/db";
import { latestAssessment, metricSeries, chartMarkers, exposureFor, merchantHeader } from "@/lib/queries/merchant";
import { ScoreLedger } from "@/components/risk/ScoreLedger";
import { ExposureCard } from "@/components/risk/ExposureCard";
import { MetricsChart } from "@/components/merchant/MetricsChart";
import { SeverityPill, SlaText } from "@/components/ui/badges";
import { viewerTz } from "@/lib/session";
import { now } from "@/lib/clock";
import { OPEN_CASE_STATES, CASE_STATUS_LABEL } from "@/lib/domain/caseStateMachine";
import { fmtDate, humanize } from "@/lib/format";

export default async function MerchantOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, rows, markers, exposure, header, tz, at, cases, app] = await Promise.all([
    latestAssessment(id),
    metricSeries(id, 90),
    chartMarkers(id, 90),
    exposureFor(id),
    merchantHeader(id),
    viewerTz(),
    now(),
    db.case.findMany({ where: { merchantId: id, status: { in: OPEN_CASE_STATES } }, orderBy: { slaDueAt: "asc" }, take: 4 }),
    db.application.findFirst({ where: { merchantId: id }, orderBy: { submittedAt: "desc" } }),
  ]);
  const decider = app?.decidedById ? await db.user.findUnique({ where: { id: app.decidedById } }) : null;
  const hasHistory = rows.some((r) => r.attempts > 0);
  return (
    <div className="grid-2-1">
      <div className="col">
        {a ? (
          <ScoreLedger score={a.score} band={a.band} factors={a.factors} hardStops={a.hardStops} bands={a.bands} policyVersion={a.policyVersion} createdAt={a.createdAt} trigger={a.trigger} previous={a.previous} tz={tz} />
        ) : (
          <section className="panel">
            <h2>Risk score</h2>
            <div className="empty" style={{ marginTop: 12 }}>Not scored yet. Scoring runs when the application&apos;s checks finish.</div>
          </section>
        )}
        {hasHistory ? (
          <MetricsChart rows={rows} markers={markers} networkThreshold={header.networkThreshold} networkLabel={header.networkLabel} />
        ) : (
          <section className="panel">
            <h2>Last 90 days</h2>
            <div className="empty" style={{ marginTop: 12 }}>No processing history yet.</div>
          </section>
        )}
      </div>
      <div className="col">
        <ExposureCard e={exposure} />
        <section className="panel" aria-labelledby="cases-h">
          <header>
            <h2 id="cases-h">Open cases</h2>
            <Link className="link meta" href={`/merchants/${id}/cases`}>All cases</Link>
          </header>
          {cases.length ? (
            <div className="list-rows">
              {cases.map((c) => (
                <Link key={c.id} href={`/cases/${c.id}`} className="list-row" style={{ alignItems: "flex-start" }}>
                  <SeverityPill severity={c.priority} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="truncate" style={{ display: "block", fontWeight: 500 }}>{c.title ?? humanize(c.type)}</span>
                    <span className="meta">{CASE_STATUS_LABEL[c.status]} · <SlaText due={c.slaDueAt} now={at} /></span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">No open cases.</div>
          )}
        </section>
        <section className="panel" aria-labelledby="dec-h">
          <h2 id="dec-h" style={{ marginBottom: 10 }}>Onboarding decision</h2>
          {app?.decidedAt ? (
            <dl className="kv">
              <dt>Decision</dt>
              <dd>{humanize(app.decision ?? "")}</dd>
              <dt>Reason</dt>
              <dd className="id">{app.decisionReasonCode}</dd>
              <dt>Decided by</dt>
              <dd>{decider?.name ?? "—"}</dd>
              <dt>On</dt>
              <dd>{fmtDate(app.decidedAt, tz)}</dd>
            </dl>
          ) : app ? (
            <div className="row-gap">
              <span className="muted">Not decided yet.</span>
              <Link className="link" href={`/applications/${app.id}`}>Open the review</Link>
            </div>
          ) : (
            <div className="empty">No application on file.</div>
          )}
        </section>
      </div>
    </div>
  );
}
