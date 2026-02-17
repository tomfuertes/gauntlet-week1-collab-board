# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CollabBoard - real-time collaborative whiteboard with AI agent integration. Gauntlet AI Week 1 exercise. Solo dev with AI-first methodology (Claude Code + Cursor).

## Stack

- **Frontend:** React + Vite + react-konva + TypeScript (SPA deployed as CF Workers static assets)
- **Backend:** Cloudflare Workers + Hono router
- **Real-time:** Durable Objects + WebSockets (one DO per board, LWW conflict resolution)
- **Auth:** Custom (username/password, PBKDF2 hash, D1 sessions, cookie-based)
- **Database:** DO Storage (board objects as KV) + D1 (users/sessions/board metadata)
- **AI:** Workers AI binding (`env.AI.run()` + `runWithTools()`) - Llama 3.3 70B (free tier, weak tool-use). 10 tools: `create_sticky`, `create_text`, `create_rect`, `create_circle`, `create_line`, `create_connector`, `create_frame`, `read_board`, `update_object`, `delete_object`. Haiku via AI Gateway is the upgrade path ($0.001/req, much better tool discipline).
- **Deploy:** CF git integration auto-deploys on push to main

## Commands

```bash
# Dev
npm run dev              # wrangler dev (backend + frontend)
# In worktrees (avoid port conflicts with main repo):
VITE_PORT=5174 WRANGLER_PORT=8788 npm run dev

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
```

## Git Worktrees

This repo uses git-crypt for `docs/`, which breaks raw `git worktree add`. Use the script:

```bash
scripts/worktree.sh create <branch>    # create + git-crypt unlock + prints cd/claude cmd
scripts/worktree.sh remove <branch>    # remove worktree + delete feat/<branch>
scripts/worktree.sh list               # list active worktrees
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
- Local wrangler WebSocket: first WS connection often drops; the app reconnects but E2E tests must account for this. Use `createObjectsViaWS()` helper (in `e2e/helpers.ts`) instead of UI double-click for reliable object creation in tests.
- `wsRef.current` can be null after a drop even when React state shows "connected" - tests should retry or wait for `init` message.

### Worktree Agent Conventions

Worktree prompts must explicitly mention:
- `source worktree.ports && npm run dev` (never hardcode ports)
- `scripts/localcurl.sh` instead of `curl` (agents default to raw curl which isn't in the permission allowlist)
- **Do NOT use `playwright-cli`** in worktrees - it's an interactive tool that conflicts when multiple worktrees run simultaneously. Use `npx playwright test` (E2E suite) or `npm run typecheck && npm run build` for validation instead.
- "Read CLAUDE.md and relevant source files before implementing" (not "Enter plan mode first")

## Architecture

### Monorepo Layout

```
src/
  client/               # React SPA
    index.html          # Vite entry
    main.tsx            # React root
    App.tsx             # App shell + hash routing (#board/{id})
    components/
      Board.tsx         # Canvas + toolbar + chat panel integration
      BoardList.tsx     # Board grid (CRUD) - landing page after login
      ChatPanel.tsx     # AI chat sidebar
    hooks/
      useWebSocket.ts   # WebSocket state management
      useAIChat.ts      # AI chat state + API calls
      useUndoRedo.ts    # Local undo/redo stack (max 50, Cmd+Z/Cmd+Shift+Z)
  server/               # CF Worker
    index.ts            # Hono app - routes, board CRUD, DO export, WebSocket upgrade
    auth.ts             # Auth routes + PBKDF2 hashing + session helpers
    ai.ts               # AI route - runWithTools + board manipulation tools
  shared/               # Types shared between client and server
    types.ts            # BoardObject, WSMessage, ChatMessage, User, etc.
