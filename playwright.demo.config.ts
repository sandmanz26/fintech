import { defineConfig } from "@playwright/test";

/**
 * Demo mode end to end: the production build with no DATABASE_URL and no AUTH_SECRET, the way a
 * zero-configuration Vercel deployment runs, with pages and API split as Vercel splits them. The server loads the embedded mock database
 * (`npm run mock:build` first). Every run starts from the same snapshot.
 */
const PORT = Number(process.env.DEMO_PORT ?? 3300);

export default defineConfig({
  testDir: "tests/e2e-demo",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    // Pages and API in separate processes, each with its own embedded database, like Vercel's
    // function split. SENTINEL_MOCK forces demo mode even when a local .env names a database.
    command: `node scripts/split-demo-server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
