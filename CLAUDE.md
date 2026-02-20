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

# Type Check
npm run typecheck        # tsc --noEmit
npx tsc --noEmit         # direct tsc (use if wrangler types swallows output)
```

## Git Worktrees

This repo uses git-crypt for `docs/`, which breaks raw `git worktree add`. Use the script:

```bash
scripts/worktree.sh create <branch>    # create + git-crypt unlock + prints cd/claude cmd
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

### "venom" - Team-based worktree agents

When the user says **"venom"** followed by task descriptions (any format, rambly is fine), the orchestrator owns the full lifecycle using agent teams:

**Single task:**
1. Derive a kebab-case branch name from the task
2. `scripts/worktree.sh create <branch>` - required (handles git-crypt, deps, build, migrations, ports, permissions)
3. Write detailed prompt to `$TMPDIR/prompt-<branch>.txt` (include worktree checklist items from below)
4. Launch background `general-purpose` agent with CWD set to the worktree absolute path
5. Monitor via task notifications in main context
6. Merge when agent finishes (same merge protocol below)

**Multiple tasks (team mode):**
1. `TeamCreate` with a session-level team name
2. `TaskCreate` for each work item (tasks can be added dynamically as scope grows)
3. For each task: `scripts/worktree.sh create <branch>`, write prompt, spawn team member with `Task(team_name=..., name=<branch>, run_in_background=true)`
4. Team members pick up tasks, implement, communicate progress via `SendMessage`
5. Orchestrator reviews, redirects, assigns new tasks as they emerge
6. Spawn new agents on-the-fly as tasks are added - agents join the team and claim work
7. Merge each branch as it completes (same merge protocol - orchestrator only)
8. `SendMessage(type="shutdown_request")` to each agent when done, then `TeamDelete`

**Adding agents dynamically:** New team members can be spawned at any time as tasks emerge. No need to plan all agents upfront. The shared task list coordinates work - new agents check `TaskList` and claim unassigned, unblocked tasks.

**Model selection by task complexity** (not hardcoded):
- `model: "sonnet"` - Default for most: refactors, well-scoped features, DX fixes
- `model: "opus"` - Architectural changes, novel integrations, complex multi-system work
- `model: "haiku"` - Mechanical tasks: bulk renames, migration boilerplate, config changes

**Claude Code 2.1.49+ features** (available but not yet integrated into our workflow):
- `isolation: "worktree"` in agent definitions - Claude Code creates temporary worktrees automatically. Does NOT handle git-crypt/deps/build, so we still use `scripts/worktree.sh` for this project.
- `background: true` in `.claude/agents/` frontmatter - agent always runs in background without needing `run_in_background: true` at call site.
- `Ctrl+F` kills background agents (2-press confirm) - use when agents go sideways instead of `TaskStop`.
- `SubagentStart`/`SubagentStop` hooks - can trigger setup/cleanup scripts when agents spawn. Future: could replace `scripts/worktree.sh` if hooks can handle git-crypt + full setup.

**NEVER delegate merging to sub-agents.** Always merge worktree branches in main context (the orchestrator). Worktree branches fork from a point-in-time snapshot of main. If other branches merge first, a sub-agent's squash merge will silently revert the intervening changes (the branch diff includes deletions it never made). The orchestrator must: (1) check `git diff main..feat/<branch>` for unexpected reversions, (2) rebase onto current main if needed, (3) resolve conflicts with full project context, (4) typecheck after merge.

## Browser Testing (playwright-cli)

The `playwright-cli` skill is available for automated browser testing. **Use it proactively** for UAT, smoke tests, and verifying features - don't stop to ask, just run it.

