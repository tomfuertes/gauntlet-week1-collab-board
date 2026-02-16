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
- **AI:** Workers AI binding (`env.AI.run()` + `runWithTools()`) with AI Gateway upgrade path
- **Deploy:** CF git integration auto-deploys on push to main

## Commands

```bash
# Dev
npm run dev              # wrangler dev (backend + frontend)

# Build & Deploy (CF git integration auto-deploys on push to main)
npm run build            # Vite build
npm run deploy           # Vite build + wrangler deploy (manual fallback)

# D1 Migrations
npx wrangler d1 execute collabboard-db --local --file=migrations/XXXX.sql
npx wrangler d1 execute collabboard-db --remote --file=migrations/XXXX.sql

# Lint & Format
npm run lint             # eslint
npm run format           # prettier --write

# Type Check
npm run typecheck        # tsc --noEmit
```

## Git Worktrees

This repo uses git-crypt for `docs/`, which breaks `git worktree add` (smudge filter fails). Bypass it:

```bash
# Create worktree (bypass git-crypt smudge filter)
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=filter.git-crypt.smudge GIT_CONFIG_VALUE_0=cat \
  git worktree add ../gauntlet-week1-collab-board-<branch> -b feat/<branch>

# Unlock git-crypt in the worktree (3-step: bypass filters, unlock, filters auto-restore)
# Without this, git status/diff/commit all fail on encrypted files
WT=../gauntlet-week1-collab-board-<branch>
git -C "$WT" config filter.git-crypt.clean cat
git -C "$WT" config filter.git-crypt.smudge cat
git -C "$WT" config filter.git-crypt.required false
cd "$WT" && git-crypt unlock "$(git rev-parse --path-format=absolute --git-common-dir)/git-crypt/keys/default"

# Start Claude session in the worktree
cd ../gauntlet-week1-collab-board-<branch> && claude

# Cleanup: remove worktree + branch after PR merged
git worktree remove ../gauntlet-week1-collab-board-<branch>
git branch -D feat/<branch>
```

When working in a worktree, use absolute paths for file tools and `git -C <abs-path>` for git commands (since `cd` doesn't persist between Bash calls).

## Browser Testing (playwright-cli)

The `playwright-cli` skill is available for automated browser testing. **Use it proactively** for UAT, smoke tests, and verifying features - don't stop to ask, just run it.

```bash
# Basic flow
playwright-cli open http://localhost:5173    # open app
playwright-cli snapshot                       # get element refs (e.g., e3, e15)
playwright-cli fill e5 "username"             # interact by ref
playwright-cli click e3                       # click by ref
playwright-cli screenshot                     # visual verification
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

Artifacts go to `.playwright-cli/` (gitignored). Snapshots are YAML accessibility trees - prefer them over screenshots for understanding page structure.

## Architecture

### Monorepo Layout

```
src/
  client/               # React SPA
    index.html          # Vite entry
    main.tsx            # React root
    App.tsx             # App shell
    components/
      Board.tsx         # Canvas + toolbar + chat panel integration
      ChatPanel.tsx     # AI chat sidebar
    hooks/
      useWebSocket.ts   # WebSocket state management
      useAIChat.ts      # AI chat state + API calls
  server/               # CF Worker
    index.ts            # Hono app - routes, DO export, WebSocket upgrade
    auth.ts             # Auth routes + PBKDF2 hashing + session helpers
    ai.ts               # AI route - runWithTools + board manipulation tools
  shared/               # Types shared between client and server
    types.ts            # BoardObject, WSMessage, ChatMessage, User, etc.
migrations/             # D1 SQL migrations (applied via wrangler d1 execute)
```

### Data Flow

1. Client authenticates via POST /auth/signup or /auth/login (session cookie set)
2. Client opens WebSocket to `wss://host/board/:id` (cookie validated before upgrade)
3. Worker routes WebSocket to Board Durable Object
4. DO manages all board state: objects in DO Storage (`obj:{uuid}`), cursors in memory
5. Mutations flow: client applies optimistically -> sends to DO -> DO persists + broadcasts to other clients
6. AI commands: client POSTs to `/api/ai/chat` -> Worker runs `runWithTools()` with Llama 3.3 70B -> tool callbacks HTTP to Board DO `/read` and `/mutate` -> DO persists + broadcasts to all WebSocket clients

### WebSocket Protocol

```
Client -> DO: cursor | obj:create | obj:update | obj:delete
DO -> Client: cursor | obj:create | obj:update | obj:delete | presence | init
```

DO echoes mutations to OTHER clients only (sender already applied optimistically).

### Board Object Shape

```typescript
{ id, type, x, y, width, height, rotation, props: { text?, color?, fill?, stroke? }, createdBy, updatedAt }
```

Each object stored as separate DO Storage key (`obj:{uuid}`, ~200 bytes). LWW via `updatedAt`.

## Key Constraints

- `docs/` is git-crypt encrypted - contains spec and internal planning docs
- `private/` is .gitignore'd - contains original PDF, never committed
- Auth is custom (no Better Auth) - PBKDF2 hashing (Web Crypto, zero deps), D1 sessions, cookie-based. No email, no OAuth, no password reset.
- Deploy via `git push` to main (CF git integration). Do NOT run `wrangler deploy` manually.
- All AI calls are server-side in Worker - never expose API keys to client bundle
- Performance targets: 60fps canvas, <100ms object sync, <50ms cursor sync, 500+ objects, 5+ users
- Two-browser test is the primary validation method throughout development

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

Hooks enforce the bookends: `SessionStart` reminds to read context, `PreCompact` reminds to dump context. Everything in between is your responsibility.

## Conventions

- TypeScript strict mode
- camelCase variables/functions, PascalCase components/types, kebab-case utility files
- ESLint + Prettier enforced
- Feature-based organization on client side
- Vertical slices - each increment delivers user-visible behavior
- Never break sync - every commit should pass the 2-browser test
