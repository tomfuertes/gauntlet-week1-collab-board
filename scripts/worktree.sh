#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/worktree.sh create <branch>    # create worktree + unlock git-crypt + print claude cmd
#   scripts/worktree.sh remove <branch>    # remove worktree + delete branch
#   scripts/worktree.sh list               # list active worktrees

REPO_NAME="gauntlet-week1-collab-board"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$REPO_ROOT")"

# Main repo uses 5173/8787. Each worktree gets a unique port pair.
# Scans existing worktree.ports files to find the lowest unused offset.
next_port_offset() {
  local used=()
  while IFS= read -r wt_path; do
    local env_file="${wt_path}/worktree.ports"
    if [[ -f "$env_file" ]]; then
      local port
      port=$(sed -n 's/.*VITE_PORT=\([0-9]*\).*/\1/p' "$env_file" 2>/dev/null || true)
      if [[ -n "$port" ]]; then
        used+=( $(( port - 5173 )) )
      fi
    fi
  done < <(git worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //' | grep -v "^${REPO_ROOT}$")

  # Find lowest unused offset starting at 1
  local offset=1
  while [[ ${#used[@]} -gt 0 ]] && printf '%s\n' "${used[@]}" | grep -qx "$offset" 2>/dev/null; do
    offset=$(( offset + 1 ))
  done
  echo "$offset"
}

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

  # Seed node_modules: CoW copy for speed, then npm install for correctness
  if [[ -d "${REPO_ROOT}/node_modules" ]]; then
    echo "Seeding node_modules (APFS copy-on-write)..."
    cp -ca "${REPO_ROOT}/node_modules" "${wt_dir}/node_modules"
  fi
  echo "Installing dependencies..."
  (cd "$wt_dir" && npm install --prefer-offline 2>&1 | tail -1)

  # Copy local secrets (.dev.vars) so worktrees can run wrangler dev with API keys
  [[ -f "${REPO_ROOT}/.dev.vars" ]] && cp "${REPO_ROOT}/.dev.vars" "${wt_dir}/.dev.vars"

  # Seed Claude Code with baseline dev permissions so worktree sessions don't re-prompt.
  # Only includes universal dev workflow commands - session-specific WebFetch domains
  # and one-off tools are left for per-session approval.
  mkdir -p "${wt_dir}/.claude"
  cat > "${wt_dir}/.claude/settings.local.json" << 'SETTINGS'
{
  "permissions": {
    "allow": [
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git pull:*)",
      "Bash(git reset:*)",
      "Bash(git-crypt:*)",
      "Bash(git-crypt status:*)",
      "Bash(npm install:*)",
      "Bash(npm run:*)",
      "Bash(npx vite build:*)",
      "Bash(npx wrangler:*)",
      "Bash(killport:*)",
      "Bash(scripts/localcurl.sh:*)",
      "Bash(gh pr:*)",
      "Bash(git checkout:*)",
      "Bash(git branch:*)",
      "Bash(git merge:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git status:*)",
      "Bash(git stash:*)",
      "Skill(playwright-cli)",
      "Bash(playwright-cli:*)",
      "WebFetch(domain:developers.cloudflare.com)",
      "WebFetch(domain:registry.npmjs.org)",
      "Bash(npx playwright:*)",
      "WebFetch(domain:api.cloudflare.com)",
      "WebFetch(domain:collabboard.thomas-fuertes.workers.dev)",
      "WebFetch(domain:*.thomas-fuertes.workers.dev)"
    ]
  }
}
SETTINGS
  echo "Seeded .claude/settings.local.json (baseline dev permissions)"

  # Assign unique ports to avoid collisions with main (5173/8787) and other worktrees
  local offset
  offset=$(next_port_offset)
  local vite_port=$(( 5173 + offset ))
  local wrangler_port=$(( 8787 + offset ))

  cat > "${wt_dir}/worktree.ports" << EOF
export VITE_PORT=${vite_port}
export WRANGLER_PORT=${wrangler_port}
export WRANGLER_SEND_METRICS=false
EOF
  echo "Assigned ports: Vite=${vite_port}, Wrangler=${wrangler_port}"

  echo ""
  echo "Worktree ready. To start working:"
  echo "  cd ${wt_dir} && claude"
  echo ""
  echo "Dev server (ports auto-loaded from worktree.ports):"
  echo "  npm run dev"
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
  # --force handles gitignored/untracked files (node_modules, .dev.vars, worktree.ports).
  # Dirty tracked files still error out - commit or stash first.
  git worktree remove --force "$wt_dir"

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
