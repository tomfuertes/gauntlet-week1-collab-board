#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/worktree.sh create <branch>    # create worktree + unlock git-crypt + print claude cmd
#   scripts/worktree.sh remove <branch>    # remove worktree + delete branch
#   scripts/worktree.sh list               # list active worktrees

REPO_NAME="gauntlet-week1-collab-board"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$REPO_ROOT")"

usage() {
  echo "Usage: $0 {create|remove|list} [branch]"
  echo ""
  echo "  create <branch>  Create worktree at ../${REPO_NAME}-<branch>, unlock git-crypt"
  echo "  remove <branch>  Remove worktree and delete feat/<branch>"
  echo "  list             List active worktrees"
  exit 1
}

cmd_create() {
  local branch="$1"
  local wt_dir="${PARENT_DIR}/${REPO_NAME}-${branch}"
  local feat_branch="feat/${branch}"

  if [[ -d "$wt_dir" ]]; then
    echo "Error: ${wt_dir} already exists" >&2
    exit 1
  fi

  echo "Creating worktree at ${wt_dir} on branch ${feat_branch}..."

  # Create worktree, bypassing git-crypt smudge filter
  GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=filter.git-crypt.smudge \
    GIT_CONFIG_VALUE_0=cat \
    git worktree add "$wt_dir" -b "$feat_branch"

  # Unlock git-crypt in the worktree (bypass filters, unlock, filters auto-restore)
  git -C "$wt_dir" config filter.git-crypt.clean cat
  git -C "$wt_dir" config filter.git-crypt.smudge cat
  git -C "$wt_dir" config filter.git-crypt.required false

  local key_path
  key_path="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)/git-crypt/keys/default"
  (cd "$wt_dir" && git-crypt unlock "$key_path")

  echo ""
  echo "Worktree ready. To start working:"
  echo "  cd ${wt_dir} && claude"
  echo ""
  echo "Dev server (avoid port conflicts):"
  echo "  VITE_PORT=5174 WRANGLER_PORT=8788 npm run dev"
}

cmd_remove() {
  local branch="$1"
  local wt_dir="${PARENT_DIR}/${REPO_NAME}-${branch}"
  local feat_branch="feat/${branch}"

  if [[ ! -d "$wt_dir" ]]; then
    echo "Error: ${wt_dir} does not exist" >&2
    exit 1
  fi

  echo "Removing worktree at ${wt_dir}..."
  git worktree remove "$wt_dir"

  if git show-ref --verify --quiet "refs/heads/${feat_branch}"; then
    echo "Deleting branch ${feat_branch}..."
    git branch -D "$feat_branch"
  fi

  echo "Done."
}

cmd_list() {
  git worktree list
}

[[ $# -lt 1 ]] && usage

case "$1" in
  create)
    [[ $# -lt 2 ]] && usage
    cmd_create "$2"
    ;;
  remove)
    [[ $# -lt 2 ]] && usage
    cmd_remove "$2"
    ;;
  list)
    cmd_list
    ;;
  *)
    usage
    ;;
esac
