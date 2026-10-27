import { db, type Tx } from "@/lib/db";
import { record, type Actor } from "@/lib/domain/audit";
import { PolicyParamsSchema, type PolicyParams } from "./types";

export type ActivePolicy = { version: number; params: PolicyParams; activeFrom: Date };

/** The newest policy version whose activeFrom has passed. */
export async function getActivePolicy(tx: Tx = db): Promise<ActivePolicy> {
  const p = await tx.policy.findFirst({ where: { activeFrom: { lte: new Date() } }, orderBy: { version: "desc" } });
  if (!p) throw new Error("No policy configured. Run the seed.");
  return { version: p.version, params: PolicyParamsSchema.parse(p.params), activeFrom: p.activeFrom };
}

export async function getPolicyVersion(version: number, tx: Tx = db): Promise<ActivePolicy | null> {
  const p = await tx.policy.findUnique({ where: { version } });
  return p ? { version: p.version, params: PolicyParamsSchema.parse(p.params), activeFrom: p.activeFrom } : null;
}

/** Policies are append-only: a change is a new version; old assessments keep pointing at theirs. */
export async function createPolicyVersion(actor: Actor, params: unknown, changeNote: string) {
  const parsed = PolicyParamsSchema.parse(params);
  return db.$transaction(async (tx) => {
    const last = await tx.policy.findFirst({ orderBy: { version: "desc" } });
    const version = (last?.version ?? 0) + 1;
    const created = await tx.policy.create({
      data: { version, params: parsed as never, changeNote, activeFrom: new Date(), createdById: actor.id ?? "system" },
    });
    await record(tx, actor, {
      action: "POLICY_VERSION_CREATED",
      entityType: "Policy",
      entityId: String(version),
      before: last ? { version: last.version } : null,
      after: { version, changeNote },
    });
    return created;
  });
}

/** Card-network program lines as fractions, read by the rules, the reports and the screens. */
export type NetworkLines = {
  label: string;
  vampLine: number;
  vampWarning: number;
  vampMinCount: number;
  acquirerAboveStandard: number;
  acquirerExcessive: number;
  countFraudDisputesTwice: boolean;
  ecmLine: number;
  ecmWarning: number;
  ecmMinCount: number;
  warningMinCount: number;
};

export function networkLines(p: PolicyParams): NetworkLines {
  const n = p.network;
  return {
    label: n.label,
    vampLine: n.visa.merchantExcessiveBps / 10_000,
    vampWarning: (n.visa.merchantExcessiveBps / 10_000) * n.earlyWarningShare,
    vampMinCount: n.visa.merchantMinCount,
    acquirerAboveStandard: n.visa.acquirerAboveStandardBps / 10_000,
    acquirerExcessive: n.visa.acquirerExcessiveBps / 10_000,
    countFraudDisputesTwice: n.visa.countFraudDisputesTwice,
    ecmLine: n.mastercard.ecmBps / 10_000,
    ecmWarning: (n.mastercard.ecmBps / 10_000) * n.earlyWarningShare,
    ecmMinCount: n.mastercard.ecmMinChargebacks,
    warningMinCount: n.warningMinCount,
  };
}
