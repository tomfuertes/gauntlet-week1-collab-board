#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/merge.sh <branch>
# Merges feat/<branch> into current branch with --no-ff, runs typecheck.
# Auto-stashes dirty working tree so uncommitted docs/notes edits don't block.

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

# Auto-stash dirty state (tracked + untracked, not gitignored)
STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "=== Stashing uncommitted changes ==="
  git stash push -u -m "merge.sh auto-stash before merging ${FEAT_BRANCH}"
  STASHED=true
fi

# Restore stash on any failure so uncommitted work isn't silently lost
cleanup() {
  local exit_code=$?
  if [[ "$STASHED" == true ]]; then
    echo ""
    echo "=== Restoring stashed changes (script exited with code ${exit_code}) ==="
    git stash pop || echo "WARNING: stash pop failed - run 'git stash pop' manually"
  fi
}
trap cleanup EXIT

# Show what we're merging
echo "=== Commits on ${FEAT_BRANCH} ==="
git log --oneline "main..${FEAT_BRANCH}"

echo ""
echo "=== Files changed ==="
git diff "main..${FEAT_BRANCH}" --stat

echo ""
echo "=== Merging ${FEAT_BRANCH} ==="
if ! git -c commit.gpgsign=false merge "${FEAT_BRANCH}" --no-edit --no-ff; then
  echo ""
  echo "CONFLICT: Merge has conflicts. Resolve them, then:"
  echo "  git add <resolved-files> && git commit --no-edit"
  [[ "$STASHED" == true ]] && echo "  git stash pop  # restore your uncommitted changes"
  STASHED=false  # don't auto-pop in trap, user needs to resolve first
  exit 1
fi

echo ""
echo "=== Typecheck ==="
npx tsc --noEmit

echo ""
echo "=== Merge complete ==="
git log --oneline -3
