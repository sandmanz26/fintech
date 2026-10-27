import { test, expect } from "@playwright/test";
import { login, idOf, sql, expectToast } from "./helpers";

/**
 * S4 (PRD §11): Glow's 30-day chargeback ratio climbs to ~85% of the configured network line.
 * R-CB-NETWORK-PROX raises the dispute case to CRITICAL; Glow shows in the portfolio's network
 * watchlist; a fixed reserve over the four-eyes line is proposed and approved.
 */
test("S4: near the network threshold, fixed reserve with approval", async ({ page }) => {
  const glow = idOf("US-GSB-77104");
  const caseId = sql(`select id from "Case" where "merchantId"='${glow}' and type='DISPUTE_SPIKE' and status<>'RESOLVED'`);
  expect(sql(`select priority from "Case" where id='${caseId}'`)).toBe("CRITICAL");
  expect(sql(`select count(*) from "Alert" where "caseId"='${caseId}' and "ruleKey"='R-CB-NETWORK-PROX'`)).toBe("1");

  await login(page, "RISK_MANAGER");
  await page.goto("/reports");
  const watch = page.getByTestId("network-watchlist");
  await expect(watch).toContainText("Glow Subscription Box");
  await expect(page.getByTestId("portfolio-finding")).toContainText("80% or more of the network chargeback line");

  await login(page, "SENIOR_ANALYST");
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByTestId("alert-R-CB-NETWORK-PROX")).toContainText("Network chargeback threshold");
  await page.getByTestId("case-add-control").click();
  const editor = page.getByTestId("control-editor");
  await editor.getByLabel("Type").selectOption("FIXED_RESERVE");
  await editor.getByLabel("Target reserve").fill("60000");
  await editor.getByLabel("Share of daily sales held until reached").fill("25");
  await editor.getByLabel("Reason").selectOption("CT-NETWORK-THRESHOLD");
  await editor.getByLabel("Why, for the file").fill("30-day ratio at ~85% of the network line and rising; reserve sized to dispute exposure.");
  await expect(editor.getByTestId("needs-approval")).toContainText("Fixed reserve target is at or above");
  await expect(editor.getByTestId("merchant-text")).toContainText("$60,000.00");
  await editor.getByTestId("control-submit").click();
  await expectToast(page, /Sent for approval/);

  const approvalId = sql(`select id from "ApprovalRequest" where "merchantId"='${glow}' and status='PENDING'`);
  await login(page, "RISK_MANAGER");
  await page.goto(`/approvals?id=${approvalId}`);
  await expect(page.getByTestId("consequences")).toContainText("Fixed reserve starts today");
  await page.getByTestId("approval-note").fill("Agreed; reserve until the ratio is back under 50% of the line.");
  await page.getByTestId("approve").click();
  await expectToast(page, /Approved and carried out/);
  expect(sql(`select status from "Control" where "merchantId"='${glow}' and type='FIXED_RESERVE'`)).toBe("ACTIVE");
  expect(sql(`select status from "Merchant" where id='${glow}'`)).toBe("RESTRICTED");
});
