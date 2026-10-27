import { test, expect } from "@playwright/test";
import { login, idOf, sql, expectToast } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");

/**
 * S2 (PRD §11): Brightside's volume jumps 5x in three days at 3x its usual ticket. R-VOL-SPIKE and
 * R-TICKET-SHIFT land in one case. The analyst asks for invoices; the merchant uploads them through
 * the portal; the analyst sets a temporary daily limit and closes the case.
 */
test("S2: volume spike, RFI through the portal, temporary limit", async ({ page, browser }) => {
  const bright = idOf("US-BRS-48211");
  const caseId = sql(`select id from "Case" where "merchantId"='${bright}' and status<>'RESOLVED'`);
  expect(sql(`select string_agg(distinct "ruleKey", ',' order by "ruleKey") from "Alert" where "caseId"='${caseId}'`)).toBe("R-TICKET-SHIFT,R-VOL-SPIKE");

  await login(page, "ANALYST");
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByTestId("alert-R-VOL-SPIKE").first()).toContainText("Volume today");
  await page.getByTestId("start-review").click();
  await expect(page.getByTestId("case-status")).toHaveText("In review");

  await page.getByTestId("open-rfi-form").click();
  await page.getByTestId("send-rfi").click();
  await expect(page.getByTestId("portal-url")).toBeVisible();
  const token = sql(`select token from "Rfi" where "caseId"='${caseId}'`);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(sql(`select status from "Case" where id='${caseId}'`)).toBe("AWAITING_MERCHANT");

  // The merchant, with no session, opens the portal. Nothing internal is visible.
  const merchant = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const portal = await merchant.newPage();
  await portal.goto(`/portal/rfi/${token}`);
  await expect(portal.getByRole("heading", { name: "Documents for Brightside Electronics" })).toBeVisible();
  const body = (await portal.locator("main").innerText()).toLowerCase();
  for (const internal of ["r-vol-spike", "score", "rina", "risk band", "case", "alert"]) expect(body).not.toContain(internal);
  // Wrong file types are refused by content, not name.
  await portal.getByTestId("upload-invoice").setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await expect(portal.getByRole("alert").filter({ hasText: "PDF, JPG or PNG" })).toBeVisible();
  await portal.getByTestId("upload-invoice").setInputFiles({ name: "invoices-oct.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(portal.getByRole("heading", { name: "Thank you, we have everything" })).toBeVisible();
  // The token is revoked once answered: further uploads are refused.
  const again = await portal.request.post(`/api/v1/portal/rfi/${token}/upload`, { multipart: { itemKey: "invoice", file: { name: "x.pdf", mimeType: "application/pdf", buffer: PDF } } });
  expect(again.status()).toBe(410);
  await merchant.close();

  expect(sql(`select status from "Case" where id='${caseId}'`)).toBe("IN_REVIEW");

  // A temporary daily limit applies at once (no four-eyes for limits).
  await page.goto(`/merchants/${bright}?control=new&caseId=${caseId}&type=VOLUME_LIMIT_DAILY`);
  const editor = page.getByTestId("control-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Type").selectOption("VOLUME_LIMIT_DAILY");
  await editor.getByLabel("Daily limit").fill("20000");
  await editor.getByLabel("Reason").selectOption("CT-VOLUME-SPIKE");
  await editor.getByLabel("Why, for the file").fill("Invoices confirm a one-off trade-show order; limit while volume settles.");
  await expect(editor.getByTestId("needs-approval")).toHaveCount(0);
  await editor.getByTestId("control-submit").click();
  await expectToast(page, "Control applied.");
  expect(sql(`select status from "Control" where "merchantId"='${bright}' and type='VOLUME_LIMIT_DAILY'`)).toBe("ACTIVE");

  await page.goto(`/cases/${caseId}`);
  await page.getByTestId("close-case").click();
  await page.getByTestId("resolution-code").selectOption("CR-CONTROL-APPLIED");
  await page.getByTestId("resolution-note").fill("Merchant sent invoices for a trade-show order; $20,000 daily limit for 30 days.");
  await page.getByTestId("confirm-close").click();
  await expect(page.getByTestId("case-status")).toHaveText("Resolved");
  // No heavy control and no other high case: the merchant returns to Active.
  expect(sql(`select status from "Merchant" where id='${bright}'`)).toBe("ACTIVE");
});
