# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CollabBoard - multiplayer improv canvas with AI agent integration. Real-time collaborative whiteboard where players and AI improvise scenes together. Solo dev with AI-first methodology (Claude Code + Cursor). See `docs/new-north-star.md` for creative direction.

## Stack

- **Frontend:** React + Vite + react-konva + TypeScript (SPA deployed as CF Workers static assets)
- **Backend:** Cloudflare Workers + Hono router
- **Real-time:** Durable Objects + WebSockets (one DO per board, LWW conflict resolution)
- **Auth:** Custom (username/password, PBKDF2 hash, D1 sessions, cookie-based)
- **Database:** DO Storage (board objects as KV) + D1 (users/sessions/board metadata)
- **AI:** Cloudflare Agents SDK (`AIChatAgent` DO) + Vercel AI SDK v6 (`streamText`, `generateText`, `tool()`). `ChatAgent` DO per board (instance name = boardId), WebSocket streaming, server-side chat persistence (DO SQLite). 11 tools in `src/server/ai-tools-sdk.ts` (Zod schemas, `instrumentExecute` wrapper for timing/success logs), display metadata in `src/shared/ai-tool-meta.ts`, prompts in `src/server/prompts.ts` (versioned via `PROMPT_VERSION`). Models: GLM-4.7-Flash (free tier) or Claude Haiku 4.5 (if `ANTHROPIC_API_KEY` set) via `@ai-sdk/anthropic`. **AI Director:** proactive mode - after 60s inactivity, `onDirectorNudge` fires via DO schedule alarm, uses `generateText` (non-streaming) with scene-phase-specific prompts, builds `UIMessage` manually and broadcasts via `persistMessages()`. **AI Image Generation:** `generateImage` tool calls CF Workers AI SDXL (512x512), base64 data URL stored in `props.src`, rendered via Konva `Image` component. See `docs/ai-architecture.md` for full request lifecycle.
- **Deploy:** CF git integration auto-deploys on push to main

## Commands

```bash
# Dev
npm run dev              # wrangler dev (backend + frontend, auto-loads worktree.ports)
npm run health           # wait for dev server (auto-detects port from worktree.ports)

# Build & Deploy (CF git integration auto-deploys on push to main)
npm run build            # Vite build
npm run deploy           # Vite build + wrangler deploy (manual fallback)

# D1 Migrations (tracked via d1_migrations table)
npx wrangler d1 migrations create collabboard-db "describe_change"  # create new
npm run migrate              # apply pending to local + remote
npm run migrate:local        # apply pending to local only
npm run migrate:remote       # apply pending to remote only

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

When printing worktree startup commands for the user, pass the task prompt directly to claude:
```bash
cd /path/to/worktree && claude "your task prompt here"
```
This launches Claude with the prompt pre-loaded so the user just hits enter. Always include a specific, actionable prompt describing the feature to build. **Do NOT use "Enter plan mode first"** - it adds an approval gate that blocks the agent and the context exploration can compress away during implementation. Instead, write detailed prompts that specify the approach, and instruct the agent to read CLAUDE.md and relevant source files before implementing.

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
- **WS flakiness in local dev is expected.** First WS connection often drops with wrangler dev (DO cold start during WS handshake). The app reconnects but E2E/UAT tests must account for this. **After navigating to a board, always wait for `[data-state="connected"]` before interacting.** This selector is on the connection status dot in the header. Use `createObjectsViaWS()` helper (in `e2e/helpers.ts`) instead of UI double-click for reliable object creation. `wsRef.current` can be null after a drop even when React state shows "connected".
- **HMR hook-order false positive:** "React has detected a change in the order of Hooks called by Board" during dev = Vite HMR artifact, not a real bug. Full page reload fixes it. Never investigate this error in a live dev session.

### Worktree Agent Conventions

Worktree agent lifecycle: **implement -> PR review -> fix review issues -> UAT -> commit**. PR review gates UAT. After UAT passes, commit all changes to the feature branch (no PR - the orchestrator merges from main). The branch must be clean-committed when the agent finishes so `git merge feat/<branch>` works from main.

Worktree prompts must explicitly mention:
- `npm run dev` (auto-loads worktree.ports if present, never hardcode ports)
- `scripts/localcurl.sh` instead of `curl` (agents default to raw curl which isn't in the permission allowlist)
- **Namespace `playwright-cli` sessions in worktrees** - use `-s=<branch-name>` (e.g., `playwright-cli -s=feat-frames open ...`) to avoid conflicts with other worktrees running simultaneously. Without `-s`, all worktrees share the default session.
- "Read CLAUDE.md and relevant source files before implementing" (not "Enter plan mode first")
- "After implementation, run `/pr-review-toolkit:review-pr` and fix all issues before starting UAT"
- "After UAT passes, commit all changes to the feature branch. Do not open a PR."
- **Do NOT edit the "Shipped" list in `docs/notes.md`** - the orchestrator updates it at merge time to avoid conflicts between concurrent worktrees.

## Architecture

### Monorepo Layout

```
src/
  client/               # React SPA
    index.html          # Vite entry
    main.tsx            # React root
    App.tsx             # App shell + hash routing (#board/{id}, #replay/{id})
    theme.ts            # Shared color constants (accent, surfaces, borders, cursors)
    components/
      Board.tsx         # Canvas + chat panel integration (~1530 lines)
      Toolbar.tsx       # Floating toolbar - tool buttons, mode switching (extracted from Board)
      BoardList.tsx     # Board grid (CRUD) - landing page after login
      ChatPanel.tsx     # AI chat sidebar (dynamic intent chips, improv scene interaction)
      ReplayViewer.tsx  # Read-only scene replay player (public, no auth)
      SceneGallery.tsx  # Public gallery grid of replayable scenes (#gallery route)
      PerfOverlay.tsx   # Dev performance overlay (FPS, msg age, nodes, connection state)
      ConfettiBurst.tsx # Confetti particle burst animation (extracted from Board)
      BoardGrid.tsx     # Dot grid + radial glow background (extracted from Board)
    hooks/
      useWebSocket.ts   # WebSocket state management (Board DO)
      useAIChat.ts      # Adapter: useAgentChat -> AIChatMessage (ChatPanel compat)
      useUndoRedo.ts    # Local undo/redo stack (max 50, Cmd+Z/Cmd+Shift+Z)
      useAiObjectEffects.ts  # AI glow + confetti trigger logic (extracted from Board)
      useKeyboardShortcuts.ts  # Keyboard handlers: Cmd+Z, Cmd+C, Delete, Escape (extracted from Board)
      useDragSelection.ts      # Marquee/rubber-band selection logic (extracted from Board)
    styles/
      animations.css    # Shared CSS keyframes (cb-pulse, cb-confetti)
  server/               # CF Worker
    index.ts            # Hono app - routes, board CRUD, DO exports, agent routing, WS upgrade, public replay + gallery API
    auth.ts             # Auth routes + PBKDF2 hashing + session helpers
    env.ts              # Bindings type, D1 helpers (recordBoardActivity, markBoardSeen)
    prompts.ts          # All LLM prompt content + scene phases + PROMPT_VERSION constant
    chat-agent.ts       # AIChatAgent DO - WebSocket AI chat, model selection, request metrics
    ai-tools-sdk.ts     # 10 tools as AI SDK tool() with Zod schemas + instrumentExecute wrapper + DRY helpers
  shared/               # Types shared between client and server
    types.ts            # BoardObject, WSMessage, ChatMessage, ReplayEvent, User, etc.
    ai-tool-meta.ts     # Tool display metadata (icons, labels, summaries) for ChatPanel
