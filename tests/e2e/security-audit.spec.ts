import { test, expect } from "@playwright/test";
import { login, idOf, sql } from "./helpers";

test("RBAC is enforced on the server", async ({ page, request }) => {
  expect((await request.get("/api/v1/merchants")).status()).toBe(401);
  await login(page, "ANALYST");
  for (const [method, url] of [["GET", "/api/v1/rules"], ["GET", "/api/v1/audit"], ["POST", "/api/v1/audit/verify"], ["GET", "/api/v1/admin/users"], ["POST", "/api/v1/admin/policies"]] as const) {
    const r = method === "GET" ? await page.request.get(url) : await page.request.post(url, { data: {} });
    expect(r.status(), `${method} ${url}`).toBe(403);
    expect((await r.json()).error.code).toBe("FORBIDDEN");
  }
  // The page is also closed to the role, not only hidden from the menu.
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
  expect((await page.request.get("/api/v1/portal/rfi/not-a-real-token-at-all-not-a-real-token-xyz")).status()).toBe(404);
});

test("owner PII is masked for analysts; a full view by a senior is audited", async ({ page }) => {
  const nimbus = idOf("US-QTG-30927");
  await login(page, "ANALYST");
  await page.goto(`/merchants/${nimbus}/ownership`);
  await expect(page.locator("[data-idno]").first()).toContainText("••••");
  await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);
  const owner = sql(`select id from "Owner" where "merchantId"='${nimbus}' limit 1`);
  expect((await page.request.post(`/api/v1/merchants/${nimbus}/owners/${owner}/reveal`)).status()).toBe(403);

  await login(page, "SENIOR_ANALYST");
  await page.goto(`/merchants/${nimbus}/ownership`);
  await page.getByRole("button", { name: "Reveal" }).first().click();
  await expect(page.locator("[data-idno]").first()).not.toContainText("••••");
  expect(Number(sql(`select count(*) from "AuditLog" where action='OWNER_PII_VIEWED'`))).toBeGreaterThan(0);
});

test("audit log: append-only in the database, and verification finds a tampered row", async ({ page }) => {
  // The database itself refuses UPDATE and DELETE.
  expect(() => sql(`update "AuditLog" set action='X' where id=(select min(id) from "AuditLog")`)).toThrow(/append-only/);
  expect(() => sql(`delete from "AuditLog" where id=(select min(id) from "AuditLog")`)).toThrow(/append-only/);

  await login(page, "AUDITOR");
  await page.goto("/audit");
  await page.getByTestId("verify-integrity").click();
  await expect(page.getByTestId("verify-result")).toContainText("Intact");

  // Simulate an attacker with table-owner rights who disables the trigger and edits one row.
  const victim = sql(`select id from "AuditLog" order by id limit 1 offset 5`);
  sql(`alter table "AuditLog" disable trigger audit_log_no_update; update "AuditLog" set after='{"status":"FORGED"}' where id=${victim}; alter table "AuditLog" enable trigger audit_log_no_update;`);
  await page.getByTestId("verify-integrity").click();
  await expect(page.getByTestId("verify-result")).toContainText(`Broken at entry ${victim}`);
});

test("Rules Studio: backtest is fast and a version needs a change note", async ({ page }) => {
  await login(page, "RISK_MANAGER");
  const ruleId = sql(`select id from "Rule" where key='R-VOL-SPIKE'`);
  await page.goto(`/rules/${ruleId}`);
  await page.getByLabel("Value", { exact: true }).fill("2500");
  const t0 = Date.now();
  await page.getByTestId("run-backtest").click();
  await expect(page.getByTestId("backtest-result")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect(page.getByTestId("save-rule")).toBeDisabled();
  await page.getByTestId("change-note").fill("Lower absolute floor to $2,500 to catch smaller merchants.");
  await page.getByTestId("save-rule").click();
  await expect(page.getByText("v2").first()).toBeVisible();
  expect(sql(`select count(*) from "RuleVersion" where "ruleId"='${ruleId}'`)).toBe("2");
  // JSON view round-trips and validates.
  await page.getByTestId("json-tab").click();
  await page.getByTestId("rule-json").fill('{"key":"R-VOL-SPIKE","scope":"merchant_daily","when":{"metric":"nope","op":">","value":1},"severity":"HIGH"}');
  await expect(page.getByTestId("rule-error")).toBeVisible();
});

test("CSV reports download and parse", async ({ page }) => {
  await login(page, "RISK_MANAGER");
  for (const name of ["underwriting-decisions", "active-controls", "terminations", "sla-by-analyst"]) {
    const r = await page.request.get(`/api/v1/reports/${name}.csv`);
    expect(r.status(), name).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/csv");
    const lines = (await r.text()).trim().split("\r\n");
    const cols = lines[0].split(",").length;
    for (const l of lines.slice(1)) if (!l.includes('"')) expect(l.split(",").length, `${name}: ${l}`).toBe(cols);
  }
});
