# AI Development Log

*CollabBoard - Gauntlet AI Week 1*

## Tools & Workflow

- **Claude Code** (primary) - CLI pair programming. Architecture, scaffolding, full feature implementation, browser testing via playwright-cli skill. Used for ~95% of all code generation.
- **Cursor** (secondary) - IDE AI for focused single-file edits, quick fixes, and reading code in context.
- **No MCP servers used** - Claude Code native tools + playwright-cli skill covered all needs.

## AI-First Methodology

Development followed a tight loop across 8 sessions in a single 12-hour sprint (Feb 16, 1:00 PM - Feb 17, 1:00 AM CST), producing 99 commits. Every feature was implemented AI-first: describe what you want, let the AI scaffold it, then refine through review and automated testing.

### Session flow pattern
1. SessionStart hook reads context (notes.md, CLAUDE.md, git log) - ensures continuity
2. Plan mode for non-trivial features (multi-board, AI agent, connector arrows)
3. Implement with Claude Code (vertical slices, prove-it-works-before-done)
4. Playwright-cli UAT (automated browser testing, no manual clicking)
5. PreCompact hook dumps context back to notes.md before context compression

### Development timeline

| Session | Time | Duration | What was built |
|---------|------|----------|---------------|
| 1 | 12:59-15:23 | 2.5h | Scaffold, auth (PBKDF2), infinite canvas, WebSocket cursor sync, presence |
| 2 | 15:47-16:00 | 15min | Fix WS sync - migrate to Hibernation API attachments |
| 3 | 16:35-17:57 | 1.5h | Sticky notes, rectangles, AI agent (10 tools), chat streaming, ESLint |
| 4 | 18:00-18:08 | 10min | Delete objects, board clear endpoint, favicon |
| 5 | 18:21-18:52 | 30min | Multi-board CRUD, D1 migrations, hash routing, AI pricing analysis |
| 6 | 19:26-20:27 | 1h | Worktree infra, resize, color picker, reconnect, UX polish, undo/redo |
| 7 | 20:34-23:27 | 3h | Toolbar redesign, circles, lines, text, connectors, frames, multi-select, E2E tests, copy/paste, Haiku AI model, visual polish |
| 8 | 23:45-01:01 | 1.25h | Security audit, performance tier fixes, DO RPC refactor, DRY types |

### What worked

1. **Vertical slices with automated verification** - Each feature landed as a single commit with real-time sync working end-to-end. The pattern of "implement -> playwright-cli UAT -> commit" caught sync bugs before they compounded. Example: sticky notes went from zero to create/drag/edit/sync in one 20-minute commit (`16:35:44`).

2. **Session hooks for context continuity** - SessionStart and PreCompact hooks automated the "read context on startup, dump context before compression" workflow. This let 8 sessions feel like one continuous session - no time lost re-orienting after context window compression.

3. **Plan mode for architectural decisions** - Multi-board support required D1 migrations, hash routing, board list UI, and API changes. Plan mode mapped this out before any code was written, resulting in a clean single commit (`18:21:31`) instead of iterative fumbling.

4. **AI agent bootstrapping** - The entire AI tool-calling system (10 tools, system prompt, SSE streaming, tool progress UI) went from zero to functional in 2 commits over 35 minutes. Claude Code understood the Cloudflare `runWithTools()` API and generated correct tool schemas on the first pass.

5. **Worktree parallelization** - After session 6, feature branches (copy/paste, visual polish, AI model upgrade) ran in parallel worktrees. Each worktree had isolated ports, its own playwright-cli session namespace, and could be worked on independently.

### What didn't

1. **Llama 3.3 70B tool-use discipline** - The open-source model skipped `read_board` before `update_object`, causing blind overwrites. It also triple-created objects when `maxRecursiveToolRuns` was set to 10 (each round-trip re-executed all tools). Required reducing to 3 rounds and adding explicit system prompt guardrails: "ALWAYS call read_board first."