migrations/             # D1 SQL migrations (tracked via d1_migrations table, npm run migrate)
```

### Data Flow

1. Client authenticates via POST /auth/signup or /auth/login (session cookie set)
2. Client shows BoardList (fetches `GET /api/boards`), user selects/creates a board -> hash route `#board/{id}`
3. Client opens WebSocket to `wss://host/board/:id` (cookie validated before upgrade)
4. Worker routes WebSocket to Board Durable Object
5. DO manages all board state: objects in DO Storage (`obj:{uuid}`), cursors in memory
6. Mutations flow: client applies optimistically -> sends to DO -> DO persists + broadcasts to other clients
7. AI commands: client connects to ChatAgent DO via WebSocket (`/agents/ChatAgent/<boardId>`) -> `useAgentChat` sends messages -> ChatAgent runs `streamText()` with tools -> tool callbacks via Board DO RPC (`readObject`/`mutate`) -> Board DO persists + broadcasts to all board WebSocket clients
8. Scene replay: Board DO records mutations as `evt:{ts}:{rand}` keys in storage (debounced 500ms for updates, 2000 cap). Public `GET /api/boards/:id/replay` returns sorted events. `#replay/{id}` route renders read-only ReplayViewer (no auth required).
9. Scene gallery: Public `GET /api/boards/public` returns boards with activity (D1 join: boards + users + board_activity). `#gallery` route renders SceneGallery grid (no auth). Cards link to `#replay/{id}`.

### WebSocket Protocol

```
Client -> DO: cursor | obj:create | obj:update | obj:delete | batch:undo
DO -> Client: cursor | obj:create | obj:update | obj:delete | presence | init
```

DO echoes mutations to OTHER clients only (sender already applied optimistically).

**IMPORTANT:** The WS message field for objects is `obj` (not `object`). Example: `{ type: "obj:create", obj: { id, type, x, y, ... } }`. Using `object` instead of `obj` silently fails - the DO ignores the message.

**Ephemeral state TTL pattern:** For cursor-like state that relies on explicit cleanup messages (e.g. `text:blur`), also track `lastSeen` + sweep with `setInterval`. Messages can be dropped on WS disconnect; TTL ensures eventual consistency without server changes.

