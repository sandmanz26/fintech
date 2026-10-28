import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { STORY } from "@/lib/sim/stories";
import { OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";

/**
 * The five guided stories (PRD §11) as a live walkthrough: each story reads its state from the
 * data and says what to do next, as whom, and where. Used by the sign-in page and the dashboard.
 */

export type StoryStep = { label: string; role: Role; href: string };
export type StoryState = "todo" | "waiting" | "done";
export type GuidedStory = {
  key: string;
  title: string;
  summary: string;
  state: StoryState;
  next: StoryStep | null;
  doneText: string;
};

const approvalStep = (id: string, role: Role, who: string): StoryStep => ({ label: `${who} reviews and approves the request`, role, href: `/approvals?id=${id}` });

export async function guidedStories(): Promise<GuidedStory[]> {
  const merchants = await db.merchant.findMany({
    where: { registrationNo: { in: Object.values(STORY) } },
    select: {
      id: true,
      registrationNo: true,
      status: true,
      applications: { orderBy: { submittedAt: "desc" }, take: 1, select: { id: true, decidedAt: true } },
      cases: { where: { status: { in: OPEN_CASE_STATES } }, orderBy: { createdAt: "asc" }, select: { id: true, type: true } },
      controls: { where: { status: "ACTIVE" }, select: { type: true } },
    },
  });
  const by = new Map(merchants.map((m) => [m.registrationNo, m]));
  const pending = await db.approvalRequest.findMany({ where: { status: "PENDING", merchantId: { in: merchants.map((m) => m.id) } }, select: { id: true, merchantId: true, actionType: true } });
  const pendingFor = (id?: string) => pending.find((p) => p.merchantId === id);
  const out: GuidedStory[] = [];

  const lumen = by.get(STORY.LUMEN);
  if (lumen) {
    const app = lumen.applications[0];
    const p = pendingFor(lumen.id);
    out.push({
      key: "S1",
      title: "Underwrite a high-risk travel agency",
      summary: "Finish the due-diligence checklist for Lumen Travel Co. and approve it with a rolling reserve sized from the impact preview.",
      state: p ? "waiting" : app?.decidedAt ? "done" : "todo",
      next: p ? approvalStep(p.id, "RISK_MANAGER", "Laura (head of risk)") : app && !app.decidedAt ? { label: "Dimas works the checklist and decides", role: "SENIOR_ANALYST", href: `/applications/${app.id}` } : null,
      doneText: "Approved with conditions; the reserve is live.",
    });
  }

  const bright = by.get(STORY.BRIGHTSIDE);
  if (bright) {
    const c = bright.cases.find((x) => x.type === "MONITORING");
    out.push({
      key: "S2",
      title: "Volume spike: ask the merchant for documents",
      summary: "Brightside Electronics' volume jumped five-fold. Request invoices through the merchant portal, upload them as the merchant, then set a temporary limit.",
      state: c ? "todo" : "done",
      next: c ? { label: "Rina opens the volume-spike case", role: "ANALYST", href: `/cases/${c.id}` } : null,
      doneText: "Documents received, limit set, case closed.",
    });
  }

  const qt = by.get(STORY.QUICKTOP);
  if (qt) {
    const c = qt.cases.find((x) => x.type === "MONITORING");
    const p = pendingFor(qt.id);
    const held = qt.controls.some((x) => x.type === "PAYOUT_HOLD");
    out.push({
      key: "S3",
      title: "Card testing: hold payouts with four-eyes",
      summary: "620 tiny authorisations in a day at QuickTop Gift Cards, 72% declined. Propose a payout hold; the head of risk must approve it.",
      state: held ? "done" : p ? "waiting" : "todo",
      next: p ? approvalStep(p.id, "RISK_MANAGER", "Laura (head of risk)") : c && !held ? { label: "Rina opens the critical card-testing case", role: "ANALYST", href: `/cases/${c.id}` } : null,
      doneText: "Payout hold approved and active.",
    });
  }

  const glow = by.get(STORY.GLOW);
  if (glow) {
    const c = glow.cases.find((x) => x.type === "DISPUTE_SPIKE");
    const p = pendingFor(glow.id);
    const reserved = glow.controls.some((x) => x.type === "FIXED_RESERVE");
    out.push({
      key: "S4",
      title: "Near the Visa line: size a reserve",
      summary: "Glow Subscription Box is past the Visa VAMP early warning. See it on the portfolio watchlist, then put a fixed reserve over the approval line in place.",
      state: reserved ? "done" : p ? "waiting" : "todo",
      next: p
        ? approvalStep(p.id, "RISK_MANAGER", "Laura (head of risk)")
        : reserved
          ? null
          : c
            ? { label: "Dimas opens the dispute case and proposes the reserve", role: "SENIOR_ANALYST", href: `/cases/${c.id}` }
            : { label: "Laura checks the network watchlist", role: "RISK_MANAGER", href: "/reports" },
      doneText: "Fixed reserve approved; the merchant is restricted.",
    });
  }

  const nimbus = by.get(STORY.NIMBUS);
  if (nimbus) {
    const c = nimbus.cases.find((x) => x.type === "WATCHLIST");
    const p = pendingFor(nimbus.id);
    const ended = ["TERMINATION_PENDING", "TERMINATED", "CLOSED"].includes(nimbus.status);
    out.push({
      key: "S5",
      title: "Sanctions match: terminate and settle",
      summary: "A controller of Nimbus Supplements is a confirmed sanctions match. Propose termination; compliance approves; the reserve is held through the dispute window.",
      state: ended ? "done" : p ? "waiting" : "todo",
      next: p ? approvalStep(p.id, "COMPLIANCE", "Ahmad (compliance)") : c && !ended ? { label: "Rina opens the watchlist case and proposes termination", role: "ANALYST", href: `/cases/${c.id}` } : null,
      doneText: "Terminated; the reserve waits out the dispute window.",
    });
  }
  return out;
}

/** A safe in-app path for a post-login redirect (no protocol-relative or external URLs). */
export function safeNext(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/dashboard";
}
