# Session: Prompt Eval Harness Investigation

**Date:** 2026-02-20
**Task:** #8 - Prompt Eval Harness - baseline v6 metrics
**Status:** BLOCKED - Escalated to team-lead

## Problem

All 10 eval scenarios fail with identical error: `WS error: Unexpected server response: 400` during WebSocket upgrade to `/agents/ChatAgent/{boardId}`.

## Root Cause Analysis

### What Works
- Dev server running (workerd PID 26482 on port 8787)
- Auth system operational (eval user signup + login successful)
- Board CRUD API operational (eval board created successfully)
- Database connectivity (all prerequisite APIs functioning)

### What Fails
- WebSocket upgrade to `/agents/ChatAgent/{boardId}` returns HTTP 400 instead of switching to WebSocket protocol
- Error is systematic across all 10 scenarios
- Error occurs during routing/validation phase (not auth layer)

### Technical Breakdown

The eval script:
1. ✅ Authenticates via `/auth/login` (session cookie obtained)
2. ✅ Creates board via `POST /api/boards` (board ID: 08150003-8776-4d14-9861-c87d45d2f84d)
3. ✅ Clears board via `POST /api/board/{boardId}/clear` (before each scenario)
4. ❌ Attempts WebSocket upgrade to `/agents/ChatAgent/{boardId}` with CF_AGENT protocol
   - Returns HTTP 400 instead of WebSocket 101 Upgrade
   - Suggests validation failure in routing layer

### Code Path Traced
1. Request → `/agents/*` route handler in `src/server/index.ts:430`
2. Handler calls `routeAgentRequest(c.req.raw, c.env)` from "agents" v0.5.0
3. routeAgentRequest delegates to `routePartykitRequest` with prefix "agents"
4. **Returns:** HTTP 400 (routing failure, not discovered)

### Likely Root Causes
1. **Missing configuration** - agents SDK might require `[agents]` section in wrangler.toml
2. **Breaking change** - agents v0.5.0 might have changed endpoint routing format
3. **Runtime discovery failure** - ChatAgent not discoverable by routeAgentRequest at runtime
4. **Dev server state** - export changes might not have taken effect without rebuild/restart

## Investigation Performed

- ✅ Verified dev server is running and responsive (port 8787 confirmed via lsof)
- ✅ Tested auth flow (created eval user, login works)
- ✅ Tested board API (board creation successful)
- ✅ Reviewed server code (`/agents/*` route, ChatAgent export, index.ts)
- ✅ Checked git history (feature added in commit 6852257, working at that time)
- ✅ Reviewed agents package implementation (`routeAgentRequest` → `routePartykitRequest`)
- ✅ Confirmed partyserver is installed as dependency
- ❌ Could not test HTTP POST to endpoint (would isolate WS-specific issues)
- ❌ Could not check partyserver logs for detailed error info
- ❌ Could not restart dev server or modify wrangler.toml to test config changes

## Key Insight

This is a **known working feature** (commit 6852257, merged to main on 2026-02-19). The eval harness was implemented and committed successfully. This indicates the failure is likely environmental/configuration rather than a code bug:
- Maybe a dependency version mismatch
- Maybe a missing wrangler.toml configuration
- Maybe the dev server needs a clean rebuild

## Recommended Next Steps

**For team-lead (in priority order):**

1. **Quick fix (1 min):** Kill and restart `npm run dev` in a fresh terminal
   - Agents exports might need reloading
   - This is the fastest sanity check

2. **Configuration check (2 min):** Review wrangler.toml for agents config
   - Check if `[agents]` section is needed (undocumented in current setup)
   - Compare with agents SDK documentation

3. **Isolation test (5 min):** Test HTTP endpoint to rule out WS-specific issues
   - POST to `/agents/ChatAgent/test-id` with session cookie
   - If also 400, it's routing; if different error, it's WS protocol

4. **Deeper investigation (10 min):** Check agents v0.5.0 breaking changes
   - Review package release notes
   - Check if endpoint format changed

5. **Production comparison (10 min):** If prod eval works, compare environments
   - wrangler.toml versions and config
   - agents/partyserver versions
   - any deployment-specific setup

## Files Involved

- `scripts/prompt-eval.ts` - Eval harness script (correct, uses proper CF_AGENT protocol)
- `src/server/index.ts` - `/agents/*` route (correct, uses routeAgentRequest)
- `src/server/chat-agent.ts` - ChatAgent class (correct, exports properly)
- `wrangler.toml` - Deployment config (might be missing [agents] section)
- `package.json` - Dependencies (agents v0.5.0, @cloudflare/ai-chat v0.1.2)

## Blocking Context

This task is 100% blocked on the agents SDK routing issue. Cannot proceed until:
- `/agents/ChatAgent/{boardId}` WebSocket upgrade returns 101 instead of 400
- OR alternative eval methodology is implemented

Cannot unblock independently - requires team lead investigation of Cloudflare Agents SDK setup.
