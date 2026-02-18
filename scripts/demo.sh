#!/bin/bash
# Alice & Bob collaboration demo in a headed browser.
# Starts the dev server, waits for ready, runs the demo, then cleans up.
# Uses a separate playwright config so E2E tests can run in parallel.
#
# Usage:
#   npm run demo              # Alice & Bob headed demo
#   npm run demo:e2e          # full E2E suite headed

set -e

VITE=${VITE_PORT:-5173}
WRANGLER=${WRANGLER_PORT:-8787}

cleanup() {
  if [ -n "$DEV_PID" ]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Ensure local D1 has tables
mkdir -p dist
npm run migrate:local

# Start dev server in background
VITE_PORT=$VITE WRANGLER_PORT=$WRANGLER npm run dev &
DEV_PID=$!

# Wait for wrangler (slower of the two)
echo "Waiting for dev server..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$WRANGLER/api/health" > /dev/null 2>&1; then
    echo "Server ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Server failed to start within 60s"
    exit 1
  fi
  sleep 2
done

# $1 selects the config: "e2e" for full suite, default for Alice & Bob demo
if [ "$1" = "e2e" ]; then
  VITE_PORT=$VITE WRANGLER_PORT=$WRANGLER npx playwright test --headed
else
  VITE_PORT=$VITE WRANGLER_PORT=$WRANGLER npx playwright test --config=playwright.demo.config.ts --headed
fi
