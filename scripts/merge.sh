#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/merge.sh <branch>
# Merges feat/<branch> into current branch with --no-ff, runs typecheck.

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <branch>"
  echo "  Merges feat/<branch> into current branch"
  exit 1
fi

BRANCH="$1"
FEAT_BRANCH="feat/${BRANCH}"

# Check branch exists
if ! git show-ref --verify --quiet "refs/heads/${FEAT_BRANCH}"; then
  echo "Error: branch ${FEAT_BRANCH} does not exist" >&2
  exit 1
fi

# Show what we're merging
echo "=== Commits on ${FEAT_BRANCH} ==="
git log --oneline "main..${FEAT_BRANCH}"

echo ""
echo "=== Files changed ==="
git diff "main..${FEAT_BRANCH}" --stat

echo ""
echo "=== Merging ${FEAT_BRANCH} ==="
git merge "${FEAT_BRANCH}" --no-edit --no-ff

echo ""
echo "=== Typecheck ==="
npx tsc --noEmit

echo ""
echo "=== Merge complete ==="
git log --oneline -3