2. **Better Auth on CF Workers** - Session 1 initially scaffolded Better Auth, but hit runtime bugs in v1.4.x on Workers. Pivoted to custom PBKDF2 auth in the same session - the pivot cost ~20 minutes but produced a simpler, zero-dependency solution.

3. **WebSocket in-memory state** - First WS implementation stored connections in a `Map`. This broke across DO requests because each request gets a fresh isolate. Had to refactor to Hibernation API `state.getWebSockets()` with tag-based attachments. The AI generated the initial broken approach but also correctly identified and fixed the issue in session 2.

4. **E2E CI reliability** - Playwright E2E tests passed locally (15/15) but failed in GitHub Actions due to `wrangler dev` remote proxy session issues. Spent time debugging CI infrastructure instead of features. Ultimately removed CI E2E in favor of local playwright-cli validation.

5. **Canvas interaction edge cases** - Scroll-to-pan, Transformer desync after resize, text editing overlay rotation, and line transform clamping all required follow-up fix commits. The initial implementations were 90% right but missed edge cases that only surfaced through manual testing.

## Code Attribution

99 commits, ~10 hours active development. Nearly all code was AI-generated with human review, direction, and prompt engineering. The human role was architect/PM: deciding what to build, reviewing output, catching edge cases, and steering corrections.

| Area | Files | Lines | AI-generated | Hand-edited | Notes |
|------|-------|-------|-------------|-------------|-------|
| Backend (server/) | 5 | 1,076 | ~85% | ~15% | ai.ts (514 LOC) largest file - dual LLM paths, 10 tool defs |
| Frontend (client/) | 11 | 2,727 | ~90% | ~10% | Board.tsx (1,472 LOC) needed most iteration (canvas edges) |
| Shared types | 1 | 52 | ~95% | ~5% | Type definitions correct on first pass |
| Config / tooling | 4 | 118 | ~30% | ~70% | wrangler.toml, vite/ts/eslint config - mostly hand-tuned |
| E2E tests | 5 | 394 | ~40% | ~60% | Helpers AI-generated, test cases hand-written |
| Docs | 8 | 222 | ~50% | ~50% | AI-drafted, human-curated and pruned |
| **Total** | **34** | **~4,600** | **~80%** | **~20%** | |

Notable files by size: Board.tsx (1,472), ai.ts (514), ChatPanel.tsx (287), auth.ts (237), useWebSocket.ts (178).

## Key Learnings

1. **Session context management matters more than prompt engineering** - The SessionStart/PreCompact hook pattern, combined with notes.md as persistent memory, eliminated the #1 pain point of long AI coding sessions: losing context. CLAUDE.md as architecture truth + notes.md as session state = the AI always knows where it left off.

2. **Playwright-cli turns UAT from manual to automated** - Instead of opening two browser tabs and clicking around, every feature was verified by automated browser commands. This caught WebSocket sync bugs that manual testing would have missed (race conditions, reconnect edge cases). The two-session pattern (`-s=user1`, `-s=user2`) was the primary quality gate.

3. **Open-source model tool-use is the real bottleneck** - Llama 3.3 70B is free but has terrible tool discipline. It ignores instructions to read before write, creates duplicate objects, and hallucinates tool parameters. Upgrading to Claude Haiku 4.5 via AI Gateway was a night-and-day improvement in tool-calling reliability - worth the $0.001/request.

4. **Vertical slices beat horizontal layers** - Building auth-to-UI-to-sync for sticky notes in one commit, then repeating for rectangles, then circles, etc. was dramatically faster than building "all shapes" then "all sync" then "all UI." Each slice proved the pattern worked before adding complexity.

5. **AI excels at boilerplate, struggles at integration boundaries** - Type definitions, CRUD routes, React components, tool schemas - all generated correctly on first pass. But the seams (WebSocket + DO state, canvas events + React state, AI tools + DO mutations) required human-guided iteration.
