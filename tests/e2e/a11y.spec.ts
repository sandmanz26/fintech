import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, idOf, sql } from "./helpers";

/** PRD §12 F10: axe reports no serious or critical violations on the main screens, light and dark. */
for (const theme of ["light", "dark"] as const) {
  test(`axe: no serious violations (${theme})`, async ({ page, context }) => {
    test.setTimeout(240_000);
    await login(page, "RISK_MANAGER");
    await context.addCookies([{ name: "theme", value: theme, url: page.url() }]);
    const glow = idOf("US-GSB-77104");
    const lumenApp = sql(`select a.id from "Application" a join "Merchant" m on m.id=a."merchantId" where m."registrationNo"='US-LTC-61530'`);
    const someCase = sql(`select id from "Case" where status<>'RESOLVED' order by "createdAt" limit 1`);
    const rule = sql(`select id from "Rule" where key='R-CB-RATIO'`);
    const pages = [
      "/",
      "/?lang=en",
      "/guide",
      "/dashboard",
      "/queues/unassigned",
      "/queues/underwriting-enhanced",
      "/merchants",
      `/merchants/${glow}`,
      `/merchants/${glow}/ownership`,
      `/merchants/${glow}/controls`,
      `/merchants/${glow}/timeline`,
      `/applications/${lumenApp}`,
      `/cases/${someCase}`,
      "/approvals",
      "/rules",
      `/rules/${rule}`,
      "/reports",
      "/audit",
      "/admin/policies",
      "/admin/reason-codes",
    ];
    const problems: string[] = [];
    for (const p of pages) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) {
        problems.push(`${p}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("axe: merchant portal on a phone", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/portal/rfi/this-token-does-not-exist-this-token-does-not");
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await ctx.close();
});
