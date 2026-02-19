# Notes

*Internal project management scratch. Not a deliverable.*

## Loose Ends

- **Remote D1 migrations 0004-0006 pending** - `npx wrangler login` then `npm run migrate:remote`
- **Daily challenges UAT incomplete** - API smoke tests passed; browser UAT not yet verified
- **No UAT on game modes or token budgets** - verify: hat prompt card + "Next prompt" advances, yes-and beat counter, budget phases + "New Scene" button, gallery badges, two-browser sync
- **No UAT on custom AI characters** - wrangler dev D1 was returning 500s on signup; feature code is clean (tsc passes), needs manual verification
- **CF issue filed** - [cloudflare/ai#404](https://github.com/cloudflare/ai/issues/404): `workers-ai-provider` drops `tool_choice` from `buildRunInputs`. Open, no response yet.
- **GLM-4.7-flash tool calling unverified in prod** - switched from Mistral; shim + native tool calling confirmed locally. Needs manual chat test.
- **Batch tool worktree in-flight** - `feat/batch-tool` at `../gauntlet-week1-collab-board-batch-tool`. batchExecute meta-tool (tool #12).

## Roadmap

### Shipped (grouped)

**Core canvas:** Infinite canvas, shapes (sticky/rect/circle/line/connector/text/frame/image), move/resize/rotate, multi-select, copy/paste/dup, undo/redo, delete, cursor sync, presence, keyboard shortcuts, context menu, color picker, floating toolbar.

**AI agent:** 11 tools (Zod schemas, DRY helpers), chat panel (chips, templates, typing, server-side history), selection-aware AI, AI object glow/confetti, batch undo, AI presence (cursor dot, bar), board generation (overlay + suggestion chips), AI image generation (SDXL), defensive tool validation.

**Multiplayer improv:** Multi-agent personas (SPARK + SAGE defaults, custom AI characters with CRUD API + modal UI, autonomous "yes, and", 3-exchange cooldown), AI Director (scene phases, 60s inactivity nudge, DO schedule alarms), dynamic intent chips, improv game modes (Scenes From a Hat, Yes-And Chain), per-scene token budgets (20-turn, 4 dramatic arc phases).

**Sharing/discovery:** Scene playback (event recording, public replay, ReplayViewer), scene gallery (public grid, gradient thumbnails), spectator mode (#watch, emoji reactions, spectator count), async notifications (unread badges).

**Infra/DX:** Custom auth (PBKDF2, D1 sessions), hash routing, onboard modal, connection toasts, perf overlay, AI architecture audit (prompt versioning, structured logging), vendor chunk splitting, Board.tsx decomposition, code cleanup sprint (16 items), AI model upgrade (Mistral Small 3.1, $5/day cap, Anthropic toggle).

**Killed:** Contextual AI Actions (clustering unreliable), Intent Preview (overlap with batch undo at 3x cost).

### Unshipped

| Feature | Notes |
|---------|-------|
| Narrative/relationship state | Formalize who-hates-whom graph. Makes multi-agent structural, not emergent. |
| Daily scene challenges + leaderboard | Shipped. Pending remote migration. |

## Open Tech Debt

### Security
- No rate limiting on auth + AI endpoints
- AI route accepts arbitrary boardId - can create phantom DOs
- No upper bound on AI chat history
- Username enumeration via signup 409

### Architecture
- ChatAgent error handling loose - tool failures logged but swallowed, LLM unaware of partial success
- Board DO (356L) acceptable - single source of truth must own mutations + broadcasts + storage

### UX/Polish
- ToolIconBtn not memoized (8 instances re-render on cursor updates)
- No React error boundary
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close code handling
- No guard against sendMessage when ChatAgent WS disconnected

### Won't Fix (Week 1)
- send() silently drops messages during reconnect window

## Exploration: CF Agent Patterns We Could Adopt

*From [CF Agents docs](https://developers.cloudflare.com/agents/), [Code Mode blog](https://blog.cloudflare.com/code-mode/), [patterns](https://developers.cloudflare.com/agents/patterns/). Our core patterns (AIChatAgent, AI SDK v6 tools, scheduling, React hooks) already align well.*

| Pattern | What it is | Our gap | Effort | Priority | Deep dive |
|---------|-----------|---------|--------|----------|-----------|
| **Code Mode** | LLM writes TypeScript calling tools as APIs, runs in V8 isolate. One "execute code" tool replaces N discrete tools. Eliminates round-trip tax between chained tool calls. | We use 11 discrete `tool()` calls with `stopWhen: stepCountIs(5)` to cap round-trips. Code Mode would let LLM chain all canvas ops in one shot. | Major. Worker Loader API in closed beta. | Watch for GA. Would be transformative for multi-tool scenes. | [exploration-code-mode.md](exploration-code-mode.md) |
| **Agent state sync** | `this.setState()` + auto-broadcast + `onStateChanged` for reactive client state. | We use raw DO Storage (`obj:{id}` keys) + manual WS broadcast with LWW. | Medium. Full rewrite of Board DO state layer. | Skip. Our LWW approach is simpler for canvas objects with optimistic updates. | [exploration-state-sync.md](exploration-state-sync.md) |
| **Task queues** | `this.queue()` for reliable async work with auto-dequeue + retry. | We use `ctx.waitUntil()` for fire-and-forget (reactive persona, activity recording). | Low. Drop-in replacement for waitUntil calls. | Low. Our tasks are best-effort. Queues add retry but we don't need guaranteed delivery. | [exploration-task-queues.md](exploration-task-queues.md) |
| **Tool approval gates** | `needsApproval` function on tools for human-in-the-loop consent. | We auto-execute all 11 tools. | Low. Add `needsApproval` to deleteObject. | Nice-to-have. Could gate destructive tools (delete, bulk updates) behind user OK. | [exploration-tool-approval.md](exploration-tool-approval.md) |
| **Evaluator-Optimizer** | Generator LLM produces output; evaluator LLM critiques; loop until quality threshold. | Our AI generates content in one pass (single streamText). | Medium. Add a quality-check step after tool execution. | Interesting for scene setup quality (check layout overlap score, regenerate if bad). | [exploration-evaluator-optimizer.md](exploration-evaluator-optimizer.md) |
| **Batch tool** | Poor man's Code Mode: one tool accepting an ordered array of operations, executes sequentially in one LLM step. No V8 isolate needed. | We make N tool calls = N round trips. Batch collapses to 1. | Low. Add tool #12 to ai-tools-sdk.ts. | High. Quick win for scene setup (4 calls -> 1). Key limit: can't chain results between ops. | [exploration-batch-tool.md](exploration-batch-tool.md) |

## Key Decisions (non-obvious, not already in CLAUDE.md)

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 19 | GLM-4.7-flash over Mistral Small 3.1 | Mistral ignores tool_choice:auto in streaming (0 tool calls despite 11 tools + shim). GLM has native tool calling + 6x cheaper input ($0.06 vs $0.35/M). Shim kept for safety. |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is differentiator |
| Feb 17 | Template coord injection over LLM geometry | LLM as content generator, not geometry solver |
| Feb 17 | Overlap score metric over visual QA | Single number for AI layout quality |
| Feb 18 | Multiplayer improv canvas as north star | Nobody has multiplayer + AI + canvas + improv |
| Feb 18 | No Tailwind (yet) | Inline styles manageable with shared components. Revisit if >15 components |
| Feb 18 | Msg age over fake WS latency | DO doesn't echo cursors; measure something honest |
| Feb 19 | `[NEXT-HAT-PROMPT]` marker protocol | Avoids custom WS message types; ChatAgent detects in user text |
| Feb 19 | Client re-sends gameMode on every message | DO hibernation resilience; D1 stores for gallery |
| Feb 19 | String() casts for wrangler literal types | [vars] generate literal types ("false" not string) |
| Feb 19 | Squash merge in merge.sh | GPG agent socket blocked by sandbox; squash commits locally |
| Feb 19 | INSERT then SELECT (not INSERT...RETURNING) for D1 | RETURNING not confirmed in D1; safer to INSERT OR IGNORE + re-SELECT |
| Feb 19 | Spectator-only reaction counting for leaderboard | Players could inflate their own score; spectator reactions are organic signal |
| Feb 19 | userId (not displayName) for current-user highlighting | displayName is mutable + non-unique; userId is stable identity |
| Feb 19 | Mobile early-return pattern in Board | Two layouts share all WS hooks; conditional return before final JSX keeps desktop path unchanged |
| Feb 19 | GLM 4.7 Flash as UI default, not wrangler env | Client always sends model per-message; UI default overrides WORKERS_AI_MODEL env var. Env var is fallback for serverless/director paths that don't receive a body. |

## AI Model Pricing (Workers AI, $0.011/1K neurons)

| Model | Input $/M tok | Output $/M tok | ~$/scene | Tool calling | Notes |
|-------|---------------|----------------|----------|--------------|-------|
| **GLM-4.7-flash** | $0.06 | $0.40 | **$0.02** | Native (no shim needed) | **Current default.** Cheapest input, optimized for multi-turn tool calling. |
| GPT-OSS-20B | $0.20 | $0.30 | $0.04 | Good (agentic tuning) | Cheapest output. OpenAI open model, designed for agentic tasks. |
| Mistral Small 3.1 24B | $0.35 | $0.56 | $0.08 | Broken (needs shim) | Previous default. Ignores tool_choice:auto in streaming. |
| Llama 4 Scout 17B MoE | $0.27 | $0.85 | $0.06 | Supported | Most expensive output. 16 experts, multimodal. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | $0.26 | Excellent | Behind ENABLE_ANTHROPIC_API toggle (default off). |

*Scene estimate: 20 human turns, ~40 LLM calls (chat + reactive), ~200K input + ~12K output tokens total.*

**Decision (Feb 19):** Switched from Mistral to GLM-4.7-flash. Mistral ignored tools despite shim injecting tool_choice:auto (confirmed via logging: 11 tools sent, 0 called). GLM calls tools natively + 6x cheaper input. Shim kept as belt-and-suspenders.

`streamText` with `stopWhen: stepCountIs(5)` limits to 5 LLM round-trips. Daily budget tracked per ChatAgent DO instance ($5/day cap, neurons).
