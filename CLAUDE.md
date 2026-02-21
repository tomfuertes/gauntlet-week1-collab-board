# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

YesAInd - multiplayer improv canvas with AI agent integration. Real-time collaborative whiteboard where players and AI improvise scenes together. Solo dev with AI-first methodology (Claude Code + Cursor).

## Stack

React + Vite + react-konva + TypeScript | Cloudflare Workers + Hono + Durable Objects | D1 + DO Storage

**Key server files:**

| File | What it does |
|------|-------------|
| `src/server/index.ts` | Hono routes, board CRUD, DO exports, WS upgrade, persona/replay/gallery APIs |
| `src/server/chat-agent.ts` | ChatAgent DO - AI chat, troupe config, stage manager, audience polls/waves, persona claims, director nudges |
| `src/server/ai-tools-sdk.ts` | 19 AI tools incl. askAudience (Zod schemas, batchExecute meta-tool) |
| `src/server/prompts/` | Prompt modules: `system.ts` (core prompt), `intents.ts`, `personas.ts`, `game-modes.ts`, `dramatic-arc.ts`, `stage-manager.ts`, `reactions.ts`, `critic.ts`, `index.ts` (barrel + PROMPT_VERSION) |
| `src/server/tracing-middleware.ts` | AI SDK middleware -> D1 traces + optional Langfuse |
| `src/server/auth.ts` | Passkey/WebAuthn primary auth + password fallback (PBKDF2 timing-safe, D1 sessions, rate limiting) |
| `src/shared/types.ts` | Persona, BoardObject, GameMode, AIModel, AI_MODELS, TroupeConfig, Poll, WaveEffect, canvas bounds constants |
| `src/shared/board-templates.ts` | Template registry: typed BoardObject arrays, displayText, `getTemplateById()` for server-side seeding |

**Key client files:**

| File | What it does |
|------|-------------|
| `src/client/components/Board.tsx` | Canvas + chat integration, mobile layout, model/persona state |
| `src/client/components/ChatPanel.tsx` | AI chat sidebar, persona claim pills, intent chips, useAgentChat |
| `src/client/components/OnboardModal.tsx` | 3-step wizard: troupe builder (per-character model select) + invite + the get |
| `src/client/components/AuthForm.tsx` | Passkey/WebAuthn registration + login UI with password fallback |

