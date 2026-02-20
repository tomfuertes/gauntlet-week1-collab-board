#!/usr/bin/env bash
# Build-once + serve. No HMR, no file watchers, no Vite dev server.
exec npx wrangler dev --port "${WRANGLER_PORT:-8787}"
