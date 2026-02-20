#!/usr/bin/env node
// Usage: node scripts/health.js [--port=5173] [--timeout=30] [--path=/api/health]
// Polls until the server responds or timeout. Exits 0 on success, 1 on timeout.
import http from "http";
import fs from "fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

// Auto-detect port: env var > worktree.ports > default 8787
let detectedPort = Number(process.env.WRANGLER_PORT || process.env.VITE_PORT || 0);
if (!args.port && !detectedPort && fs.existsSync("worktree.ports")) {
  const ports = fs.readFileSync("worktree.ports", "utf8");
  const wrangler = ports.match(/WRANGLER_PORT=(\d+)/);
  const vite = ports.match(/VITE_PORT=(\d+)/);
  if (wrangler) detectedPort = Number(wrangler[1]);
  else if (vite) detectedPort = Number(vite[1]);
}
const port = Number(args.port ?? (detectedPort || 8787));
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
