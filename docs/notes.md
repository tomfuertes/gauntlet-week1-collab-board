# Notes

*Internal project management scratch. Not a deliverable.*

## Loose Ends

- **Remote D1 migrations 0004-0006 pending** - `npx wrangler login` then `npm run migrate:remote`
- **UAT incomplete** - game modes, token budgets, custom AI characters, daily challenges. All tsc-clean, need browser verification.
- **GLM-4.7-flash unverified in prod** - needs manual chat test confirming tool calls work
- **CF issue** - [cloudflare/ai#404](https://github.com/cloudflare/ai/issues/404): `workers-ai-provider` drops `tool_choice`. Open.
- **Upgrade `@cloudflare/ai-chat`** - v0.1.2 -> latest (rewritten in Agents SDK v0.5.0: data parts, persistent tool approvals, `maxPersistedMessages`). Fixes "no upper bound on AI chat history" tech debt.
- **Run prompt-eval harness** - `npx tsx scripts/prompt-eval.ts` against dev server. Tune LAYOUT RULES based on overlap scores.

## Roadmap

### Shipped (grouped)

**Core canvas:** Infinite canvas, shapes (sticky/rect/circle/line/connector/text/frame/image), move/resize/rotate, multi-select, copy/paste/dup, undo/redo, delete, cursor sync, presence, keyboard shortcuts, context menu, color picker, floating toolbar.

**AI agent:** 12 tools (Zod schemas, DRY helpers), chat panel (chips, templates, typing, server-side history), selection-aware AI, AI object glow/confetti, batch undo, AI presence (cursor dot, bar), board generation (overlay + suggestion chips), AI image generation (SDXL), defensive tool validation, batchExecute meta-tool (N round trips -> 1 for scene setup), quality telemetry (`ai:quality` events), prompt eval harness.

**Multiplayer improv:** Multi-agent personas (SPARK + SAGE defaults, custom AI characters with CRUD API + modal UI, autonomous "yes, and", 3-exchange cooldown), AI Director (scene phases, 60s inactivity nudge, DO schedule alarms), dynamic intent chips, improv game modes (Scenes From a Hat, Yes-And Chain), per-scene token budgets (20-turn, 4 dramatic arc phases).

**Sharing/discovery:** Scene playback (event recording, public replay, ReplayViewer), scene gallery (public grid, gradient thumbnails), spectator mode (#watch, emoji reactions, spectator count), async notifications (unread badges), daily scene challenges + leaderboard (pending remote migration).

**Infra/DX:** Custom auth (PBKDF2, D1 sessions), hash routing, onboard modal, connection toasts, perf overlay (always-on, Shift+P toggle), AI architecture audit (prompt versioning, structured logging, quality telemetry), vendor chunk splitting, Board.tsx decomposition, code cleanup sprint (16 items), AI model upgrade (GLM-4.7-flash default, runtime model selector dropdown, $5/day cap, Anthropic toggle), tool_choice shim (belt-and-suspenders for Workers AI models).

**Killed:** Contextual AI Actions (clustering unreliable), Intent Preview (overlap with batch undo at 3x cost).

## Open Tech Debt

### Security
- No rate limiting on auth + AI endpoints
- AI route accepts arbitrary boardId - can create phantom DOs
- No upper bound on AI chat history (fix: upgrade `@cloudflare/ai-chat`, use `maxPersistedMessages`)
- Username enumeration via signup 409

### Architecture
- ChatAgent error handling loose - tool failures logged but swallowed, LLM unaware of partial success

### UX/Polish
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close code handling
- No guard against sendMessage when ChatAgent WS disconnected

## Exploration: CF Agent Patterns

*Deep dives in `docs/exploration-*.md`. Batch tool shipped; others for reference.*

| Pattern | Status | Deep dive |
|---------|--------|-----------|
| Code Mode | Watch for Worker Loader API GA | [exploration-code-mode.md](exploration-code-mode.md) |
| Agent state sync | Skip (our LWW is simpler) | [exploration-state-sync.md](exploration-state-sync.md) |
| Task queues | Low priority (waitUntil is fine) | [exploration-task-queues.md](exploration-task-queues.md) |
| Tool approval gates | Nice-to-have for deleteObject | [exploration-tool-approval.md](exploration-tool-approval.md) |
| Evaluator-Optimizer | Interesting for layout quality | [exploration-evaluator-optimizer.md](exploration-evaluator-optimizer.md) |
| Batch tool | **Shipped** as tool #12 | [exploration-batch-tool.md](exploration-batch-tool.md) |

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 19 | GLM-4.7-flash over Mistral Small 3.1 | Mistral ignores tool_choice:auto in streaming. GLM native tool calling + 6x cheaper. |
| Feb 19 | Contradictory LLM prompt rules: earlier rules dominate | "call ALL creates in SINGLE response" overrode "prefer batchExecute". Fix: name batchExecute in the first rule. |
| Feb 18 | Multiplayer improv canvas as north star | Nobody has multiplayer + AI + canvas + improv |
| Feb 17 | Template coord injection over LLM geometry | LLM as content generator, not geometry solver |
| Feb 17 | Overlap score metric over visual QA | Single number for AI layout quality |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is differentiator |

## AI Model Pricing (Workers AI, $0.011/1K neurons)

| Model | Input $/M tok | Output $/M tok | ~$/scene | Tool calling | Notes |
|-------|---------------|----------------|----------|--------------|-------|
| **GLM-4.7-flash** | $0.06 | $0.40 | **$0.02** | Native (no shim needed) | **Current default.** Cheapest input. |
| GPT-OSS-20B | $0.20 | $0.30 | $0.04 | Good (agentic tuning) | Cheapest output. |
| Mistral Small 3.1 24B | $0.35 | $0.56 | $0.08 | Broken (needs shim) | Previous default. |
| Llama 4 Scout 17B MoE | $0.27 | $0.85 | $0.06 | Supported | Most expensive output. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | $0.26 | Excellent | Behind ENABLE_ANTHROPIC_API toggle. |

*Scene estimate: ~200K input + ~12K output tokens per 20-turn scene. `stopWhen: stepCountIs(5)` caps round-trips. $5/day budget per DO.*
