# Notes

*Internal project management scratch. Not a deliverable.*

## Session 13 Context (Feb 17, 2026)

### What Was Done
- **Cloudflare Agents SDK migration:** Replaced manual Hono SSE route + custom useAIChat with AIChatAgent DO + useAgentChat
  - New: `src/server/chat-agent.ts` (ChatAgent DO, ~70 lines), `src/server/ai-tools-sdk.ts` (10 tools, Zod + AI SDK tool(), ~330 lines)
  - Deleted: `src/server/ai.ts`, `src/server/ai-tools.ts`, `@cloudflare/ai-utils` dependency
  - Rewrote: `src/client/hooks/useAIChat.ts` as adapter over useAgentChat (preserves ChatPanel interface)
  - Config: wrangler.toml (CHAT_AGENT DO + v2 migration + nodejs_compat), env.ts, index.ts (/agents/* auth route), vite.config.ts (WS proxy)
  - New deps: agents, @cloudflare/ai-chat, ai (v6), @ai-sdk/anthropic, workers-ai-provider, zod (v4)
- Gains: server-side chat persistence (DO SQLite), WebSocket streaming, automatic tool loop, provider abstraction
- UAT passed: auth, board creation, single-tool (sticky), multi-tool (SWOT analysis)

### What's Next
- [ ] Verify chat history persistence across page refreshes (new capability)
- [ ] Test 2-browser sync for AI actions (UAT covered single browser)
- [ ] Production deploy verification (CF git integration)

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
- `useAIChat.sendMessage` stale closure on `messages` state (mitigated: SDK manages state server-side now)

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
- `createShape` in `ai-tools-sdk.ts` has 3-branch duplication (~30 lines recoverable with config object)

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
| Feb 17 | Agents SDK over manual SSE | Server-side persistence, WS streaming, provider abstraction, automatic tool loop |
| Feb 17 | useAIChat adapter over ChatPanel rewrite | Zero UI changes, preserves AIChatMessage interface |

---

## AI Model Pricing

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| GLM-4.7-Flash (Workers AI) | Free | Free | Good | 131K context, multi-turn tool calling. Replaced Llama 3.3. |
| Llama 3.3 70B (Workers AI) | $0.29 | $2.25 | Poor | Previous fallback. Skipped read-before-update. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod. |

`streamText` with `stopWhen: stepCountIs(5)` limits to 5 LLM round-trips. Replaced `runWithTools` (max 3) in Agents SDK migration.
