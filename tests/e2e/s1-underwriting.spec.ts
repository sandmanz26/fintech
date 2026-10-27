import { test, expect } from "@playwright/test";
import { login, idOf, sql, expectToast } from "./helpers";

/**
 * S1 (PRD §11): Lumen Travel Co. scores HIGH. A senior underwriter completes the checklist, checks
 * exposure, and approves with a 10% / 120-day rolling reserve chosen in the impact preview. The
 * reserve is at the four-eyes line, so the head of risk approves it and only then does Lumen go live.
 */
test("S1: conditional approval with a rolling reserve and four-eyes", async ({ page, request }) => {
  const lumen = idOf("US-LTC-61530");
  const appId = sql(`select id from "Application" where "merchantId"='${lumen}'`);

  // An analyst may not decide a HIGH application: the server refuses it (403), not just the UI.
  await login(page, "ANALYST");
  const denied = await page.request.post(`/api/v1/applications/${appId}/decision`, { data: { decision: "APPROVED", reasonCode: "UW-STANDARD" } });
  expect(denied.status()).toBe(403);

  await login(page, "SENIOR_ANALYST");
  await page.goto(`/applications/${appId}`);
  await expect(page.getByRole("heading", { name: "Lumen Travel Co." })).toBeVisible();
  await expect(page.getByTestId("score-total")).toHaveText("64");

  // Locked until the checklist is complete, and it says what is missing.
  await expect(page.getByTestId("decision-locked")).toContainText("bank statements");

  for (const d of await page.getByTestId(/accept-doc-/).all()) await d.click();
  for (const key of ["bank_statement", "processing_history", "exposure_review"]) {
    await page.getByTestId(`pass-${key}`).click();
    await expect(page.getByTestId(`check-${key}`)).toHaveAttribute("data-status", "PASS");
  }
  await expect(page.getByTestId("decision-locked")).toHaveCount(0);
  await expect(page.getByTestId("checklist-progress")).toContainText("7 of 7");

  // Approve with conditions: add the reserve through the impact preview.
  await page.getByLabel("Approve with conditions").check();
  await page.getByTestId("decision-reason").selectOption("UW-CONDITIONS-DELIVERY");
  await page.getByTestId("add-condition").click();
  const editor = page.getByTestId("control-editor");
  await editor.getByLabel("Share of daily sales held").fill("10");
  await editor.getByLabel("Released after").fill("120");
  await editor.getByLabel("Reason").selectOption("CT-FUTURE-DELIVERY");
  await editor.getByLabel("Why, for the file").fill("45-day future delivery on travel bookings; reserve covers delivery exposure.");
  await expect(editor.getByTestId("needs-approval")).toBeVisible();
  await expect(editor.getByTestId("merchant-text")).toContainText("hold 10% of each day's card sales");
  await editor.getByTestId("control-submit").click();
  await expect(page.getByTestId("conditions")).toContainText("Rolling reserve");
  await page.getByLabel("Note for the file").fill("Young travel agency; approved with a delivery reserve.");
  await page.getByTestId("decision-submit").click();
  await expectToast(page, /waits for the reserve/);

  expect(sql(`select status from "Merchant" where id='${lumen}'`)).toBe("APPROVED");
  expect(sql(`select status from "Control" where "merchantId"='${lumen}'`)).toBe("PENDING_APPROVAL");

  // The requester cannot approve their own request.
  const approvalId = sql(`select id from "ApprovalRequest" where "merchantId"='${lumen}' and status='PENDING'`);
  await page.goto(`/approvals?view=mine&id=${approvalId}`);
  await expect(page.getByTestId("cancel-approval")).toBeVisible();

  // Head of risk approves; the control activates and the merchant goes live, atomically.
  await login(page, "RISK_MANAGER");
  await page.goto(`/approvals?id=${approvalId}`);
  await expect(page.getByTestId("consequences")).toContainText("Rolling reserve starts today");
  await page.getByTestId("approval-note").fill("Reserve sized to delivery exposure; approved.");
  await page.getByTestId("approve").click();
  await expectToast(page, /Approved and carried out/);

  expect(sql(`select status from "Merchant" where id='${lumen}'`)).toBe("ACTIVE");
  expect(sql(`select status from "Control" where "merchantId"='${lumen}'`)).toBe("ACTIVE");
  expect(sql(`select status from "ApprovalRequest" where id='${approvalId}'`)).toBe("APPROVED");
  await page.goto(`/merchants/${lumen}`);
  await expect(page.getByRole("link", { name: /Rolling reserve/ })).toBeVisible();
  void request;
});
