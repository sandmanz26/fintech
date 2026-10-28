import { json, route, errorResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { advanceOneDay } from "@/lib/jobs";
import { isMockMode } from "@/lib/mode";
import { can } from "@/lib/auth/rbac";
import { record } from "@/lib/domain/audit";

/**
 * POST /demo/advance — move the simulated calendar on one day: simulate trading, close the day
 * (metrics, rules, reserves), open the next (screening, websites, releases, SLA). The same
 * pipeline as `npm run demo:advance-day`. Any staff persona in demo mode; otherwise the head of
 * risk or an admin.
 */
export const POST = route({ cap: "merchant.read" }, async (_req, { user }) => {
  if (!isMockMode() && !can(user.role, "policy.write")) return errorResponse(403, "FORBIDDEN", "Only the head of risk or an admin can move the calendar.");
  const [alertsBefore, casesBefore] = await Promise.all([db.alert.count(), db.case.count()]);
  const t0 = Date.now();
  const r = await advanceOneDay();
  const [alertsAfter, casesAfter, txns] = await Promise.all([
    db.alert.count(),
    db.case.count(),
    db.transaction.count({ where: { occurredAt: { gte: new Date(`${r.closed}T00:00:00Z`), lt: new Date(`${r.today}T00:00:00Z`) } } }),
  ]);
  await record(db, { id: user.id, role: user.role }, { action: "DEMO_DAY_ADVANCED", entityType: "System", entityId: "calendar", before: { today: r.closed }, after: { today: r.today } });
  return json({ ...r, transactions: txns, newAlerts: alertsAfter - alertsBefore, newCases: casesAfter - casesBefore, ms: Date.now() - t0 });
});
