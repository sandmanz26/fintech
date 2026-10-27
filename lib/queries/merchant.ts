import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { simToday } from "@/lib/clock";
import { addDays, isoDay } from "@/lib/domain/reserves/calc";
import { reserveBalances, merchantExposure } from "@/lib/domain/controls/service";
import { getActivePolicy } from "@/lib/domain/policy";
import { OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";
import type { FactorResult } from "@/lib/domain/scoring";

export async function merchantHeader(id: string) {
  const m = await db.merchant.findUnique({
    where: { id },
    include: { controls: { where: { status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, orderBy: { effectiveFrom: "asc" } } },
  });
  if (!m) notFound();
  const today = await simToday();
  const [agg, reserve, openCases, policy] = await Promise.all([
    db.dailyMerchantMetric.aggregate({
      where: { merchantId: id, date: { gte: addDays(today, -30), lt: today } },
      _sum: { grossVolumeMinor: true, settledCount: true, chargebackCount: true, refundCount: true },
    }),
    reserveBalances(id),
    db.case.count({ where: { merchantId: id, status: { in: OPEN_CASE_STATES } } }),
    getActivePolicy(),
  ]);
  const settled = agg._sum.settledCount ?? 0;
  return {
    m,
    today,
    volume30: agg._sum.grossVolumeMinor ?? 0n,
    settled30: settled,
    cbRatio: settled ? (agg._sum.chargebackCount ?? 0) / settled : null,
    cbCount: agg._sum.chargebackCount ?? 0,
    refundRatio: settled ? (agg._sum.refundCount ?? 0) / settled : null,
    reserve: reserve.total,
    openCases,
    networkThreshold: policy.params.network.cbRatioThresholdBps / 10_000,
    networkLabel: policy.params.network.label,
    mccName: policy.params.scoring.mccNames[m.mcc] ?? `MCC ${m.mcc}`,
  };
}

export async function latestAssessment(merchantId: string) {
  const a = await db.riskAssessment.findFirst({ where: { merchantId }, orderBy: { createdAt: "desc" } });
  if (!a) return null;
  const policy = await db.policy.findUnique({ where: { version: a.policyVersion } });
  const bands = (policy?.params as { scoring: { bands: { mediumFrom: number; highFrom: number } } } | undefined)?.scoring.bands ?? { mediumFrom: 30, highFrom: 55 };
  const previous = await db.riskAssessment.findFirst({ where: { merchantId, createdAt: { lt: a.createdAt } }, orderBy: { createdAt: "desc" } });
  return { ...a, factors: a.factors as unknown as FactorResult[], hardStops: a.hardStops as unknown as { key: string; label: string }[], bands, previous };
}

export async function metricSeries(merchantId: string, days = 90) {
  const today = await simToday();
  const from = addDays(today, -days);
  const rows = await db.dailyMerchantMetric.findMany({ where: { merchantId, date: { gte: from, lt: today } }, orderBy: { date: "asc" } });
  const by = new Map(rows.map((r) => [isoDay(r.date), r]));
  const out: { date: string; volume: number; settled: number; chargebacks: number; refunds: number; cbRatio30: number | null; declines: number; attempts: number }[] = [];
  // Rolling 30-day chargeback ratio needs 30 days before the window.
  const before = await db.dailyMerchantMetric.findMany({ where: { merchantId, date: { gte: addDays(from, -30), lt: from } } });
  const all = [...before, ...rows].map((r) => ({ d: isoDay(r.date), s: r.settledCount, c: r.chargebackCount }));
  for (let i = 0; i < days; i++) {
    const d = isoDay(addDays(from, i));
    const r = by.get(d);
    const win = all.filter((x) => x.d > isoDay(addDays(new Date(`${d}T00:00:00Z`), -30)) && x.d <= d);
    const s = win.reduce((a, x) => a + x.s, 0);
    const c = win.reduce((a, x) => a + x.c, 0);
    out.push({
      date: d,
      volume: r ? Number(r.grossVolumeMinor) : 0,
      settled: r?.settledCount ?? 0,
      chargebacks: r?.chargebackCount ?? 0,
      refunds: r?.refundCount ?? 0,
      cbRatio30: s ? c / s : null,
      declines: r?.declineCount ?? 0,
      attempts: r?.authAttempts ?? 0,
    });
  }
  return out;
}

export async function chartMarkers(merchantId: string, days = 90) {
  const today = await simToday();
  const from = addDays(today, -days);
  const [alerts, controls] = await Promise.all([
    db.alert.findMany({ where: { merchantId, metricDate: { gte: from } }, orderBy: { metricDate: "asc" }, select: { metricDate: true, ruleKey: true, severity: true } }),
    db.control.findMany({ where: { merchantId, status: { in: ["ACTIVE", "EXPIRED", "REMOVED"] }, effectiveFrom: { gte: from } }, select: { effectiveFrom: true, type: true } }),
  ]);
  return [
    ...alerts.map((a) => ({ date: isoDay(a.metricDate), label: a.ruleKey.replace("R-", ""), kind: "alert" as const })),
    ...controls.map((c) => ({ date: isoDay(c.effectiveFrom), label: c.type.replace(/_/g, " ").toLowerCase(), kind: "control" as const })),
  ];
}

export async function exposureFor(merchantId: string) {
  return merchantExposure(merchantId);
}

/** Every recorded thing that happened to a merchant, newest first (PRD §9 timeline: 4 sources). */
export async function merchantTimeline(merchantId: string, limit = 200) {
  const cases = await db.case.findMany({ where: { merchantId }, select: { id: true, type: true, title: true } });
  const caseIds = cases.map((c) => c.id);
  const [audit, events, controls, alerts, users] = await Promise.all([
    db.auditLog.findMany({
      where: {
        OR: [
          { entityType: "Merchant", entityId: merchantId },
          { entityType: "Application", entityId: { in: (await db.application.findMany({ where: { merchantId }, select: { id: true } })).map((a) => a.id) } },
          { entityType: "Control", entityId: { in: (await db.control.findMany({ where: { merchantId }, select: { id: true } })).map((c) => c.id) } },
        ],
      },
      orderBy: { id: "desc" },
      take: limit,
    }),
    db.caseEvent.findMany({ where: { caseId: { in: caseIds } }, orderBy: { createdAt: "desc" }, take: limit }),
    db.control.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" } }),
    db.alert.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const caseBy = new Map(cases.map((c) => [c.id, c]));
  type Item = { at: Date; source: "audit" | "case" | "control" | "alert"; title: string; detail?: string; actor?: string | null; href?: string };
  const items: Item[] = [];
  for (const a of audit) {
    items.push({ at: a.occurredAt, source: "audit", title: a.action.replace(/_/g, " ").toLowerCase(), detail: summariseAudit(a.before, a.after), actor: a.actorId ? name.get(a.actorId) : "System" });
  }
  for (const e of events) {
    const c = caseBy.get(e.caseId);
    const p = e.payload as Record<string, unknown>;
    items.push({ at: e.createdAt, source: "case", title: `${e.type.replace(/_/g, " ").toLowerCase()} · ${c?.title ?? c?.type ?? "case"}`, detail: typeof p.body === "string" ? p.body : p.to ? `→ ${String(p.to).toLowerCase().replace(/_/g, " ")}` : undefined, actor: e.actorId ? name.get(e.actorId) : "System", href: `/cases/${e.caseId}` });
  }
  for (const c of controls) {
    items.push({ at: c.createdAt, source: "control", title: `${c.type.replace(/_/g, " ").toLowerCase()} ${c.status === "PENDING_APPROVAL" ? "proposed" : "created"}`, detail: `${c.reasonCode} · ${c.note}`, actor: name.get(c.createdById) });
  }
  for (const a of alerts) {
    items.push({ at: a.createdAt, source: "alert", title: `alert ${a.ruleKey}`, detail: `${a.severity.toLowerCase()} · ${a.status.toLowerCase().replace(/_/g, " ")}`, actor: "Rules engine", href: a.caseId ? `/cases/${a.caseId}` : undefined });
  }
  return items.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, limit);
}

function summariseAudit(before: unknown, after: unknown): string | undefined {
  const b = before as Record<string, unknown> | null;
  const a = after as Record<string, unknown> | null;
  if (a && "status" in a && b && "status" in b) return `${String(b.status).toLowerCase().replace(/_/g, " ")} → ${String(a.status).toLowerCase().replace(/_/g, " ")}`;
  if (a && "band" in a) return `${b?.band ? `${String(b.band).toLowerCase()} → ` : ""}${String(a.band).toLowerCase()} (${a.score})`;
  if (a && "decision" in a) return `${String(a.decision).toLowerCase().replace(/_/g, " ")} · ${a.reasonCode ?? ""}`;
  return undefined;
}