migrations/             # D1 SQL migrations (tracked via d1_migrations table, npm run migrate)
```

### Data Flow

1. Client authenticates via POST /auth/signup or /auth/login (session cookie set)
2. Client shows BoardList (fetches `GET /api/boards`), user selects/creates a board -> hash route `#board/{id}`
3. Client opens WebSocket to `wss://host/board/:id` (cookie validated before upgrade)
4. Worker routes WebSocket to Board Durable Object
5. DO manages all board state: objects in DO Storage (`obj:{uuid}`), cursors in memory
6. Mutations flow: client applies optimistically -> sends to DO -> DO persists + broadcasts to other clients
7. AI commands: client POSTs to `/api/ai/chat` -> Worker runs `runWithTools()` with Llama 3.3 70B -> tool callbacks HTTP to Board DO `/read` and `/mutate` -> DO persists + broadcasts to all WebSocket clients

### WebSocket Protocol

```
Client -> DO: cursor | obj:create | obj:update | obj:delete
DO -> Client: cursor | obj:create | obj:update | obj:delete | presence | init
```

DO echoes mutations to OTHER clients only (sender already applied optimistically).

**IMPORTANT:** The WS message field for objects is `obj` (not `object`). Example: `{ type: "obj:create", obj: { id, type, x, y, ... } }`. Using `object` instead of `obj` silently fails - the DO ignores the message.

### Board Object Shape

```typescript
{ id, type, x, y, width, height, rotation, props: { text?, color?, fill?, stroke?, arrow? }, createdBy, updatedAt }
```

Each object stored as separate DO Storage key (`obj:{uuid}`, ~200 bytes). LWW via `updatedAt`.

## Key Constraints

- `docs/encrypted/` is git-crypt encrypted (spec, pre-search). Everything else in `docs/` is plaintext and merges normally across worktrees.
- `private/` is .gitignore'd - contains original PDF, never committed
- Auth is custom (no Better Auth) - PBKDF2 hashing (Web Crypto, zero deps), D1 sessions, cookie-based. No email, no OAuth, no password reset.
- Deploy via `git push` to main (CF git integration). Do NOT run `wrangler deploy` manually.
- All AI calls are server-side in Worker - never expose API keys to client bundle
- AI uses `@cloudflare/ai-utils` `runWithTools()` with `maxRecursiveToolRuns: 3` (counts LLM round-trips, not tool calls). Llama 3.3 needs explicit system prompt guardrails for tool discipline.
- D1 migrations tracked via `d1_migrations` table. Use `npm run migrate` (not raw `wrangler d1 execute`). Create new: `wrangler d1 migrations create collabboard-db "name"`
- WebSocket reconnect with exponential backoff (1s-10s cap), `disconnected` after 5 initial failures
- Performance targets: 60fps canvas, <100ms object sync, <50ms cursor sync, 500+ objects, 5+ users
- Two-browser test is the primary validation method throughout development
- Hash-based routing (`#board/{id}`) - no React Router, no server-side routing needed
- Board list shows user's own boards + system boards; any auth'd user can access any board via URL

## Doc Sync Workflow

**MANDATORY: Every commit that touches `src/` must also update relevant docs.** This is not optional. Do not ask "should I update docs?" - just do it as part of the commit.

| Trigger | Action | File |
|---------|--------|------|
| Any `src/` change | Update if layout, data flow, or constraints changed | `CLAUDE.md` |
| Feature completed | Check the box | `docs/roadmap.md` |
| Decision made (chose X over Y) | Append with date + rationale | `docs/notes.md` |
| New dependency added | Add to Stack section | `CLAUDE.md` |
| Session ending or context pressure | Full context dump: done, next, blockers, impl plan | `docs/notes.md` |
| Session starting | Read `docs/notes.md` + `CLAUDE.md` + `docs/roadmap.md`, git log, summarize status | (read only) |
| notes.md > ~150 lines or 5+ sessions | Prune: collapse old sessions into Key Decisions table, delete implemented plans, keep only latest "What's Next" and active reference. Architecture/constraints belong in `CLAUDE.md`, not `notes.md`. | `docs/notes.md` |
| PR review identifies tech debt | Append to Known Tech Debt section so it's visible at merge time | `docs/notes.md` |

Hooks enforce the bookends: `SessionStart` reminds to read context, `PreCompact` reminds to dump context. Everything in between is your responsibility.

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
