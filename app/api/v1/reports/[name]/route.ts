import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { route, toActor } from "@/lib/api";
import { toCsv, minorToDecimal } from "@/lib/csv";
import { record } from "@/lib/domain/audit";
import { NotFoundError } from "@/lib/errors";
import { now } from "@/lib/clock";
import { OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/** GET /reports/:name.csv — underwriting decisions, active controls, terminations, SLA by analyst. */
export const GET = route<{ name: string }>({ cap: "portfolio.read" }, async (req, { params, user }) => {
  const name = params.name.replace(/\.csv$/, "");
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ? new Date(sp.get("from")!) : new Date("2000-01-01");
  const to = sp.get("to") ? new Date(sp.get("to")!) : new Date("2100-01-01");
  const users = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let csv: string;
  if (name === "underwriting-decisions") {
    const apps = await db.application.findMany({ where: { decidedAt: { gte: from, lte: to } }, include: { merchant: true }, orderBy: { decidedAt: "asc" } });
    csv = toCsv(
      ["application_id", "merchant", "registration_no", "mcc", "band", "score", "decision", "reason_code", "decided_by", "submitted_at", "decided_at", "hours_to_decision"],
      apps.map((a) => [a.id, a.merchant.legalName, a.merchant.registrationNo, a.merchant.mcc, a.merchant.currentBand, a.merchant.currentScore, a.decision, a.decisionReasonCode, a.decidedById ? users.get(a.decidedById) : "", iso(a.submittedAt), iso(a.decidedAt), a.submittedAt && a.decidedAt ? ((a.decidedAt.getTime() - a.submittedAt.getTime()) / 3_600_000).toFixed(1) : ""]),
    );
  } else if (name === "active-controls") {
    const cs = await db.control.findMany({ where: { status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, include: { merchant: true }, orderBy: { reviewAt: "asc" } });
    csv = toCsv(
      ["control_id", "merchant", "type", "status", "params", "reason_code", "note", "effective_from", "review_at", "created_by"],
      cs.map((c) => [c.id, c.merchant.legalName, c.type, c.status, JSON.stringify(c.params), c.reasonCode, c.note, iso(c.effectiveFrom), iso(c.reviewAt), users.get(c.createdById)]),
    );
  } else if (name === "terminations") {
    const ms = await db.merchant.findMany({ where: { status: { in: ["TERMINATION_PENDING", "TERMINATED"] } }, orderBy: { offboardedAt: "asc" } });
    const reqs = await db.approvalRequest.findMany({ where: { actionType: "TERMINATE", status: "APPROVED", merchantId: { in: ms.map((m) => m.id) } } });
    const ledger = await db.reserveLedgerEntry.groupBy({ by: ["merchantId", "direction"], where: { merchantId: { in: ms.map((m) => m.id) } }, _sum: { amountMinor: true } });
    const sum = (id: string, d: string) => ledger.find((l) => l.merchantId === id && l.direction === d)?._sum.amountMinor ?? 0n;
    csv = toCsv(
      ["merchant", "registration_no", "status", "reason_category", "reason_code", "requested_by", "approved_by", "offboarded_at", "dispute_window_ends", "reserve_held", "applied_to_loss", "released"],
      ms.map((m) => {
        const r = reqs.find((x) => x.merchantId === m.id);
        const p = (r?.payload ?? {}) as Record<string, string>;
        return [m.legalName, m.registrationNo, m.status, p.reasonCategory, p.reasonCode, r ? users.get(r.requestedById) : "", r?.decidedById ? users.get(r.decidedById) : "", iso(m.offboardedAt), iso(m.disputeWindowEndsAt), minorToDecimal(sum(m.id, "HOLD")), minorToDecimal(sum(m.id, "APPLY_TO_LOSS")), minorToDecimal(sum(m.id, "RELEASE"))];
      }),
    );
  } else if (name === "sla-by-analyst") {
    const at = await now();
    const cases = await db.case.findMany({ where: { assigneeId: { not: null }, createdAt: { gte: from, lte: to } }, select: { assigneeId: true, status: true, slaDueAt: true, resolvedAt: true, createdAt: true } });
    const by = new Map<string, { total: number; resolved: number; inSla: number; open: number; breachedOpen: number; hours: number }>();
    for (const c of cases) {
      const s = by.get(c.assigneeId!) ?? { total: 0, resolved: 0, inSla: 0, open: 0, breachedOpen: 0, hours: 0 };
      s.total++;
      if (c.resolvedAt) {
        s.resolved++;
        if (c.resolvedAt <= c.slaDueAt) s.inSla++;
        s.hours += (c.resolvedAt.getTime() - c.createdAt.getTime()) / 3_600_000;
      } else if (OPEN_CASE_STATES.includes(c.status)) {
        s.open++;
        if (c.slaDueAt < at) s.breachedOpen++;
      }
      by.set(c.assigneeId!, s);
    }
    csv = toCsv(
      ["analyst", "cases", "resolved", "resolved_within_sla", "sla_adherence_pct", "open", "open_breached", "avg_hours_to_resolve"],
      [...by.entries()].map(([id, s]) => [users.get(id), s.total, s.resolved, s.inSla, s.resolved ? ((s.inSla / s.resolved) * 100).toFixed(1) : "", s.open, s.breachedOpen, s.resolved ? (s.hours / s.resolved).toFixed(1) : ""]),
    );
  } else throw new NotFoundError("Report");
  await db.$transaction((tx) => record(tx, toActor(user), { action: "REPORT_EXPORTED", entityType: "Report", entityId: name, after: { from: sp.get("from"), to: sp.get("to") } }));
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sentinel-${name}.csv"`, "cache-control": "no-store" } });
});