**DO hibernation:** Class-level properties reset on hibernation. Store ephemeral per-connection state in `ws.serializeAttachment()` - survives hibernation and is readable in `webSocketClose`.

### Board Object Shape

```typescript
{ id, type, x, y, width, height, rotation, props: { text?, color?, fill?, stroke?, arrow?, src?, prompt? }, createdBy, updatedAt, batchId? }
```

Each object stored as separate DO Storage key (`obj:{uuid}`, ~200 bytes). LWW via `updatedAt`. `batchId` groups AI-created objects from a single `streamText` call for batch undo. Replay events stored as `evt:{16-padded-ts}:{4-char-rand}` keys (max 2000, `obj:update` debounced 500ms per object).

## Key Constraints

- `docs/encrypted/` is git-crypt encrypted (spec, pre-search). Everything else in `docs/` is plaintext and merges normally across worktrees.
- `private/` is .gitignore'd - contains original PDF, never committed
- Auth is custom (no Better Auth) - PBKDF2 hashing (Web Crypto, zero deps), D1 sessions, cookie-based. No email, no OAuth, no password reset.
- Deploy via `git push` to main (CF git integration). Do NOT run `wrangler deploy` manually.
- All AI calls are server-side in Worker - never expose API keys to client bundle
- AI uses Cloudflare Agents SDK (`AIChatAgent` DO) + Vercel AI SDK v6 (`streamText` with `stopWhen: stepCountIs(5)`). Tool definitions in `src/server/ai-tools-sdk.ts` (Zod schemas, AI SDK `tool()`), display metadata in `src/shared/ai-tool-meta.ts`. Chat history persisted server-side in DO SQLite.
- D1 migrations tracked via `d1_migrations` table. Use `npm run migrate` (not raw `wrangler d1 execute`). Create new: `wrangler d1 migrations create collabboard-db "name"`
- WebSocket reconnect with exponential backoff (1s-10s cap), `disconnected` after 5 initial failures
- Performance targets: 60fps canvas, <100ms object sync, <50ms cursor sync, 500+ objects, 5+ users
- Two-browser test is the primary validation method throughout development
- Hash-based routing (`#board/{id}`, `#replay/{id}`, `#gallery`, `#privacy`) - no React Router, no server-side routing needed
- Board list shows user's own boards + system boards; any auth'd user can access any board via URL
- AI tool helpers: `randomPos()`, `makeObject()`, `createAndMutate()` in `ai-tools-sdk.ts` - all create tools use these. `createAndMutate` handles error logging and returns `{x, y, width, height}` for LLM chaining.
- Cursor colors: `getUserColor(userId)` uses hash-based assignment (same palette in Board.tsx and Cursors.tsx). Never use array-index-based color assignment - it produces inconsistent colors across components.

## Doc Sync Workflow

**MANDATORY: Every commit that touches `src/` must also update relevant docs.** This is not optional. Do not ask "should I update docs?" - just do it as part of the commit.

| Trigger | Action | File |
|---------|--------|------|
| Any `src/` change | Update if layout, data flow, or constraints changed | `CLAUDE.md` |
| Feature completed | Update Roadmap Status in notes | `docs/notes.md` |
| Decision made (chose X over Y) | Append with date + rationale | `docs/notes.md` |
| New dependency added | Add to Stack section | `CLAUDE.md` |
| Session ending or context pressure | Full context dump: done, next, blockers, impl plan | `docs/notes.md` |
| Session starting | Read `docs/notes.md` + `CLAUDE.md`, git log, summarize status | (read only) |
| notes.md > ~150 lines or 5+ sessions | Prune: collapse old sessions into Key Decisions table, delete implemented plans, keep only latest "What's Next" and active reference. Architecture/constraints belong in `CLAUDE.md`, not `notes.md`. | `docs/notes.md` |
| PR review identifies tech debt | Append to Known Tech Debt section so it's visible at merge time | `docs/notes.md` |

Hooks enforce the bookends: `SessionStart` reminds to read context, `PreCompact` reminds to dump context. Everything in between is your responsibility.

## Custom Agents (Delegation)

Main context is the orchestrator. Delegate execution to custom agents (`.claude/agents/`). Models are set in agent frontmatter - no need to specify at invocation.

| Task | Agent | Model (in frontmatter) | Background? |
|------|-------|------------------------|-------------|
| UAT / smoke test / feature verification | `uat` | haiku | yes |
| Worktree creation + setup | `worktree-setup` | haiku | yes |
| E2E test suite (`npx playwright test`) | background Bash | - | yes |
| Codebase exploration (3+ file reads) | `Explore` (built-in) | haiku | yes |

**How to invoke:**
```
Task(subagent_type="uat", run_in_background=true,
     prompt="Smoke test: auth + create board + one of each object type. Dev server on localhost:5173.")
```

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
