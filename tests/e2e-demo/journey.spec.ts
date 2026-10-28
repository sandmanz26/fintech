import { test, expect, type Page } from "@playwright/test";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
const toast = (page: Page, text: RegExp) => expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();

test("brand assets are served", async ({ request }) => {
  for (const path of ["/favicon.ico", "/icon.svg", "/apple-icon.png", "/opengraph-image.png", "/logo.svg"]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(200);
  }
});

test("demo journey: story from sign-in, four-eyes hand-off, calendar", async ({ page }) => {
  // Sign-in page leads with the guided stories.
  await page.goto("/login");
  await expect(page.getByTestId("stories")).toContainText("Card testing: hold payouts with four-eyes");
  await expect(page.getByTestId("story-S3")).toContainText("To do");

  // S3: one click signs in as Rina and opens the case.
  await page.getByTestId("start-S3").click();
  await expect(page).toHaveURL(/\/cases\//);
  await expect(page.getByTestId("alert-R-CARD-TESTING")).toBeVisible();
  await page.getByTestId("start-review").click();
  await expect(page.getByTestId("case-status")).toHaveText("In review");
  await page.getByTestId("case-add-control").click();
  const editor = page.getByTestId("control-editor");
  await editor.getByLabel("Type").selectOption("PAYOUT_HOLD");
  await editor.getByLabel("Reason").selectOption("CT-CARD-TESTING");
  await editor.getByLabel("Why, for the file").fill("620 sub-$2 authorisations in one day, 72% declined: card testing.");
  await editor.getByTestId("control-submit").click();
  await toast(page, /Sent for approval/);

  // The dashboard guide hands the next step to Laura in one click.
  await page.goto("/dashboard");
  const guide = page.getByTestId("demo-guide");
  await expect(guide).toContainText("Laura (head of risk) reviews and approves the request");
  await page.getByTestId("guide-switch-S3").click();
  await expect(page).toHaveURL(/\/approvals\?id=/);
  await expect(page.getByTestId("approval-detail")).toContainText("Requested by Rina Halim");
  await page.getByTestId("approval-note").fill("Card testing confirmed; hold until checkout is secured.");
  await page.getByTestId("approve").click();
  await toast(page, /Approved and carried out/);

  // The story reads as done everywhere.
  await page.goto("/login?switch=1");
  await expect(page.getByTestId("story-S3")).toContainText("Done");

  // The calendar moves on from the sidebar: a day of trading and every daily job.
  await page.goto("/dashboard");
  await expect(page.getByTestId("demo-calendar")).toContainText("Oct 27, 2026");
  await page.getByTestId("advance-day").click();
  await toast(page, /Now Oct 28\. [\d,]+ transactions simulated/);
  await expect(page.getByTestId("demo-calendar")).toContainText("Oct 28, 2026");
});

test("files and uploads come from the same data the pages show", async ({ page }) => {
  // S2 as the merchant: request documents, then upload through the portal and see it on the case.
  await page.goto("/login");
  await page.getByTestId("start-S2").click();
  await expect(page).toHaveURL(/\/cases\//);
  const caseUrl = page.url();
  await page.getByTestId("start-review").click();
  await page.getByTestId("open-rfi-form").click();
  await page.getByTestId("send-rfi").click();
  const portalUrl = (await page.getByTestId("portal-url").textContent())!.trim();
  // The merchant, with no session, opens the link and uploads.
  const merchant = await page.context().browser()!.newContext();
  const portal = await merchant.newPage();
  await portal.goto(new URL(portalUrl, page.url()).pathname);
  await portal.getByTestId("upload-invoice").setInputFiles({ name: "invoices-oct.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(portal.getByRole("heading", { name: "Thank you, we have everything" })).toBeVisible();
  await merchant.close();
  // The analyst sees the upload on the case, and it opens.
  await page.goto(caseUrl);
  await expect(page.getByText("invoices-oct.pdf").first()).toBeVisible();

  // A CSV export downloads.
  await page.goto("/login?switch=1");
  await page.getByTestId("login-RISK_MANAGER").click();
  await page.goto("/reports");
  await page.getByText("Download CSV").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("csv-active-controls").click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});

test("a seeded document opens from the bundled snapshot", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByTestId("start-S1").click();
  await expect(page).toHaveURL(/\/applications\//);
  // Headless Chromium hands a PDF in a new tab to the download manager; a real browser shows it.
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Bank statement" }).first().click()]);
  const download = await popup.waitForEvent("download");
  const file = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of file) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("alert").filter({ hasText: /Not found|Could not/ })).toHaveCount(0);
});

test("buttons explain what is missing; read-only screens say so; the guide explains the product", async ({ page }) => {
  // The guide is public and linked from sign-in.
  await page.goto("/login");
  await page.getByTestId("guide-link").click();
  await expect(page.getByRole("heading", { name: /decides which shops may take card payments/ })).toBeVisible();

  // Closing a case without a resolution: the click explains instead of doing nothing.
  await page.goto("/login");
  await page.getByTestId("start-S5").click();
  await expect(page).toHaveURL(/\/cases\//);
  await page.getByTestId("close-case").click();
  await page.getByTestId("confirm-close").click();
  await expect(page.getByTestId("field-error")).toContainText("Choose how the case was resolved");
  await expect(page.getByTestId("resolution-code")).toBeFocused();
  await page.getByTestId("resolution-code").selectOption({ index: 1 });
  await page.getByTestId("confirm-close").click();
  await expect(page.getByTestId("field-error")).toContainText("Write a short reason first");

  // The auditor sees rules read-only, with no editing buttons that would do nothing.
  await page.goto("/login?switch=1");
  await page.getByTestId("login-AUDITOR").click();
  await page.goto("/rules");
  await page.locator("main a[href^='/rules/']").first().click();
  await expect(page.getByTestId("rule-readonly")).toContainText("Read-only for your role");
  await expect(page.getByRole("button", { name: "Add condition" })).toBeHidden();
});
