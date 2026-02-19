#!/usr/bin/env bash
# localcurl - curl wrapper that structurally restricts to localhost only.
# Whitelisted in worktree settings as Bash(scripts/localcurl.sh:*).
# All curl flags pass through; rejects any URL not targeting localhost.
for arg in "$@"; do
  if [[ "$arg" =~ ^https?:// && ! "$arg" =~ ^https?://(localhost|127\.0\.0\.1)(:|/) ]]; then
    echo "Error: localcurl only allows localhost URLs, got: $arg" >&2
    exit 1
  fi
done
exec curl -s "$@"
