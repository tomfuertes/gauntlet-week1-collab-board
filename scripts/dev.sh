#!/usr/bin/env bash
# Auto-load worktree port overrides (no-op in main repo)
[ -f worktree.ports ] && source worktree.ports
exec npx concurrently -n client,server -c blue,green "npm run dev:client" "npm run dev:server"
