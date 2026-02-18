# Notes

*Internal project management scratch. Not a deliverable.*

## Session 17 Context (Feb 18, 2026)

### What Was Done
- **Multiplayer chat attribution (merged):** `[username]` prefix in persisted messages, AI sees "Alice said: ...". Color-coded sender names in ChatPanel via `getUserColor()`. Two-worktree parallel build.
- **Improv mode (PR #27, merged):** "Yes, and" system prompt (escalate by one notch, callbacks, spatial canvas, short punchlines). 7 scene starter templates replacing business templates. Overlay text updated to improv theme.
- **UI consistency cleanup (merged):** Deduplicated `getUserColor()` + `CURSOR_COLORS` to theme.ts (was in 3 files). Killed hardcoded hex in BoardList/App (now use `colors.*`). Extracted ChatPanel `<style>` keyframes to animations.css. Updated suggestion chips to improv ("Add a plot twist", etc).
- **Worktree DX (5 commits):** `scripts/dev.sh` auto-loads `worktree.ports` (no more `source` command). `worktree.sh create` now runs `npm install`, `npm run build`, `npm run migrate:local`. `worktree.sh remove` uses `--force` for gitignored files, errors on dirty tracked files.
- **Dep bumps:** ai 6.0.90->6.0.91, hono 4.7.0->4.11.10, wrangler 4.65.0->4.66.0.

### What's Next
- [ ] UAT on prod (full improv flow: auth -> board -> scene gen -> multiplayer chat with attribution)
- [ ] AI cost analysis
- [ ] Final gate Feb 22

---

## Roadmap Status

**Shipped:** Pre-search, scaffold, auth, infinite canvas, cursor sync, presence, sticky notes, rectangles, circles, lines, connectors/arrows, standalone text, frames, move/resize/rotate, multi-select, copy/paste/duplicate, undo/redo, delete, AI agent (10 tools, DRY helpers, overlap scoring, updateAndMutate, type-linked ToolName), chat panel (chips, templates, typing indicator, server-side history persistence), multi-board CRUD, hash routing, color picker, toolbar, connection toasts, loading skeleton, empty state hint, cursor smoothing, entrance animations, confetti, gradient background, cursor trails, keyboard shortcuts, privacy policy, data deletion endpoint, context menu, selection-aware AI, AI object glow, live text sync, remote carets, stale cursor TTL, AI batch undo (batchId, Undo AI button, Cmd+Z batch), AI presence lite (cursor dot, presence bar), AI board generation (empty state overlay, suggestion chips, board-templates.ts), multiplayer chat attribution ([username] prefix, color-coded sender names), improv mode ("yes, and" prompt, 7 scene templates), UI consistency (theme dedup, animations.css extraction), scene playback (event recording in DO, public replay endpoint, ReplayViewer with play/pause, share scene button).

**Killed (PM eval):** Contextual AI Actions (clustering unreliable on free-tier LLM), Intent Preview (problem overlap with batch undo at 3x cost).

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
- No guard against `sendMessage` when ChatAgent WS is disconnected - messages silently lost

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
| Feb 18 | TTL sweep for ephemeral WS state | Can't rely on explicit cleanup messages |
| Feb 18 | Multiplayer improv canvas as north star | Existing shared chat + canvas needs ~3hrs new code. Nobody has multiplayer + AI + canvas + improv. |
| Feb 18 | No Tailwind (yet) | 118 inline styles across 5 components. Fix consistency (theme dedup, kill hardcoded hex) not framework. Revisit post-deadline if >15 components. |
| Feb 18 | Worktree DX: auto-load ports in dev.sh | Eliminates un-whitelistable `source worktree.ports` command |

---

## AI Model Pricing

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| GLM-4.7-Flash (Workers AI) | Free | Free | Good | 131K context, multi-turn tool calling |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod |

`streamText` with `stopWhen: stepCountIs(5)` limits to 5 LLM round-trips.
