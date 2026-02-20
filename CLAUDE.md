# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CollabBoard - multiplayer improv canvas with AI agent integration. Real-time collaborative whiteboard where players and AI improvise scenes together. Solo dev with AI-first methodology (Claude Code + Cursor). See `docs/new-north-star.md` for creative direction.

## Stack

React + Vite + react-konva + TypeScript | Cloudflare Workers + Hono + Durable Objects | D1 + DO Storage

**Key server files:**

| File | What it does |
|------|-------------|
| `src/server/index.ts` | Hono routes, board CRUD, DO exports, WS upgrade, persona/replay/gallery APIs |
| `src/server/chat-agent.ts` | ChatAgent DO - AI chat, per-player persona claims, game modes, scene budgets, director nudges |
| `src/server/ai-tools-sdk.ts` | 12 AI tools (Zod schemas, batchExecute meta-tool) |
| `src/server/prompts.ts` | System prompt assembly, persona identity, scene phases, PROMPT_VERSION |
| `src/server/tracing-middleware.ts` | AI SDK middleware -> D1 traces + optional Langfuse |
| `src/server/auth.ts` | Custom auth (PBKDF2, D1 sessions, rate limiting) |
| `src/shared/types.ts` | Persona, BoardObject, GameMode, AIModel, AI_MODELS, DEFAULT_PERSONAS |
| `src/shared/board-templates.ts` | Template registry: typed BoardObject arrays, displayText, `getTemplateById()` for server-side seeding |

**Key client files:**

| File | What it does |
|------|-------------|
| `src/client/components/Board.tsx` | Canvas + chat integration, mobile layout, model/persona state |
| `src/client/components/ChatPanel.tsx` | AI chat sidebar, persona claim pills, intent chips, useAgentChat |
| `src/client/components/OnboardModal.tsx` | Scene-start dialog: game mode + character picker + model selector |

