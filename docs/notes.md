# Notes

*Internal project management scratch. Not a deliverable.*

## Session 16 Context (Feb 18, 2026)

### What Was Done
- **DRY refactor (merged):** `updateAndMutate` helper + type-linked `ToolName` export. Also added try/catch to `deleteObject`. Net: +46/-45 lines across 2 files.
- **PM Skills evaluation (merged):** Tested 3 of 42 skills against CollabBoard. 2 survived: company-research (WebSearch), discovery-process (KILL gate). Full results in `docs/pm-eval/`. Pipeline (ccpm + bridge) rejected.
- **Sprint reprioritization via PM eval:** All 3 skills converged on AI Board Generation as Sprint 1. KILL'd Sprints 2+4 (contextual AI actions, intent preview). PIVOTed Sprint 1 to 2hr lite version. Cut 26hrs planned to 10hrs.
- **AI Board Generation (PR #26, merged):** Empty state sparkle overlay, suggestion chips, board-templates.ts with layout presets, enhanced system prompt. Gateway feature - first thing evaluators see.
- **AI Batch Undo (PR #25, merged):** batchId on AI-created objects, Undo AI button, Cmd+Z batch support. One click to undo a 12-object SWOT.
- **AI Presence Lite (merged):** AI cursor dot (pulsing, sky-400), AI in presence bar during tool execution. Fire-and-forget cursorToCenter() on all tools. Idempotent cleanup (onFinish + abort + try/catch).
- **UAT on prod (3 parallel agents):** Chat persistence PASS, SWOT overlap 0/3 runs PASS, prod smoke test PASS (auth, CRUD, AI, 2-browser sync all verified).
- **Inside the Box analysis:** Applied SIT framework (Subtraction, Division, Multiplication, Task Unification, Attribute Dependency) to find differentiated niches. Explored business niches (solo strategist, facilitator, adversarial strategy, system design interviews, incident war room) and joy/play niches (worldbuilder, conspiracy board, ELI5, collaborative story, digital garden, improv canvas).
- **North star exploration:** Multiplayer improv canvas. Shared chat (already works via AIChatAgent DO), shared canvas (already works via Board DO), AI as scene partner. ~3hrs of new code on existing architecture. Written to `docs/new-north-star.md`.

### What's Next
- [ ] Improv canvas: username attribution in chat messages (attach sender in useAgentChat body)
- [ ] Improv canvas: ChatPanel multiplayer UI (color-coded names per sender)
- [ ] Improv canvas: "Yes, and" system prompt mode in chat-agent.ts
- [ ] Improv canvas: scene starter templates (replace business templates in board gen overlay)
- [ ] devlog entry for Session 16
- [ ] Deliverables check: demo video, AI cost analysis, social post (Final gate Feb 22)

---

## Roadmap Status

**Shipped:** Pre-search, scaffold, auth, infinite canvas, cursor sync, presence, sticky notes, rectangles, circles, lines, connectors/arrows, standalone text, frames, move/resize/rotate, multi-select, copy/paste/duplicate, undo/redo, delete, AI agent (10 tools, DRY helpers, overlap scoring, updateAndMutate, type-linked ToolName), chat panel (chips, templates, typing indicator, server-side history persistence), multi-board CRUD, hash routing, color picker, toolbar, connection toasts, loading skeleton, empty state hint, cursor smoothing, entrance animations, confetti, gradient background, cursor trails, keyboard shortcuts, privacy policy, data deletion endpoint, context menu, selection-aware AI, AI object glow, live text sync, remote carets, stale cursor TTL, AI batch undo (batchId, Undo AI button, Cmd+Z batch), AI presence lite (cursor dot, presence bar), AI board generation (empty state overlay, suggestion chips, board-templates.ts).

**Killed (PM eval):** Contextual AI Actions (clustering unreliable on free-tier LLM), Intent Preview (problem overlap with batch undo at 3x cost).

**Exploring:** Multiplayer improv canvas (see `docs/new-north-star.md`).

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
| Feb 18 | DRY updateAndMutate + type-linked ToolName | Mirrors createAndMutate pattern; compiler enforces tool metadata sync |
| Feb 18 | AI Board Gen = Sprint 1 (was Sprint 5) | 3 independent PM evals converged: table stakes per Figma Make + Miro Flows |
| Feb 18 | KILL Sprints 2+4 | Sprint 2: clustering unreliable on free-tier LLM. Sprint 4: problem overlap with batch undo |
| Feb 18 | 2 of 42 PM skills worth installing | company-research (WebSearch), discovery-process (KILL gate). Rest is theater. |
| Feb 18 | Multiplayer improv canvas as north star | Existing shared chat + canvas arch needs only ~3hrs new code. Differentiated niche: nobody has multiplayer + AI + canvas + improv. |

---

## AI Model Pricing

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| GLM-4.7-Flash (Workers AI) | Free | Free | Good | 131K context, multi-turn tool calling |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod |

`streamText` with `stopWhen: stepCountIs(5)` limits to 5 LLM round-trips.
