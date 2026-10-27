import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

export type Persona = "ANALYST" | "SENIOR_ANALYST" | "RISK_MANAGER" | "COMPLIANCE" | "AUDITOR" | "ADMIN";

export async function login(page: Page, role: Persona) {
  // Leave the page first: an in-flight request could otherwise re-set the session cookie
  // (Auth.js refreshes it on every request) right after we clear it.
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId(`login-${role}`).click();
  await page.waitForURL("**/dashboard");
}

/** Run SQL against this run's database (tests only: lookups and the tamper check). */
export function sql(query: string): string {
  return execFileSync("psql", [process.env.E2E_DATABASE_URL!.replace("?schema=public", ""), "-tAc", query], { encoding: "utf8" }).trim();
}

export function idOf(registrationNo: string): string {
  return sql(`select id from "Merchant" where "registrationNo"='${registrationNo}'`);
}

/** Move the simulated calendar on by n days, running every job (npm run demo:advance-day). */
export function advanceDays(n: number) {
  execFileSync("npx", ["tsx", "jobs/advance-day.ts", "--days", String(n)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, LOG_LEVEL: "warn" },
    stdio: "pipe",
    timeout: 600_000,
  });
}

export async function expectToast(page: Page, text: RegExp | string) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}