```bash
# Basic flow
playwright-cli open http://localhost:5173    # open app
playwright-cli snapshot                       # get element refs (e.g., e3, e15)
playwright-cli fill e5 "username"             # interact by ref
playwright-cli click e3                       # click by ref
playwright-cli screenshot --filename=.playwright-cli/verify.png  # visual verification
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

**All artifacts MUST go to `.playwright-cli/`** (gitignored). Always use `--filename=.playwright-cli/<name>.png` for screenshots. Never save screenshots to the repo root - no manual cleanup needed. Snapshots are YAML accessibility trees - prefer them over screenshots for understanding page structure.

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

Worktree agent lifecycle: **implement -> PR review -> fix review issues -> UAT -> commit -> /recap -> /last-call**. PR review gates UAT. After UAT passes, commit all changes to the feature branch (no PR - the orchestrator merges from main). After committing, run `/recap` (analyze session, extract learnings) then `/last-call` (dump learnings to disk, then commit). **The branch MUST be clean-committed when the agent finishes** so `git merge feat/<branch>` works from main. Uncommitted worktree work requires painful manual integration across a rebased codebase - this has caused real problems.

Worktree prompts must explicitly mention:
- **Dev server startup:** `npm run dev` (build once + serve, no HMR/watchers). Must use `run_in_background: true` on the Bash tool (not `&`), and `dangerouslyDisableSandbox: true` (sandbox blocks wrangler's log writes). Then `npm run health` to wait for readiness. Kill and rebuild between test rounds.
- `scripts/localcurl.sh` instead of `curl` (agents default to raw curl which isn't in the permission allowlist)
- **Namespace `playwright-cli` sessions in worktrees** - use `-s=<branch-name>` (e.g., `playwright-cli -s=feat-frames open ...`) to avoid conflicts with other worktrees running simultaneously. Without `-s`, all worktrees share the default session.
- "Read CLAUDE.md and relevant source files before implementing" (not "Enter plan mode first")
- "After implementation, run `/pr-review-toolkit:review-pr` and fix all issues before starting UAT"
- "After UAT passes, commit all changes to the feature branch. Do not open a PR."
- **Do NOT edit `docs/notes.md`** - the orchestrator owns it. Worktree agents write session notes to `docs/sessions/<branch>.md` (unique per branch = zero merge conflicts). The merge script consolidates session files into notes.md automatically.
- **KEY-DECISION comments**: When making a non-obvious decision, add `// KEY-DECISION <YYYY-MM-DD>: <rationale>` at the exact code location. Searchable via `grep -r "KEY-DECISION"`. Also include in commit messages for `git log --grep` searchability.

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

- `docs/encrypted/` is git-crypt encrypted. Everything else in `docs/` is plaintext.
- Deploy via `git push` to main (CF git integration). Never `wrangler deploy` manually.
- Rate check must happen BEFORE claiming `_isGenerating` mutex - see comment in `onChatMessage`.
- Never expose API keys to client bundle - all AI calls server-side.
- `getUserColor(userId)` is hash-based (not array-index). Same palette in Board.tsx and Cursors.tsx.
- Dev: `scripts/dev.sh` raises `ulimit -n 10240` (macOS default 256 causes EMFILE in multi-worktree).

## Doc Sync Workflow

**MANDATORY: Every commit that touches `src/` must also update relevant docs.** This is not optional. Do not ask "should I update docs?" - just do it as part of the commit.

| Trigger | Action | File |
|---------|--------|------|
| Any `src/` change | Update if layout, data flow, or constraints changed | `CLAUDE.md` |
| Feature completed | Update Roadmap Status in notes | `docs/notes.md` (orchestrator only) |
| Decision made (chose X over Y) | `// KEY-DECISION <date>: <rationale>` at the code location | Source file |
| New dependency added | Add to Stack section | `CLAUDE.md` |
| Session ending or context pressure | Full context dump: done, next, blockers, impl plan | `docs/sessions/<branch>.md` (worktrees) or `docs/notes.md` (orchestrator) |
| Session starting | Read `docs/notes.md` + `CLAUDE.md`, git log, summarize status | (read only) |
| notes.md > ~150 lines or 5+ sessions | Prune: collapse old sessions, delete implemented plans, keep only latest "What's Next" and active reference. Architecture/constraints belong in `CLAUDE.md`, not `notes.md`. | `docs/notes.md` |
| PR review identifies tech debt | Append to Known Tech Debt section so it's visible at merge time | `docs/notes.md` (orchestrator only) |

Hooks enforce the bookends: `SessionStart` reminds to read context, `PreCompact` reminds to dump context. Everything in between is your responsibility.

## Custom Agents (Delegation)

Main context is the orchestrator. Delegate execution to custom agents (`.claude/agents/`). Models are set in agent frontmatter - no need to specify at invocation. **Use Sonnet for implementation agents** (worktrees, code changes) to conserve Opus usage. Reserve Haiku for mechanical tasks (UAT clicks, worktree setup, exploration).

| Task | Agent | Model | Background? |
|------|-------|-------|-------------|
| Feature worktree (multi-file impl) | `general-purpose` | sonnet | yes (user launches in worktree) |
| UAT / smoke test / feature verification | `uat` | haiku | yes |
| Worktree creation + setup | `worktree-setup` | haiku | yes |
| PR review (code-reviewer, silent-failure-hunter) | `pr-review-toolkit:*` | sonnet | yes |
| E2E test suite (`npx playwright test`) | background Bash | - | yes |
| Codebase exploration (3+ file reads) | `Explore` (built-in) | sonnet | yes |

**How to invoke:**
```
Task(subagent_type="uat", run_in_background=true,
     prompt="Smoke test: auth + create board + one of each object type. Dev server on localhost:5173.")
```

**Before spawning UAT agents, always print a status summary for the user:**
- What scenarios will be tested (bulleted list)
- How many agents / sessions (single vs parallel)
- Expected complexity (quick smoke ~2min, full feature ~5min, multi-browser sync ~5-8min)

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
