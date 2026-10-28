/** Runs once per server process, before requests are handled. */
export async function register() {
  // The import must sit inside this check so the edge bundle never sees Node-only modules.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { isMockMode } = await import("./lib/mode");
    if (isMockMode()) {
      const { startMockDatabase } = await import("./lib/mockdb");
      await startMockDatabase();
    }
  }
}
