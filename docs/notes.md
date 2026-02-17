# Notes

*Internal project management scratch. Not a deliverable.*

## Session 9 Context (Feb 17, 2026)

### What Was Done
- DO RPC refactor: 15 `stub.fetch()` calls replaced with typed RPC methods. Board extends `DurableObject`, `state` -> `ctx`.
- CI hardening: `CLOUDFLARE_API_TOKEN` env for remote AI binding, wrangler telemetry disabled.
- `wrangler types` pipeline: `cf-typegen` script, tsconfig includes generated types, removed `@cloudflare/workers-types`.
- Shared `Bindings` type in `src/server/env.ts` - eliminated 3 duplicates.
- Canvas interaction fixes: scroll-to-pan (Figma-style), Transformer desync after resize, editing overlay rotation, Transformer remote sync, line transform.
- AI mutate now returns `{ ok, error }` - surfaces "object not found" back to LLM instead of silent success.
- Consolidated audit.md into notes.md. `ANTHROPIC_API_KEY` deployed to prod.

### What's Next
**Tier 5 - Deliverables:**
- [ ] AI dev log (fill all TODO sections)
- [ ] AI cost analysis (fill dev spend actuals)
- [ ] Demo video (3-5 min)
- [ ] Social post
- [ ] README polish + screenshot
- [ ] Prod smoke test (2-browser)

### Blockers
- E2E CI: port fix pushed, not verified passing.

---

## Open Tech Debt

**Security:**
- No rate limiting on auth + AI endpoints (CF config)
- WS message: size limit + field validation (JSON.parse try/catch done)
- AI route accepts arbitrary boardId - no D1 existence check, can create phantom DOs
- No upper bound on AI chat history - client sends full history, no server-side truncation
- `verifyPassword` uses string equality (timing attack, mitigated by PBKDF2 dominance)
- Username enumeration via signup 409

**React/Konva:**
- `ToolIconBtn` not memoized (8 instances re-render on cursor updates)
- StrictMode violations: confetti ref mutated during render, Cursors.tsx position refs during render
- `useAIChat.sendMessage` depends on `messages` state (stale closure, recreated after every exchange)

**Architecture:**
- KV storage on SQLite-backed DO (functional, not leveraging SQL)
- Session rows never cleaned up (low at current scale)
- Auth middleware inline, not Hono middleware (risk for new routes)
- AI `update_object` does flat props replace (not deep merge)

**UX/Polish:**
- Vite build >500KB chunk (konva + react) - needs code splitting
- Circles have no resize handles (drag-to-move only)
- No React error boundary
- WS reconnect: no max retry, no non-retryable close code handling
- Undo stack not cleared on WS reconnect (stale snapshots)

**AI Agent:**
- `createConnector(fromId, toId)` uses coordinates not object IDs (partial spec compliance)
- SWOT/arrange-in-grid: Haiku deployed, needs prod verification
- Board mutation via WS has no board-level auth (intentional: "any auth'd user can access any board")

**Won't Fix (Week 1):**
- Board.tsx ~1200 lines god component (high-effort mid-sprint)
- `send()` silently drops messages during reconnect window

---

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 16 | Custom auth over Better Auth | Active CF Workers bugs in Better Auth 1.4.x |
| Feb 16 | PBKDF2 over argon2 | Web Crypto built-in, zero deps |
| Feb 16 | No CRDTs | DOs serialize writes, LWW by construction |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is the differentiator |
| Feb 16 | HTML overlay for text editing | Konva built-in doesn't support multiline |
| Feb 16 | Hash routing over React Router | Zero deps, shareable links |
| Feb 16 | Tracked migrations over raw execute | `d1_migrations` table, `npm run migrate` |
| Feb 16 | Llama 3.3 + Haiku upgrade path | Free tier for demo, Haiku for quality |
| Feb 16 | No freehand drawing | Spec doesn't require it |
| Feb 17 | DO RPC over fetch routing | Type-safe, `DurableObjectNamespace<Board>` enables TS checking |
| Feb 17 | Generated types over workers-types | `wrangler types` generates full runtime types + env bindings |
| Feb 17 | Scroll-to-pan, ctrl+scroll-to-zoom | Matches Figma/Miro convention |

---

## AI Model Pricing Reference

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| Llama 3.3 70B (Workers AI) | $0.29 | $2.25 | Poor | Free tier. Skips read-before-update. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Best agentic reliability. Deployed to prod. |

`runWithTools` internals: `maxRecursiveToolRuns` counts LLM round-trips, not tool calls. Each round: LLM response -> execute ALL tools in parallel -> add results -> next round. We use 3 (was 10, caused triple-creation).
