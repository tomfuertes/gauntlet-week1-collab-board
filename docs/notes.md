# Notes

*Internal project management scratch. Not a deliverable.*

## Session 16 Context (Feb 18, 2026)

### What Was Done
- **AI Batch Undo (Sprint 3):** One-click undo of all objects from a single AI action. `batchId` on BoardObject, generated per `streamText` call in `chat-agent.ts`, stamped on all AI-created objects. "Undo AI" button appears after AI completes, auto-hides after 10s or on canvas interaction. Two undo paths: Cmd+Z via `pushExternalBatch` on the undo stack (batch entry tagged with batchId), and "Undo AI" button (uses stack undo if top matches, falls back to server-side `batch:undo` WS message). Server-side `undoBatch` on Board DO lists/deletes objects by batchId and broadcasts `obj:delete` for each.

### What's Next
- [ ] Verify chat history persistence across page refreshes
- [ ] Production deploy verification
- [ ] Sprint 1: AI Cursor Presence (~6hrs)
- [ ] Sprint 2: Contextual AI Actions / right-click menu (~6hrs)
- [x] Sprint 3: AI Batch Undo (~4hrs) - DONE
- [ ] Sprint 4: Intent Preview / ghost objects (~6hrs)
- [ ] Sprint 5: AI Board Generation from description (~4hrs)

---

## Session 15 Context (Feb 18, 2026)

### What Was Done
- **Live text sync + multi-cursor typing:** Real-time text broadcast, remote caret indicators via mirror-div technique, `text:cursor`/`text:blur` WS messages, DO hibernation-safe attachment state
- **Architecture audit (PR #23):** DRY AI tools, system prompt geometry tables, template coord injection, Board.tsx extractions (1616->1435 lines), overlap scoring, observability logging
- **PR review fixes (PR #23):** setTimeout cleanup, try-catch on DO RPC, try-finally DOM cleanup, cursor color consistency (hash-based), connector return value, WS error logging
- **Stale cursor TTL (PR #24):** `lastSeen` + 5s sweep interval for text cursors dropped on WS disconnect
- **Competitive research:** Miro Sidekicks, FigJam selection-gated AI, tldraw Make Real, MS Whiteboard Categorize. Synthesized into 5 sprint proposals.

---

## Roadmap Status

**Shipped:** Pre-search, scaffold, auth, infinite canvas, cursor sync, presence, sticky notes, rectangles, circles, lines, connectors/arrows, standalone text, frames, move/resize/rotate, multi-select, copy/paste/duplicate, undo/redo, delete, AI agent (10 tools, DRY helpers, overlap scoring), chat panel (chips, templates, typing indicator), multi-board CRUD, hash routing, color picker, toolbar, connection toasts, loading skeleton, empty state hint, cursor smoothing, entrance animations, confetti, gradient background, cursor trails, keyboard shortcuts, privacy policy, data deletion endpoint, context menu, selection-aware AI, AI object glow, live text sync, remote carets, stale cursor TTL, **AI batch undo (batchId, Undo AI button, Cmd+Z batch support)**.

**Skipped (scope cut):** Fit-to-content button, ambient grid parallax, board minimap.

**Fast-Follow (post-submission):** OAuth, board permissions, export (PDF/PNG), mobile-responsive UI.

---

## Open Tech Debt

**Security:**
- No rate limiting on auth + AI endpoints
- AI route accepts arbitrary boardId - can create phantom DOs
- No upper bound on AI chat history
- Username enumeration via signup 409

**React/Konva:**
- `ToolIconBtn` not memoized (8 instances re-render on cursor updates)
- No React error boundary

**UX/Polish:**
- Vite build >500KB chunk - needs code splitting
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close code handling
- Undo stack not cleared on WS reconnect

**Won't Fix (Week 1):**
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
| Feb 17 | DO RPC over fetch routing | Type-safe, TS-checked stubs |
| Feb 17 | Scroll-to-pan, ctrl+scroll-to-zoom | Matches Figma/Miro convention |
| Feb 17 | AI tools: orthogonal over monolithic | One tool = one responsibility for LLM accuracy |
| Feb 17 | GLM-4.7-Flash over Llama 3.3 | 131K context, native multi-turn tool calling, still free |
| Feb 17 | Agents SDK over manual SSE | Server-side persistence, WS streaming, automatic tool loop |
| Feb 17 | Template coord injection over LLM geometry | LLM as content generator, not geometry solver |
| Feb 17 | Overlap score metric over visual QA | Single number for AI layout quality |
| Feb 18 | Hash-based cursor colors over index-based | Deterministic per userId regardless of array order |
| Feb 18 | TTL sweep for ephemeral WS state | Can't rely on explicit cleanup messages (text:blur drops on disconnect) |

---

## AI Model Pricing

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| GLM-4.7-Flash (Workers AI) | Free | Free | Good | 131K context, multi-turn tool calling |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod |

`streamText` with `stopWhen: stepCountIs(5)` limits to 5 LLM round-trips.
