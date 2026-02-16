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

## Architecture

### Monorepo Layout

```
src/
  client/               # React SPA
    index.html          # Vite entry
    main.tsx            # React root
    App.tsx             # App shell
  server/               # CF Worker
    index.ts            # Hono app - routes, DO export, WebSocket upgrade
    auth.ts             # Auth routes + PBKDF2 hashing + session helpers
  shared/               # Types shared between client and server
    types.ts            # BoardObject, WSMessage, User, etc.
migrations/             # D1 SQL migrations (applied via wrangler d1 execute)
```

### Data Flow

1. Client authenticates via POST /auth/signup or /auth/login (session cookie set)
2. Client opens WebSocket to `wss://host/board/:id` (cookie validated before upgrade)
3. Worker routes WebSocket to Board Durable Object
4. DO manages all board state: objects in DO Storage (`obj:{uuid}`), cursors in memory
5. Mutations flow: client applies optimistically -> sends to DO -> DO persists + broadcasts to other clients
6. AI commands: client sends to Worker -> Worker calls Workers AI with function calling -> resulting mutations sent to DO as regular object operations

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

## Conventions

- TypeScript strict mode
- camelCase variables/functions, PascalCase components/types, kebab-case utility files
- ESLint + Prettier enforced
- Feature-based organization on client side
- Vertical slices - each increment delivers user-visible behavior
- Never break sync - every commit should pass the 2-browser test
