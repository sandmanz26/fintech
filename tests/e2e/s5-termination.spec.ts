import { test, expect } from "@playwright/test";
import { login, idOf, sql, expectToast, advanceDays } from "./helpers";

/**
 * S5 (PRD §11): Nimbus has sustained chargebacks above 1% and an owner with a confirmed sanctions
 * match. The analyst proposes termination for compliance reasons; Compliance approves. Processing
 * stops, the reserve is held through the 120-day dispute window, then reconciled: losses applied,
 * the rest released, and the merchant ends TERMINATED.
 */
test("S5: termination, compliance approval, dispute window, reconciliation", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const nimbus = idOf("US-NSP-55819");
  const caseId = sql(`select id from "Case" where "merchantId"='${nimbus}' and type='WATCHLIST' and status<>'RESOLVED'`);
  expect(sql(`select "currentBand" from "Merchant" where id='${nimbus}'`)).toBe("PROHIBITED");
  const reserveBefore = BigInt(sql(`select coalesce(sum(case when direction='HOLD' then "amountMinor" else -"amountMinor" end),0) from "ReserveLedgerEntry" where "merchantId"='${nimbus}'`));
  expect(reserveBefore > 0n).toBe(true);

  await login(page, "ANALYST");
  await page.goto(`/cases/${caseId}`);
  await page.getByTestId("case-terminate").click();
  const dlg = page.getByTestId("terminate-dialog");
  await dlg.getByLabel("Reason").selectOption("COMPLIANCE");
  await dlg.getByLabel("Evidence, for the approver").fill("Controller confirmed on the sanctions list (reviewed by compliance); chargebacks above 1% for 90 days.");
  // A compliance termination lists the business and its principals; nobody ticks a box.
  await expect(dlg.getByTestId("listing-consequence")).toContainText("go on the terminated merchant list");
  await dlg.getByLabel("Reason").selectOption("MERCHANT_REQUEST");
  await expect(dlg.getByTestId("listing-consequence")).toContainText("not listed");
  await dlg.getByLabel("Reason").selectOption("COMPLIANCE");
  // Submitting before typing the name explains what is missing instead of doing nothing.
  await dlg.getByTestId("terminate-submit").click();
  await expect(dlg.getByTestId("field-error")).toContainText("Type “Nimbus Supplements” exactly");
  await dlg.getByLabel("Type the merchant's name to confirm").fill("Nimbus Supplements");
  await dlg.getByTestId("terminate-submit").click();
  await expectToast(page, /Termination sent for approval/);
  const approvalId = sql(`select id from "ApprovalRequest" where "merchantId"='${nimbus}' and "actionType"='TERMINATE' and status='PENDING'`);
  expect(sql(`select status from "Merchant" where id='${nimbus}'`)).toBe("UNDER_REVIEW");

  // Compliance may approve a compliance termination.
  await login(page, "COMPLIANCE");
  await page.goto(`/approvals?id=${approvalId}`);
  await expect(page.getByTestId("consequences")).toContainText("Card processing stops today");
  await expect(page.getByTestId("consequences")).toContainText("added to the terminated merchant list");
  await page.getByTestId("approval-note").fill("Confirmed sanctions match; exit required.");
  await page.getByTestId("approve").click();
  await expectToast(page, /Approved and carried out/);

  expect(sql(`select status from "Merchant" where id='${nimbus}'`)).toBe("TERMINATION_PENDING");
  expect(sql(`select status || ':' || "resolutionCode" from "Case" where id='${caseId}'`)).toBe("RESOLVED:CR-TERMINATED");
  expect(Number(sql(`select count(*) from "TerminatedListEntry" where "merchantId"='${nimbus}'`))).toBeGreaterThanOrEqual(2);
  expect(sql(`select count(*) from "Case" where "merchantId"='${nimbus}' and type='OFFBOARDING' and status<>'RESOLVED'`)).toBe("1");

  // No new processing while the reserve waits out the dispute window; late chargebacks still arrive.
  advanceDays(5);
  expect(sql(`select count(*) from "Transaction" where "merchantId"='${nimbus}' and "occurredAt" >= (select "offboardedAt"::date + 1 from "Merchant" where id='${nimbus}')`)).toBe("0");
  expect(sql(`select status from "Merchant" where id='${nimbus}'`)).toBe("TERMINATION_PENDING");
  const stillHeld = BigInt(sql(`select coalesce(sum(case when direction='HOLD' then "amountMinor" else -"amountMinor" end),0) from "ReserveLedgerEntry" where "merchantId"='${nimbus}'`));
  expect(stillHeld).toBe(reserveBefore);

  advanceDays(117);
  expect(sql(`select status from "Merchant" where id='${nimbus}'`)).toBe("TERMINATED");
  const balance = sql(`select coalesce(sum(case when direction='HOLD' then "amountMinor" else -"amountMinor" end),0) from "ReserveLedgerEntry" where "merchantId"='${nimbus}'`);
  expect(balance).toBe("0");
  const applied = BigInt(sql(`select coalesce(sum("amountMinor"),0) from "ReserveLedgerEntry" where "merchantId"='${nimbus}' and direction='APPLY_TO_LOSS'`));
  const losses = BigInt(sql(`select coalesce(sum("amountMinor"),0) from "Dispute" where "merchantId"='${nimbus}' and "receivedAt" >= (select "offboardedAt" from "Merchant" where id='${nimbus}') and status in ('OPEN','LOST','ACCEPTED')`));
  expect(applied).toBe(losses < reserveBefore ? losses : reserveBefore);
  expect(sql(`select status from "Case" where "merchantId"='${nimbus}' and type='OFFBOARDING'`)).toBe("RESOLVED");

  await login(page, "AUDITOR");
  await page.goto(`/merchants/${nimbus}/timeline`);
  await expect(page.getByText("reserve reconciled").first()).toBeVisible();
});
