#!/usr/bin/env bash
# Build-once + serve. No HMR, no file watchers, no Vite dev server.
# Ideal for worktree agents doing UAT: fewer FDs, no WS flakiness, no EMFILE.
[ -f worktree.ports ] && source worktree.ports
exec npx wrangler dev --port "${WRANGLER_PORT:-8787}"
