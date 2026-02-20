#!/usr/bin/env bash
# Raise FD limit - macOS soft default is 256, insufficient for vite + wrangler + watchers
ulimit -n 10240 2>/dev/null  # silently no-ops if hard limit is lower
exec npx concurrently -n client,server -c blue,green \
  "npx vite --port ${VITE_PORT:-5173}" \
  "npx wrangler dev --port ${WRANGLER_PORT:-8787}"
