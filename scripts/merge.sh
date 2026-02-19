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
if ! git merge "${FEAT_BRANCH}" --squash; then
  echo ""
  echo "CONFLICT: Merge has conflicts. Resolve them, then:"
  echo "  git add <resolved-files> && git commit --no-edit"
  [[ "$STASHED" == true ]] && echo "  git stash pop  # restore your uncommitted changes"
  STASHED=false  # don't auto-pop in trap, user needs to resolve first
  exit 1
fi

# Squash stages but doesn't commit - create the commit here so GPG signing works locally
COMMIT_MSG=$(git log --oneline "main..${FEAT_BRANCH}" | head -1 | cut -d' ' -f2-)
git commit --no-gpg-sign --no-edit -m "${COMMIT_MSG:-Merge branch '${FEAT_BRANCH}'}"

echo ""
echo "=== Typecheck ==="
npx tsc --noEmit

echo ""
echo "=== Merge complete ==="
git log --oneline -3

# --- Consolidate session file into notes.md ---
SESSION_FILE="docs/sessions/${BRANCH}.md"
if [[ -f "${SESSION_FILE}" ]]; then
  echo ""
  echo "=== Consolidating session file: ${SESSION_FILE} ==="
  # Append session contents under a dated header
  printf '\n## Session: %s (%s)\n\n' "${BRANCH}" "$(date +%Y-%m-%d)" >> docs/notes.md
  cat "${SESSION_FILE}" >> docs/notes.md
  printf '\n' >> docs/notes.md
  rm "${SESSION_FILE}"
  git add docs/notes.md "${SESSION_FILE}"
  git commit --no-gpg-sign -m "docs: consolidate ${BRANCH} session notes"
  echo "Session file consolidated into docs/notes.md"
else
  echo ""
  echo "(No session file found at ${SESSION_FILE} - skipping consolidation)"
fi

# --- Print what's next summary ---
echo ""
echo "=== What's Next ==="
# Show Loose Ends and Next/Unshipped sections from notes.md
awk '/^## Loose Ends/,/^## [^L]/' docs/notes.md | head -30
echo "---"
awk '/^## Next \/ Unshipped/,/^## [^N]/' docs/notes.md | head -20

# Squash commit uses --no-gpg-sign (sandbox can't reach GPG agent socket).
# Remind user to sign if they have gpgsign configured.
if git config --get commit.gpgsign &>/dev/null; then
  echo ""
  echo "⚠ Unsigned commit(s). To GPG sign: git commit --amend --no-edit"
fi
