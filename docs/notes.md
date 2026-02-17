# Notes

*Internal project management scratch. Not a deliverable.*

## Session 8 Context Dump (Feb 16-17, 2026)

### What Was Done
1. **Custom agents created** (`.claude/agents/uat.md`, `.claude/agents/worktree-setup.md`) - UAT runs on Sonnet, worktree setup on Haiku. Delegation rules in CLAUDE.md.
2. **E2E CI fix** - `playwright.config.ts` baseURL was Vite HMR port (5175), not wrangler port (8789). Tests were hitting frontend-only server with no API. Fixed + pushed.
3. **Full codebase audit** - 7 parallel Sonnet agents: spec compliance, git forensics, React/Konva perf, DO architecture, security, React patterns, strategic roadmap. Results in `docs/audit.md`.
4. **spec.pdf purged from git history** - was committed in plaintext at `docs/spec.pdf`. Used `git filter-repo` to remove from all history, moved to `docs/encrypted/spec.pdf` (git-crypt encrypted). Force pushed. All clones/worktrees need `git fetch && git reset --hard origin/main`.
5. **Spec re-read** - freehand drawing NOT required. AI tool schema gaps identified.

### What's Next (read `docs/audit.md` for full tier plan)
**Tier 1 - Trivial fixes (DONE):**
- [x] `/api/board/:boardId/clear` ownership check added (matches DELETE route pattern)
- [x] `JSON.parse` try/catch in DO `webSocketMessage`
- [x] Password min length 4 -> 8
- [x] `getMeta` inlined into `getPresenceList` (was used, not dead - audit was wrong)
- [x] Redundant `ws.close()` removed in `webSocketClose`

**Tier 2 - Performance (DONE, 3 of 4):**
- [x] Grid rendering: 2000 `<Rect>` nodes -> 1 `<Shape>` with canvas 2D `sceneFunc`
- [x] Memoize object components: `BoardObjectRenderer` wrapped in `React.memo`
- [x] Ref-mirror `stagePos`/`scale`/`selectedIds` to stabilize all callbacks
- [ ] ~~Split `useWebSocket`~~ - skipped, memoization mitigates cursor re-render cost

**Tier 3 - Memory leaks (DONE):**
- [x] Cancel SSE stream in `useAIChat` on unmount (AbortController ref + useEffect cleanup)
- [x] Destroy Konva Tweens on completion (`onFinish: () => tween.destroy()`)
- [x] AbortController on BoardList fetch (abort on unmount, guard state updates)

**Tier 4 - Spec gaps (DONE):**
- [x] Add `width`/`height` to `update_object` AI tool
- [x] Privacy policy page (`#privacy` route, linked from AuthForm)
- [x] Data deletion endpoint (`DELETE /api/user` - deletes boards, sessions, user)
- [x] Board delete broadcasts `board:deleted` + closes WS connections

**Tier 5 - Deliverables (~6hr):**
- AI dev log (fill TODOs), AI cost analysis (fill actuals), demo video, social post, README polish, prod smoke test

### Blockers
- SWOT eval criterion needs `ANTHROPIC_API_KEY` set as Worker secret on prod (Haiku path merged in PR #16 but key not deployed)
- E2E CI may still fail - port fix pushed but not verified passing yet

---

## AI Model Pricing Reference (Feb 2026)

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| Llama 3.3 70B (Workers AI) | $0.29 | $2.25 | Poor | Free tier. Duplicate calls, skips read-before-update. |
| GPT-4.1 Mini (OpenAI) | $0.40 | $1.60 | Good | Solid budget option. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Best agentic reliability. |

**Decision made:** Haiku 4.5 with Llama 3.3 fallback (PR #16). Multi-model key-gated selection implemented.

`runWithTools` internals: `maxRecursiveToolRuns` counts LLM round-trips, not tool calls. Each round: LLM response -> execute ALL tools in parallel -> add results -> next round. We use 3 (was 10, caused triple-creation).

---

## Key Decisions (all sessions)

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 16 | Custom auth over Better Auth | Active CF Workers bugs in Better Auth 1.4.x |
| Feb 16 | PBKDF2 over argon2 | Web Crypto built-in, zero deps |
| Feb 16 | No CRDTs | DOs serialize writes, LWW by construction |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is the differentiator |
| Feb 16 | HTML overlay for text editing | Konva built-in doesn't support multiline |
| Feb 16 | Hash routing over React Router | Zero deps, shareable links |
| Feb 16 | Tracked migrations over raw execute | `d1_migrations` table, `npm run migrate` |
| Feb 16 | Llama 3.3 + Haiku upgrade path | Free tier for demo, Haiku for quality (PR #16) |
| Feb 16 | Custom agents over inline execution | Opus too expensive for playwright/worktree work |
| Feb 16 | No freehand drawing | Spec doesn't require it |
| Feb 17 | Force-push history rewrite | spec.pdf in plaintext, purged with git filter-repo |
| Feb 17 | DO RPC over fetch routing | Type-safe, fewer lines, `DurableObjectNamespace<Board>` enables TS checking |
| Feb 17 | Generated types over `@cloudflare/workers-types` | `wrangler types` generates full runtime types + env bindings |

---

## Known Tech Debt

**From audit (see `docs/audit.md` for full details):**
- ~~`/clear` endpoint missing ownership check~~ (FIXED)
- ~~Board delete doesn't close live WS connections~~ (FIXED - Tier 4: broadcasts `board:deleted` + closes connections)
- No rate limiting on auth + AI endpoints
- ~~No WS message validation (JSON.parse)~~ (FIXED - try/catch added). Size limit + field validation still open.
- ~~AI `update_object` missing `width`/`height` params~~ (FIXED)
- ~~DO fetch-based communication~~ (FIXED - refactored to typed RPC: `readObjects`, `mutate`, `clearBoard`, `deleteBoard`)

**Pre-existing:**
- Vite build >500KB chunk (konva + react) - code split in polish
- WS reconnect: no max retry, no non-retryable close code handling
- `send()` silently drops messages during reconnect window
- Undo stack not cleared on WS reconnect (stale snapshots)
- AI `update_object` does flat props replace (not deep merge)
- Lines/circles have no resize handles (drag-to-move only)
- No React error boundary

**Performance (from audit):**
- ~~Grid renders 2000+ `<Rect>` nodes per frame~~ (FIXED - single `<Shape>` sceneFunc)
- ~~All 500 objects re-render on any single change~~ (FIXED - `React.memo` BoardObjectRenderer)
- ~~Cursor updates trigger full Board re-render~~ (MITIGATED - memo prevents child re-renders)
- ~~Konva Tweens never destroyed~~ (FIXED - onFinish destroy)
- ~~SSE stream reader not cancelled on unmount~~ (FIXED - AbortController ref)
