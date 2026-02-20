#!/usr/bin/env bash
# Reads LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY from .dev.vars,
# base64-encodes them, and writes the token to .langfuse.local.token.
# Usage: scripts/langfuse-token.sh
#   Then: claude mcp add --transport http langfuse \
#           "$(cat .langfuse.local.token | jq -r .url)" \
#           --header "Authorization: Basic $(cat .langfuse.local.token | jq -r .token)"

set -euo pipefail
cd "$(dirname "$0")/.."

DEVVARS=".dev.vars"
if [[ ! -f "$DEVVARS" ]]; then
  echo "ERROR: $DEVVARS not found" >&2
  exit 1
fi

# Parse key=value (handles optional quotes and spaces around =)
get_var() {
  grep "^$1" "$DEVVARS" | cut -d= -f2- | tr -d ' "' | tr -d "'"
}

PK=$(get_var LANGFUSE_PUBLIC_KEY)
SK=$(get_var LANGFUSE_SECRET_KEY)
BASE_URL=$(get_var LANGFUSE_BASE_URL)

if [[ -z "$PK" || -z "$SK" ]]; then
  echo "ERROR: LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not found in $DEVVARS" >&2
  exit 1
fi

TOKEN=$(printf '%s:%s' "$PK" "$SK" | base64)
MCP_URL="${BASE_URL}/api/public/mcp"

# Write as JSON for easy consumption
cat > .langfuse.local.token <<EOF
{
  "token": "$TOKEN",
  "url": "$MCP_URL",
  "claude_mcp_add": "claude mcp add --transport http langfuse $MCP_URL --header \"Authorization: Basic $TOKEN\""
}
EOF

echo "Token written to .langfuse.local.token"
echo ""
echo "Run this to add the MCP server:"
echo "  claude mcp add --transport http langfuse \"$MCP_URL\" --header \"Authorization: Basic $TOKEN\""
