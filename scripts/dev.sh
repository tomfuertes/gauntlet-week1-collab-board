#!/usr/bin/env bash
# Raise FD limit - macOS soft default is 256, insufficient for vite + wrangler + watchers
ulimit -n 10240 2>/dev/null  # silently no-ops if hard limit is lower
# Auto-load worktree port overrides (no-op in main repo)
[ -f worktree.ports ] && source worktree.ports
exec npx concurrently -n client,server -c blue,green "npm run dev:client" "npm run dev:server"
