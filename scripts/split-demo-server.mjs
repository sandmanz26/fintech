/**
 * Test harness that mimics Vercel's layout in demo mode: page routes and API route handlers run
 * in two separate server processes, each with its own copy of the embedded database, behind one
 * proxy. If the UI ever reads or writes through /api/v1 directly, state diverges and the demo
 * journey test fails.
 *   node scripts/split-demo-server.mjs <port>
 */
import http from "node:http";
import { spawn } from "node:child_process";

const port = Number(process.argv[2] ?? 3300);
const pagesPort = port + 1;
const apiPort = port + 2;
const env = { ...process.env, SENTINEL_MOCK: "1", NEXT_DIST_DIR: ".next-demo" };
const kids = [pagesPort, apiPort].map((p) => spawn("npx", ["next", "start", "-p", String(p)], { env, stdio: "inherit" }));
const stop = () => kids.forEach((k) => k.kill("SIGTERM"));
process.on("SIGTERM", () => (stop(), process.exit(0)));
process.on("SIGINT", () => (stop(), process.exit(0)));

http
  .createServer((req, res) => {
    const target = req.url?.startsWith("/api/") ? apiPort : pagesPort;
    const up = http.request({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end("starting");
    });
    req.pipe(up);
  })
  .listen(port, () => console.log(`split demo: pages :${pagesPort}, api :${apiPort}, proxy :${port}`));
