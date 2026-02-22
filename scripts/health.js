#!/usr/bin/env node
// Usage: node scripts/health.js [--port=5173] [--timeout=30] [--path=/api/health]
// Polls until the server responds or timeout. Exits 0 on success, 1 on timeout.
import http from "http";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const port = Number(args.port ?? process.env.WRANGLER_PORT ?? process.env.VITE_PORT ?? 8787);
const timeout = Number(args.timeout ?? 30) * 1000;
const path = args.path ?? "/";
const interval = 500;
const deadline = Date.now() + timeout;

function check() {
  const req = http.get({ hostname: "localhost", port, path }, (res) => {
    console.log(`[health] localhost:${port}${path} -> ${res.statusCode}`);
    process.exit(0);
  });
  req.on("error", () => {
    if (Date.now() >= deadline) {
      console.error(`[health] timed out after ${timeout / 1000}s waiting for localhost:${port}`);
      process.exit(1);
    }
    setTimeout(check, interval);
  });
  req.end();
}

console.log(`[health] waiting for localhost:${port}${path} (timeout: ${timeout / 1000}s)...`);
check();
