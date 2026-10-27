import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { can } from "@/lib/auth/rbac";
import { maskDob, maskId } from "@/lib/format";
import { latestAssessment } from "@/lib/queries/merchant";
import { reserveBalances } from "@/lib/domain/controls/service";

/** GET /merchants/:id — full profile. Owner PII is masked unless the role may see it. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params, user }) => {
  const m = await db.merchant.findUnique({
    where: { id: params.id },
    include: { owners: { include: { hits: true } }, controls: { where: { status: { in: ["ACTIVE", "PENDING_APPROVAL"] } } }, applications: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });
  if (!m) throw new NotFoundError("Merchant");
  const pii = can(user.role, "owner.pii.read");
  const owners = m.owners.map((o) => ({ ...o, dateOfBirth: pii ? o.dateOfBirth : maskDob(o.dateOfBirth), idNumber: maskId(o.idNumber) }));
  const [assessment, reserve] = await Promise.all([latestAssessment(m.id), reserveBalances(m.id)]);
  return json({ ...m, owners, assessment, reserveBalance: reserve.total });
});