**AI architecture (gotchas that will bite you):**
- 8 models across 3 providers. `body.model` sent per-message for DO hibernation resilience.
- Per-player persona claims via `body.personaId` (same per-message pattern). Fallback: round-robin.
- Reactive persona fires via `ctx.waitUntil` after each response. First exchange unreliable (timing gap).
- Class-level state resets on DO hibernation. Client re-sends model/gameMode/personaId each message.
- `tool_choice: "auto"` shim in workers-ai-provider (CF issue #404). Belt-and-suspenders.
- Canvas bounds (50,60)-(1150,780) in prompts.ts LAYOUT RULES - keep in sync with quality telemetry.
- Default model is Claude Haiku 4.5. GLM available but degrades by exchange 3+.
- Deploy via `git push` to main (CF git integration). Never `wrangler deploy` manually.

## Commands

```bash
# Dev
npm run dev              # build once + wrangler dev (no HMR/watchers, auto-loads worktree.ports)
npm run dev:hmr          # Vite HMR + wrangler dev (escape hatch if live editing needed)
npm run health           # wait for dev server (polls 500ms, auto-detects port from worktree.ports) - use instead of sleep

# Build & Deploy (CF git integration auto-deploys on push to main)
npm run build            # Vite build
npm run deploy           # Vite build + wrangler deploy (manual fallback)

# D1 Migrations (tracked via d1_migrations table)
npx wrangler d1 migrations create collabboard-db "describe_change"  # create new
npm run migrate              # apply pending to local + remote
npm run migrate:local        # apply pending to local only
npm run migrate:remote       # apply pending to remote only

# Prompt Eval Harness (requires dev server running)
npx tsx scripts/prompt-eval.ts            # run all scenarios, output pass/fail + JSON report
# EVAL_USERNAME/EVAL_PASSWORD/EVAL_MODEL env vars override defaults (eval/eval123/glm-4.7-flash)
# JSON reports written to scripts/eval-results/<timestamp>.json (gitignored)

# Lint & Format
npm run lint             # eslint
npm run format           # prettier --write

# Type Check (always use npm run typecheck, not bare tsc)
npm run typecheck        # wrangler types + tsc --noEmit (generates CF Workers bindings first)
# NEVER use bare `npx tsc --noEmit` - it skips wrangler types and shows false CF type errors
```

## Git Worktrees

Use the script for worktrees (handles deps/build/migrations/ports/permissions):

```bash
scripts/worktree.sh create <branch>    # create worktree + prints cd/claude cmd
scripts/worktree.sh remove <branch>    # remove worktree + delete feat/<branch>
scripts/worktree.sh list               # list active worktrees
scripts/merge.sh <branch>              # merge feat/<branch> --no-ff + typecheck
scripts/worktree-prompt-suffix.md      # standard instructions - orchestrator reads and appends to worktree prompts
```

When working in a worktree, use absolute paths for file tools. Run git commands directly (not `git -C`) - the working directory is already the repo/worktree.

When printing worktree startup commands for the user: write the prompt to `$TMPDIR/prompt-<branch>.txt` using the Write tool, then print a short launch command. **Choose model by complexity:**
- `--model sonnet` - Default for most worktrees: refactors, extracting components, DX fixes, well-scoped features with clear specs
- `--model opus` - Architectural changes, novel integrations, complex multi-system features, anything requiring deep reasoning about tradeoffs
- `--model haiku` - Mechanical tasks: bulk renames, migration boilerplate, config changes
```bash
cd /path/to/worktree && claude --model sonnet "$(cat /private/tmp/claude-501/prompt-<branch>.txt)"
```
This launches Claude with the prompt pre-loaded so the user just hits enter. Always include a specific, actionable prompt describing the feature to build. **Do NOT use "Enter plan mode first"** - it adds an approval gate that blocks the agent and the context exploration can compress away during implementation. Instead, write detailed prompts that specify the approach, and instruct the agent to read CLAUDE.md and relevant source files before implementing.

### Worktree Agent Workflow

When the user asks for work in a worktree (any format, rambly is fine), the orchestrator owns the full lifecycle using agent teams:

1. `TeamCreate` with a session-level team name
2. `TaskCreate` for each work item (tasks can be added dynamically)
3. For each task: derive kebab-case branch, `scripts/worktree.sh create <branch>`, write prompt to `$TMPDIR/prompt-<branch>.txt`, spawn team member with `Task(team_name=..., name=<branch>, run_in_background=true)`
4. Team members implement, communicate progress via `SendMessage`
5. Orchestrator reviews, redirects, assigns new tasks as they emerge
6. New agents can be spawned on-the-fly as tasks are added
7. Merge each branch as it completes (orchestrator only - see merge protocol below)
8. `SendMessage(type="shutdown_request")` to each agent when done, then `TeamDelete`

**Model selection by task complexity:**
- `model: "opus"` - Thought-heavy: architectural design, complex decisions, ambiguous debugging, multi-system reasoning
- `model: "sonnet"` - Default workhorse: scoped implementation, plan execution, long-form exploration, digest-heavy research
- `model: "haiku"` - Only for truly mechanical zero-reasoning tasks: bulk renames, single config value changes. If it requires any logic, decisions, or has unclear scope, use sonnet.

**Why `scripts/worktree.sh` instead of `claude -w` or `isolation: "worktree"`:** This project needs deps install (APFS clone), Vite build, D1 migrations, port assignment, and `.claude/settings.local.json` seeding per worktree. The script handles all of this. Native worktree isolation doesn't run project-specific setup.

**NEVER delegate merging to sub-agents.** Always merge worktree branches in main context (the orchestrator). Worktree branches fork from a point-in-time snapshot of main. If other branches merge first, a sub-agent's squash merge will silently revert the intervening changes (the branch diff includes deletions it never made). The orchestrator must: (1) check `git diff main..feat/<branch>` for unexpected reversions, (2) rebase onto current main if needed, (3) resolve conflicts with full project context, (4) typecheck after merge.

## Browser Testing (playwright-cli)

The `playwright-cli` skill is available for automated browser testing. **Use it proactively** for UAT, smoke tests, and verifying features - don't stop to ask, just run it.

**UAT and quality exploration swarms should target production** (`https://collabboard.thomas-fuertes.workers.dev`), not localhost. Prod is what real users see and avoids wrangler dev quirks (DO cold starts, WS flakiness, single-IP rate limit buckets). Only use localhost for testing uncommitted code changes.

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

**All artifacts MUST go to `playwright/`** (gitignored). Always use `--filename=playwright/<name>.png` for screenshots. Never save screenshots to the repo root - no manual cleanup needed. Snapshots are YAML accessibility trees - prefer them over screenshots for understanding page structure.

### E2E Tests (Playwright)

```bash
npx playwright test                    # run all tests
npx playwright test e2e/sync.spec.ts   # run one file
npx playwright test --reporter=dot     # minimal output (default 'list' floods context)
```

**Known gotchas:**
- Sandbox blocks Playwright browser launch and `wrangler dev`. Use `dangerouslyDisableSandbox: true` for both.
- **Reactive persona UAT timing:** SAGE/reactive persona reliably triggers on the 2nd+ exchange, not the 1st (timing gap: `ctx.waitUntil` fires before base class adds the new assistant message to `this.messages`). GLM reactive `generateText` takes 30-40s. UAT must send a follow-up message before testing SAGE, then wait 45-60s.
- **WS flakiness in local dev is expected.** First WS connection often drops with wrangler dev (DO cold start during WS handshake). The app reconnects but E2E/UAT tests must account for this. **After navigating to a board, always wait for `[data-state="connected"]` before interacting.** This selector is on the connection status dot in the header. Use `createObjectsViaWS()` helper (in `e2e/helpers.ts`) instead of UI double-click for reliable object creation. `wsRef.current` can be null after a drop even when React state shows "connected".
- **HMR hook-order false positive:** "React has detected a change in the order of Hooks called by Board" during dev = Vite HMR artifact, not a real bug. Full page reload fixes it. Never investigate this error in a live dev session.

### Worktree Agent Conventions

**Two agent tiers by task size:**

**Lightweight (single-file, <20 lines):** implement -> typecheck -> lint -> commit. No UAT, no PR review, no session notes. Trust the types. Orchestrator merges on sight.

**Standard (multi-file or behavioral):** implement -> PR review (Skill) -> fix issues -> UAT if behavioral -> commit. **The branch MUST be clean-committed when the agent finishes** so `git merge feat/<branch>` works from main.

**Task atomicity:** Pre-split complex tasks (3+ files or server+client) into atomic worktrees. Each touches one concern. Orchestrator checks in every 3 minutes on long-running agents - if stuck, redirect or break smaller. Bias toward many small agents over one big one.

**No session notes files.** Task list + git log is the source of truth. `docs/sessions/` is deprecated. KEY-DECISION comments in code are still mandatory for non-obvious decisions.

Worktree prompts must explicitly mention:
- **Dev server startup** (only if UAT needed): `npm run dev` with `run_in_background: true` and `dangerouslyDisableSandbox: true`. Then `npm run health` to wait.
- `scripts/localcurl.sh` instead of `curl`
- "Read CLAUDE.md and relevant source files before implementing" (not "Enter plan mode first")
- "Commit all changes to the feature branch. Do not open a PR."
- **KEY-DECISION comments**: `// KEY-DECISION <YYYY-MM-DD>: <rationale>` at the code location. Also in commit messages for `git log --grep`.

**Worktree cleanup:** Always `rm -rf <worktree-dir> && git worktree prune && git branch -d feat/<branch>`. The `git worktree remove --force` pattern fails when agent processes have files locked - skip straight to rm.

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
      SpectatorView.tsx # Public live view + emoji reactions (no auth)
      SceneGallery.tsx  # Public gallery grid (#gallery)
      PerfOverlay.tsx   # FPS/connection overlay (Shift+P)
      AiCursor.tsx      # Purple dot animating to AI creation points
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
  shared/types.ts       # BoardObject, WSMessage, Persona, GameMode, AIModel
migrations/             # D1 SQL (npm run migrate)
```

### Data Flow

1. Auth via POST /auth/signup or /auth/login (session cookie)
2. BoardList (`GET /api/boards`) -> select/create board -> `#board/{id}`
3. WebSocket to `wss://host/board/:id` (cookie validated before upgrade)
4. Board DO manages state: objects in DO Storage (`obj:{uuid}`), cursors in memory
5. Mutations: client optimistic -> DO persists + broadcasts to others
6. AI: client WS to ChatAgent DO (`/agents/ChatAgent/<boardId>`) -> `streamText()` with tools -> Board DO RPC for canvas mutations
7. Replay: DO records mutations as `evt:{ts}:{rand}` keys (max 2000). Public `GET /api/boards/:id/replay`
8. Gallery: Public `GET /api/boards/public` (D1 join). `#gallery` -> `#replay/{id}`
9. Spectator: `GET /ws/watch/:boardId` (no auth). Read-only + cursor/reactions only
10. Eval API: `GET /api/boards/:boardId/objects` returns objects + quality metrics

### WebSocket Protocol

```
Player -> DO:    cursor | obj:create | obj:update | obj:delete | batch:undo | reaction
Spectator -> DO: cursor | reaction (all other messages silently dropped)
DO -> Client:    cursor | obj:create | obj:update | obj:delete | presence | init | reaction
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
- Rate check must happen BEFORE claiming `_isGenerating` mutex - see comment in `onChatMessage`.
- Never expose API keys to client bundle - all AI calls server-side.
- `getUserColor(userId)` is hash-based (not array-index). Same palette in Board.tsx and Cursors.tsx.
- Dev: `scripts/dev.sh` raises `ulimit -n 10240` (macOS default 256 causes EMFILE in multi-worktree).

## Doc Sync

- **Session start:** Read `CLAUDE.md`, `git log --oneline -20`, `TaskList`. No summary needed.
- **Task list is the single source of truth** for backlog, loose ends, tech debt, and unshipped features. Use `TaskCreate`/`TaskList`/`TaskUpdate`. Not notes.md, not GitHub issues (unless external collaboration needed).
- **CLAUDE.md:** Update only when file map, key constraints, or gotchas change. Not a changelog.
- **KEY-DECISION comments:** Non-obvious decisions go in code, not docs. `// KEY-DECISION <date>: <rationale>`
- **No session notes files.** `docs/sessions/` is deprecated. Task list + git log is the source of truth.

## Custom Agents (Delegation)

Main context is the orchestrator. Delegate aggressively - keep main context for decisions, not execution. **Default to agent teams** (`TeamCreate`) for all multi-agent work. In a swarm/team context, even "atomic" tasks (eval harness, test suite) should be team members so they can report via `SendMessage` and cross-reference findings. Background tasks (`run_in_background: true`) only for truly independent one-shots outside a team context (e.g. a single build while the user waits).

| Task | Agent | Model | Mode | How |
|------|-------|-------|------|-----|
| Feature worktree | `general-purpose` | sonnet | `bypassPermissions` | team member |
| Design / architecture | `general-purpose` | opus | `bypassPermissions` | team member |
| UAT / smoke test | `uat` | sonnet | `bypassPermissions` | team member |
| Quality exploration | `general-purpose` | sonnet | `bypassPermissions` | team member |
| PR review | `pr-review-toolkit:*` | sonnet | default | invoked by worktree agent via Skill |
| E2E / eval harness | `general-purpose` | sonnet | `bypassPermissions` | team member (reports via SendMessage) |
| Codebase exploration | `Explore` (built-in) | sonnet | default | team member or background (atomic) |

**Architect agents can spawn sub-agents.** Opus architects should delegate exploratory token-burning (file reads, grep sweeps, pattern research) to sonnet or haiku background agents rather than burning opus tokens on mechanical exploration.

**Always spawn agents with `mode: "bypassPermissions"`** unless they need user approval for destructive actions. The OS sandbox (`sandbox.enabled: true`) is the safety boundary - it blocks writes outside allowed paths and network outside allowed domains. Permission prompts inside sandboxed agents are redundant friction.

**UAT uses teams, not background tasks.** Each test scenario gets a teammate that reports failures immediately via `SendMessage`. The lead triages and fixes while other flows still run. Before spawning UAT, enumerate scenarios as a numbered list for the user.

**Agent bash rules:** Agents must keep shell commands simple and direct. No clever variable capture patterns (`LATEST=$(ls -t ... | head -1)`), no chained subshells, no heredoc gymnastics. If a command needs more than one pipe, break it into separate tool calls. Simple commands are readable, debuggable, and don't trigger unnecessary permission prompts.

Never run playwright-cli sessions or full test suites in main Opus context. Always delegate.

## Conventions

- TypeScript strict mode
- camelCase variables/functions, PascalCase components/types, kebab-case utility files
- ESLint + Prettier enforced
- Feature-based organization on client side
- Vertical slices - each increment delivers user-visible behavior
- Never break sync - every commit should pass the 2-browser test
- Use `npx <tool>` or `npm run <script>`, never `./node_modules/.bin/<tool>` directly (matches permission allowlist, works in worktrees)
- **Never use `git -C <path>`** - run git commands directly (e.g., `git status`, `git commit`). The working directory is already the repo. `git -C` bypasses the permission allowlist and forces manual approval on every invocation. This applies to both the main repo and worktrees.
- Use `scripts/localcurl.sh` instead of `curl` for local API testing (localhost-only wrapper, whitelisted in worktrees)
- Start dev servers with `run_in_background: true` on the Bash tool, not `&` or `2>&1 &`. The background task mechanism handles this cleanly without needing shell backgrounding.
- Never leave sprint/task codes (A1, B2, etc.) in code comments - they're meaningless without the plan doc
- **`gh issue create` with long bodies:** Write body to `$TMPDIR/issue-<name>.md` first, then `gh issue create --title "..." --body-file $TMPDIR/issue-<name>.md --label <label>`. Never pipe/heredoc into `gh` (blocked by `no-gh-stdin.sh` hook). Never use `<` or `<<<` angle brackets in titles (confuses shell). Create issues one at a time (parallel `gh` calls race on hook stdin).
