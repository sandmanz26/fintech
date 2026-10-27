import { test, expect } from "@playwright/test";
import { login, idOf, sql, expectToast } from "./helpers";

/**
 * S3 (PRD §11): hundreds of tiny authorisations at QuickTop, 70% declined. R-CARD-TESTING opens a
 * CRITICAL case. The analyst proposes a payout hold; every payout hold is four-eyes, so the head
 * of risk approves it.
 */
test("S3: card testing, payout hold, four-eyes approval", async ({ page }) => {
  const qt = idOf("US-QTG-30927");
  const caseId = sql(`select id from "Case" where "merchantId"='${qt}' and status<>'RESOLVED'`);
  expect(sql(`select priority from "Case" where id='${caseId}'`)).toBe("CRITICAL");

  await login(page, "ANALYST");
  await page.goto("/queues/unassigned");
  await expect(page.getByTestId(`case-row-${caseId}`)).toContainText("QuickTop Gift Cards");
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByTestId("alert-R-CARD-TESTING")).toContainText("Very small authorisations today");
  await page.getByTestId("start-review").click();
  await expect(page.getByTestId("case-status")).toHaveText("In review");

  await page.getByTestId("case-add-control").click();
  const editor = page.getByTestId("control-editor");
  await editor.getByLabel("Type").selectOption("PAYOUT_HOLD");
  await editor.getByLabel("Reason").selectOption("CT-CARD-TESTING");
  await editor.getByLabel("Why, for the file").fill("620 sub-$2 authorisations in one day, 72% declined: classic card testing.");
  await expect(editor.getByTestId("needs-approval")).toContainText("Every payout hold needs a second approver");
  await editor.getByTestId("control-submit").click();
  await expectToast(page, /Sent for approval/);

  const approvalId = sql(`select id from "ApprovalRequest" where "merchantId"='${qt}' and status='PENDING'`);
  expect(sql(`select status from "Case" where id='${caseId}'`)).toBe("PENDING_APPROVAL");
  // Nothing has changed for the merchant yet.
  expect(sql(`select status from "Control" where "merchantId"='${qt}' and type='PAYOUT_HOLD'`)).toBe("PENDING_APPROVAL");

  // An analyst cannot decide approvals at all (403 from the server).
  const r1 = await page.request.post(`/api/v1/approvals/${approvalId}/decide`, { data: { decision: "APPROVE", note: "self-approve attempt" } });
  expect(r1.status()).toBe(403);

  await login(page, "RISK_MANAGER");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dash-approvals")).toContainText("QuickTop Gift Cards");
  await page.goto(`/approvals?id=${approvalId}`);
  await expect(page.getByTestId("approval-detail")).toContainText("Requested by Rina Halim");
  await page.getByTestId("approval-note").fill("Card testing confirmed in the evidence; hold payouts until the merchant secures checkout.");
  await page.getByTestId("approve").click();
  await expectToast(page, /Approved and carried out/);

  expect(sql(`select status from "Control" where "merchantId"='${qt}' and type='PAYOUT_HOLD'`)).toBe("ACTIVE");
  expect(sql(`select status from "Merchant" where id='${qt}'`)).toBe("RESTRICTED");
  expect(sql(`select status || ':' || "resolutionCode" from "Case" where id='${caseId}'`)).toBe("RESOLVED:CR-CONTROL-APPLIED");
  // Approval and execution are in the audit log, in that order.
  const actions = sql(`select string_agg(action, ',' order by id) from "AuditLog" where action in ('APPROVAL_APPROVED','CONTROL_APPLIED') and "occurredAt" >= (select "decidedAt" from "ApprovalRequest" where id='${approvalId}') - interval '1 minute'`);
  expect(actions).toContain("APPROVAL_APPROVED,CONTROL_APPLIED");
});

test("four-eyes: a head of risk cannot approve their own request", async ({ page }) => {
  const glow = idOf("US-GSB-77104");
  await login(page, "RISK_MANAGER");
  const today = sql(`select today::text from "SimClock" where id=1`);
  const review = sql(`select (today + 30)::text from "SimClock" where id=1`);
  const created = await page.request.post("/api/v1/controls", {
    data: { merchantId: glow, type: "PAYOUT_HOLD", params: {}, reasonCode: "CT-INVESTIGATION", note: "Testing self-approval refusal.", reviewAt: review, effectiveFrom: today },
  });
  expect(created.status()).toBe(201);
  const { approval } = await created.json();
  const self = await page.request.post(`/api/v1/approvals/${approval.id}/decide`, { data: { decision: "APPROVE", note: "my own" } });
  expect(self.status()).toBe(403);
  expect((await self.json()).error.code).toBe("SAME_PERSON");
  // The requester may cancel instead.
  expect((await page.request.post(`/api/v1/approvals/${approval.id}/cancel`)).status()).toBe(200);
  expect(sql(`select status from "Control" where id='${approval.payload.controlId}'`)).toBe("REMOVED");
});