**AI architecture (gotchas that will bite you):**
- 8 models across 3 providers. `body.model` sent per-message for DO hibernation resilience.
- Per-player persona claims via `body.personaId` (same per-message pattern). Fallback: round-robin.
- Reactive persona fires via `ctx.waitUntil` after each response. First exchange unreliable (timing gap).
- Class-level state resets on DO hibernation. Client re-sends model/gameMode/personaId each message.
- `tool_choice: "auto"` shim extracted to `getShimmedWorkersAI()` helper in chat-agent.ts (CF issue #404). Single call site.
- Canvas bounds exported as `CANVAS_MIN_X/Y`, `CANVAS_MAX_X/Y` from shared/types.ts. Used in prompts.ts, index.ts, chat-agent.ts.
- Default model is Claude Haiku 4.5. GLM available but degrades by exchange 3+.
- Deploy via `git push` to main (CF git integration). Never `wrangler deploy` manually.

## Prompt Tuning Notes

- **Haiku ignores soft rules.** "Create ONLY objects requested" is treated as a suggestion. Use hard caps: "NEVER create more than N objects per response."
- **getBoardState pre-check can regress simple layouts** - model wastes a tool call and loses track of constraints. Removed in v19.
- **v19 baseline (Haiku):** 3/10 layout pass, avg overlap 3.6 (down from 5.7 in v17).
- **v20 baseline (Haiku):** 4/10 layout pass, avg overlap 3.5, OOB=0. Narrative 3.2/5 (first clean judge run). Server-side enforcement eliminated OOB entirely. Over-creation in complication/character-intro still bypasses count cap (see #195). tool_usage scored 1/5 across all narratives - model creates text objects only, no visual storytelling tools (see #196).
- **Remaining layout killers:** over-creation in open-ended scenes (complication, character-intro) - count cap may not fire correctly for batchExecute. Prompt stripped too aggressively on visual tool emphasis.

## Commands

```bash
# Dev
npm run dev              # build once + wrangler dev (no HMR/watchers)
npm run dev:hmr          # Vite HMR + wrangler dev (escape hatch if live editing needed)
npm run health           # wait for dev server (polls 500ms) - use instead of sleep

# Build & Deploy (CF git integration auto-deploys on push to main)
npm run build            # Vite build
npm run deploy           # Vite build + wrangler deploy (manual fallback)

# D1 Migrations (tracked via d1_migrations table)
npx wrangler d1 migrations create collabboard-db "describe_change"  # create new
npm run migrate              # apply pending to local + remote
npm run migrate:local        # apply pending to local only
npm run migrate:remote       # apply pending to remote only

# Prompt Eval Harness (requires dev server running)
# IMPORTANT: source .dev.vars first - eval/judge scripts need API keys as shell env vars
source .dev.vars && EVAL_MODEL=claude-haiku-4.5 npm run eval   # run all scenarios
# EVAL_USERNAME/EVAL_PASSWORD/EVAL_MODEL env vars override defaults (eval/eval1234/glm-4.7-flash)
# JSON reports written to scripts/eval-results/<timestamp>.json (gitignored, kept on disk for reference)
# Quick summary: jq '{model, layout: "\(.layout.passed)/\(.layout.total)", overlap: .layout.avgOverlap}' scripts/eval-results/*.json
# Compare runs: npm run eval:compare scripts/eval-results/A.json scripts/eval-results/B.json

# Format & Audit
npm run format           # prettier --write
/audit                   # on-demand code quality checks (replaced ESLint)

# Type Check (always use npm run typecheck, not bare tsc)
npm run typecheck        # wrangler types + tsc --noEmit (generates CF Workers bindings first)
# NEVER use bare `npx tsc --noEmit` - it skips wrangler types and shows false CF type errors

# Dependency Updates
npm run update-deps      # bumps all deps except vite/plugin-react (major), then npm ci
```

## Git Worktrees

After worktree creation, run `npm ci` to install deps (lockfile-only, fast). If the agent needs API keys (eval, dev server), copy `.dev.vars`: `cp /Users/tomfuertes/sandbox/git-repos/gauntlet-week1-collab-board/.dev.vars .dev.vars`.

See `~/.claude/CLAUDE.md` for universal worktree conventions (merge safety, absolute paths, isolation).

## Browser Testing (playwright-cli)

See `~/.claude/CLAUDE.md` for universal browser testing conventions (artifacts dir, proactive use, snapshots vs screenshots, sandbox flag).

**UAT and quality exploration swarms should target production** (`https://yesaind.com`), not localhost. Prod is what real users see and avoids wrangler dev quirks (DO cold starts, WS flakiness, single-IP rate limit buckets). Only use localhost for testing uncommitted code changes.

```bash
# Basic flow
playwright-cli open http://localhost:5173    # open app (localhost for dev)
playwright-cli snapshot                       # get element refs (e.g., e3, e15)
playwright-cli fill e5 "username"             # interact by ref
playwright-cli click e3                       # click by ref
playwright-cli screenshot --filename=playwright/verify.png  # visual verification
playwright-cli close                          # cleanup

# Two-browser sync testing (primary validation method)
playwright-cli -s=user1 open http://localhost:5173
playwright-cli -s=user2 open http://localhost:5173
# ...interact in each session independently...
playwright-cli close-all

# Auth state
playwright-cli cookie-list                    # inspect session cookies
playwright-cli state-save auth-user1.json     # save auth state for reuse
playwright-cli state-load auth-user1.json     # restore auth state
```

### E2E Tests (Playwright)

```bash
npx playwright test                    # run all tests
npx playwright test e2e/sync.spec.ts   # run one file
npx playwright test --reporter=dot     # minimal output (default 'list' floods context)
```

**Known gotchas:**
- **Reactive persona UAT timing:** SAGE/reactive persona reliably triggers on the 2nd+ exchange, not the 1st (timing gap: `ctx.waitUntil` fires before base class adds the new assistant message to `this.messages`). GLM reactive `generateText` takes 30-40s. UAT must send a follow-up message before testing SAGE, then wait 45-60s.
- **WS flakiness in local dev is expected.** First WS connection often drops with wrangler dev (DO cold start during WS handshake). The app reconnects but E2E/UAT tests must account for this. **After navigating to a board, always wait for `[data-state="connected"]` before interacting.** This selector is on the connection status dot in the header. Use `createObjectsViaWS()` helper (in `e2e/helpers.ts`) instead of UI double-click for reliable object creation. `wsRef.current` can be null after a drop even when React state shows "connected".
- **HMR hook-order false positive:** "React has detected a change in the order of Hooks called by Board" during dev = Vite HMR artifact, not a real bug. Full page reload fixes it. Never investigate this error in a live dev session.

## Architecture

### Monorepo Layout

```
src/
  client/               # React SPA
    App.tsx             # Hash routing (#board/{id}, #replay/{id}, #watch/{id}, #gallery)
    theme.ts            # Color constants (accent, surfaces, cursors)
    components/
      Board.tsx         # Canvas + chat + mobile layout (<=768px responsive)
      Toolbar.tsx       # Floating tool buttons, mode switching
      BoardObjectRenderer.tsx  # Konva shape renderer (all object types)
      BoardList.tsx     # Board grid (CRUD) - landing page
      ChatPanel.tsx     # AI chat sidebar, persona claim pills, intent chips
      CanvasPreview.tsx # Mobile read-only canvas strip
      ReplayViewer.tsx  # Public scene replay (no auth)
      SpectatorView.tsx # Public live view + emoji reactions + poll voting (no auth)
      SceneGallery.tsx  # Public gallery grid (#gallery)
      PerfOverlay.tsx   # FPS/connection overlay (Shift+P)
      AiCursor.tsx      # Purple dot animating to AI creation points
      WaveEffect.tsx    # Audience wave canvas effects (confetti, shake, glow, etc.)
      # Also: Button, Modal, TextInput, ConnectionToast, ConfettiBurst, BoardGrid
    hooks/
      useWebSocket.ts        # Board DO WebSocket state
      useSpectatorSocket.ts  # Spectator WebSocket (read-only)
      useUndoRedo.ts         # Local undo/redo (max 50)
      # Also: useThrottledCallback, useAiObjectEffects, useKeyboardShortcuts,
      #       useDragSelection, useIsMobile
    styles/
      animations.css    # Shared keyframes
  server/               # (see Stack tables above for server files)
  shared/types.ts       # BoardObject, WSMessage, Persona, GameMode, AIModel, TroupeConfig, Poll, WaveEffect
migrations/             # D1 SQL (npm run migrate)
```

### Data Flow

1. Auth via passkey/WebAuthn (primary: /auth/passkey/register|login/options+verify) or password fallback (/auth/signup, /auth/login); issues session cookie
2. BoardList (`GET /api/boards`) -> select/create board -> `#board/{id}`
3. WebSocket to `wss://host/board/:id` (cookie validated before upgrade)
4. Board DO manages state: objects in DO Storage (`obj:{uuid}`), cursors in memory
5. Mutations: client optimistic -> DO persists + broadcasts to others
6. AI: client WS to ChatAgent DO (`/agents/ChatAgent/<boardId>`) -> `streamText()` with tools -> Board DO RPC for canvas mutations
7. Replay: DO records mutations as `evt:{ts}:{rand}` keys (max 2000). Public `GET /api/boards/:id/replay`
8. Gallery: Public `GET /api/boards/public` (D1 join). `#gallery` -> `#replay/{id}`
9. Spectator: `GET /ws/watch/:boardId` (no auth). Read-only + cursor/reactions/poll votes
10. Eval API: `GET /api/boards/:boardId/objects` returns objects + quality metrics

### WebSocket Protocol

```
Player -> DO:    cursor | obj:create | obj:update | obj:delete | batch:undo | reaction
Spectator -> DO: cursor | reaction | poll:vote (all other messages silently dropped)
DO -> Client:    cursor | obj:create | obj:update | obj:delete | presence | init | reaction | poll:start | poll:result | audience:wave
```

DO echoes mutations to OTHER clients only (sender already applied optimistically). Presence messages include `spectatorCount` (number of anonymous spectator connections). Reactions are broadcast to ALL clients (including sender - no optimistic apply). Reaction emoji whitelist + 1/sec rate limit enforced server-side.

**IMPORTANT:** The WS message field for objects is `obj` (not `object`). Example: `{ type: "obj:create", obj: { id, type, x, y, ... } }`. Using `object` instead of `obj` silently fails - the DO ignores the message.

**Ephemeral state TTL pattern:** For cursor-like state that relies on explicit cleanup messages (e.g. `text:blur`), also track `lastSeen` + sweep with `setInterval`. Messages can be dropped on WS disconnect; TTL ensures eventual consistency without server changes.

**DO hibernation:** Class-level properties reset on hibernation. Store ephemeral per-connection state in `ws.serializeAttachment()` - survives hibernation and is readable in `webSocketClose`. Rate-limit maps (e.g. `lastReactionAt`) reset on hibernation, which is correct - the cooldown is short-lived and doesn't need persistence.

### Board Object Shape

```typescript
{ id, type, x, y, width, height, rotation, props: { text?, color?, fill?, stroke?, arrow?, src?, prompt? }, createdBy, updatedAt, batchId? }
```

Each object stored as separate DO Storage key (`obj:{uuid}`, ~200 bytes). LWW via `updatedAt`. `batchId` groups AI-created objects from a single `streamText` call for batch undo. Replay events stored as `evt:{16-padded-ts}:{4-char-rand}` keys (max 2000, `obj:update` debounced 500ms per object).

## Key Constraints

- Deploy via `git push` to main (CF git integration). Never `wrangler deploy` manually.
- `_isGenerating` mutex uses `withGenerating()` try/finally wrapper. `onChatMessage` extends its try block manually (streaming outlives function scope). Rate check must happen BEFORE claiming mutex.
- Never expose API keys to client bundle - all AI calls server-side.
- `getUserColor(userId)` is hash-based (not array-index). Same palette in Board.tsx and Cursors.tsx.
- Dev: `scripts/dev.sh` raises `ulimit -n 10240` (macOS default 256 causes EMFILE in multi-worktree).
- Wrangler auth: `env.AI` binding is `remote` mode - requires `wrangler login` or `CLOUDFLARE_API_TOKEN` even in local dev. Server won't start without auth. Eval models (Anthropic/OpenAI) don't use this binding but wrangler still requires auth to boot. To stub out for offline dev, comment out `[ai]` block in wrangler.toml.

## Doc Sync

- **No session notes or docs/ files.** `docs/` directory was removed. Task list + git log is the source of truth.

See `~/.claude/CLAUDE.md` for session start ritual and doc sync conventions.

## Custom Agents (Delegation)

See `~/.claude/CLAUDE.md` for agent workflow, model selection, and team conventions. Below is project-specific delegation config.

| Task | Agent | Model | Mode | How |
|------|-------|-------|------|-----|
| Feature worktree | `general-purpose` | sonnet | `bypassPermissions` | team member |
| Design / architecture | `general-purpose` | opus | `bypassPermissions` | team member |
| UAT / smoke test | `uat` | sonnet | `bypassPermissions` | team member |
| Quality exploration | `general-purpose` | sonnet | `bypassPermissions` | team member |
| PR review | `pr-review-toolkit:*` | sonnet | default | invoked by worktree agent via Skill |
| E2E / eval harness | `general-purpose` | sonnet | `bypassPermissions` | team member (reports via SendMessage) |
| Codebase exploration | `Explore` (built-in) | sonnet | default | team member or background (atomic) |

**Agent prompts must explicitly mention:**
- **Dev server startup** (only if UAT/eval needed): `npx wrangler whoami` first to verify auth. If not authenticated, escalate to team-lead immediately - do not attempt `npm run dev`. If auth OK: `npm run dev` with `run_in_background: true` and `dangerouslyDisableSandbox: true`. Wait 8s, read background task output to confirm no errors, THEN `npm run health`. If dev server errors, do NOT retry - escalate immediately via SendMessage with full error output.
- "Read CLAUDE.md and relevant source files before implementing"
- "Commit all changes to the feature branch. Do not open a PR."
- **KEY-DECISION comments**: `// KEY-DECISION <YYYY-MM-DD>: <rationale>` at the code location.
- `"Write your implementation plan to $TMPDIR/plan-{task-id}.md before coding"` - if the agent runs out of context, the orchestrator can read the plan to assess progress and hand off cleanly.
- Agents should prefer atomic tool calls over exploratory browsing to conserve context window.

## Conventions

- TypeScript strict mode
- camelCase variables/functions, PascalCase components/types, kebab-case utility files
- Prettier enforced; /audit skill for on-demand code quality checks
- Feature-based organization on client side
- Vertical slices - each increment delivers user-visible behavior
- Never break sync - every commit should pass the 2-browser test
