# Notes

*Internal project management scratch. Not a deliverable.*

## Session 12 Context (Feb 17, 2026)

### What Was Done
- DRY tool registry: extracted 10 tool definitions from inline ai.ts (583 -> 190 lines) into `src/server/ai-tools.ts`
- Shared tool display metadata: `src/shared/ai-tool-meta.ts` (icons, labels, summaries) consumed by both ChatPanel and ai.ts
- GLM-4.7-Flash model swap: replaced Llama 3.3 70B as free-tier fallback (131K context, native multi-turn tool calling)
- CLAUDE.md updated with new architecture (ai-tools.ts, ai-tool-meta.ts, GLM model)

### What's Next
- [ ] Evaluate Cloudflare Agents SDK migration (post-submission)

---

## Roadmap Status

**Shipped:** Pre-search, scaffold, auth, infinite canvas, cursor sync, presence, sticky notes, rectangles, circles, lines, connectors/arrows, standalone text, frames, move/resize/rotate, multi-select, copy/paste/duplicate, undo/redo, delete, AI agent (10 tools, refactored), chat panel (chips, templates, typing indicator), multi-board CRUD, hash routing, color picker, toolbar, connection toasts, loading skeleton, empty state hint, cursor smoothing, entrance animations, confetti, gradient background, cursor trails, keyboard shortcuts, privacy policy, data deletion endpoint, context menu, selection-aware AI, AI object glow.

**Skipped (scope cut):**
- Fit-to-content / zoom-to-all button
- Ambient grid parallax
- Board minimap

**Fast-Follow (post-submission):**
- OAuth (GitHub/Google)
- Board permissions (owner/editor/viewer roles)
- Export (PDF/PNG)
- Mobile-responsive UI

---

## Open Tech Debt

**Security:**
- No rate limiting on auth + AI endpoints (CF config)
- WS message: size limit + field validation (JSON.parse try/catch done)
- AI route accepts arbitrary boardId - can create phantom DOs
- No upper bound on AI chat history - no server-side truncation
- `verifyPassword` string equality (timing attack, mitigated by PBKDF2)
- Username enumeration via signup 409

**React/Konva:**
- `ToolIconBtn` not memoized (8 instances re-render on cursor updates)
- StrictMode violations: confetti ref + Cursors.tsx position refs mutated during render
- `useAIChat.sendMessage` stale closure on `messages` state

**Architecture:**
- KV storage on SQLite-backed DO (functional, not leveraging SQL)
- Session rows never cleaned up (low at current scale)
- Auth middleware inline, not Hono middleware

**UX/Polish:**
- Vite build >500KB chunk - needs code splitting
- Circles have no resize handles (drag-to-move only)
- No React error boundary
- WS reconnect: no max retry, no non-retryable close code handling
- Undo stack not cleared on WS reconnect (stale snapshots)
- Confetti burst too small, only fires on first object

**AI Agent:**
- SWOT/arrange-in-grid: Haiku deployed, needs prod verification
- Board mutation via WS has no board-level auth (intentional)

**Won't Fix (Week 1):**
- Board.tsx ~1200 lines god component
- `send()` silently drops messages during reconnect window

---

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 16 | Custom auth over Better Auth | CF Workers bugs in Better Auth 1.4.x |
| Feb 16 | PBKDF2 over argon2 | Web Crypto built-in, zero deps |
| Feb 16 | No CRDTs | DOs serialize writes, LWW by construction |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is differentiator |
| Feb 16 | HTML overlay for text editing | Konva doesn't support multiline |
| Feb 16 | Hash routing over React Router | Zero deps, shareable links |
| Feb 16 | Llama 3.3 + Haiku upgrade path | Free tier for demo, Haiku for quality (replaced by GLM Feb 17) |
| Feb 16 | No freehand drawing | Spec doesn't require it |
| Feb 17 | DO RPC over fetch routing | Type-safe, TS-checked stubs |
| Feb 17 | Generated types over workers-types | `wrangler types` full runtime types |
| Feb 17 | Scroll-to-pan, ctrl+scroll-to-zoom | Matches Figma/Miro convention |
| Feb 17 | AI tools: orthogonal over monolithic | One tool = one responsibility for LLM accuracy |
| Feb 17 | DRY tool registry over inline defs | Single source of truth, ai.ts 583->190 lines |
| Feb 17 | GLM-4.7-Flash over Llama 3.3 | 131K context, native multi-turn tool calling, still free |

---

## AI Model Pricing

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| GLM-4.7-Flash (Workers AI) | Free | Free | Good | 131K context, multi-turn tool calling. Replaced Llama 3.3. |
| Llama 3.3 70B (Workers AI) | $0.29 | $2.25 | Poor | Previous fallback. Skipped read-before-update. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod. |

`runWithTools`: `maxRecursiveToolRuns` counts LLM round-trips, not tool calls. We use 3 (was 10, caused triple-creation).
