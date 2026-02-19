# Notes

*Internal project management scratch. Not a deliverable.*

## Loose Ends

- **UAT backlog** - all features are code-shipped but browser-unverified. Needs two-browser smoke test:
  1. AI tool calls / batchExecute - "Create a yellow sticky" should produce a board object with glow
  2. Daily challenges - challenge card in BoardList, accept flow, leaderboard, spectator reactions increment score
  3. Game modes - hat prompt card + "Next prompt" advances, yes-and beat counter, gallery badges
  4. Token budgets - Act 3/Finale badges visible, "New Scene" button at scene-over phase
  5. Custom AI characters - create persona, see it respond with correct name/color, delete reverts to defaults
  6. Mobile chat - resize browser to <768px, chat becomes primary, canvas preview strip at top, tap to expand
- **AI canvas cursor animation** - Shipped (feat/ai-cursor branch). Purple dot animates to each AI creation point, fades in/out, lerps at 0.12 factor. UAT verified.
- **GLM-4.7-flash unverified in prod** - needs manual chat test confirming tool calls work end-to-end
- **CF issue** - [cloudflare/ai#404](https://github.com/cloudflare/ai/issues/404): `workers-ai-provider` drops `tool_choice`. Open. `tool_choice: "auto"` shim added as belt-and-suspenders.
- **Upgrade `@cloudflare/ai-chat`** - already on v0.1.2 + agents@0.5.0 (latest). Enable `maxPersistedMessages` to cap SQLite storage. Explore persistent tool approvals for deleteObject.
- **Run prompt-eval harness** - `npx tsx scripts/prompt-eval.ts` against dev server. Tune LAYOUT RULES based on overlap/inBounds scores.

## Next / Unshipped Features

| Feature | Priority | Notes |
|---------|----------|-------|
| AI canvas cursor presence | **Shipped** | Purple dot (#a855f7) animates to each AI creation point with lerp + Konva Tween fade. `AiCursor.tsx` + `useAiObjectEffects.ts`. |
| Narrative/relationship state | Medium | Who-hates-whom graph, structural multi-agent memory. Architectural - needs opus worktree. |

## Roadmap

### Shipped (grouped)

**Core canvas:** Infinite canvas, shapes (sticky/rect/circle/line/connector/text/frame/image), move/resize/rotate, multi-select, copy/paste/dup, undo/redo, delete, cursor sync, presence, keyboard shortcuts, context menu, color picker, floating toolbar.

**AI agent:** 12 tools (Zod schemas, DRY helpers), chat panel (chips, templates, typing, server-side history), selection-aware AI, AI object glow/confetti, batch undo, AI presence (cursor dot, bar), board generation (overlay + suggestion chips), AI image generation (SDXL), defensive tool validation, batchExecute meta-tool (N round trips -> 1 for scene setup), quality telemetry (`ai:quality` events), prompt eval harness.

**Multiplayer improv:** Multi-agent personas (SPARK + SAGE defaults, custom AI characters with CRUD API + modal UI, autonomous "yes, and", 3-exchange cooldown), AI Director (scene phases, 60s inactivity nudge, DO schedule alarms), dynamic intent chips, improv game modes (Scenes From a Hat, Yes-And Chain), per-scene token budgets (20-turn, 4 dramatic arc phases). **Persona chat quality fixes** (f5cccb1): empty-bubble suppression, global prefix strip, reactive context injection, CHARACTER COMPOSITION + structured SCENE SETUP prompt, PROMPT_VERSION v5.

**Sharing/discovery:** Scene playback (event recording, public replay, ReplayViewer), scene gallery (public grid, gradient thumbnails), spectator mode (#watch, emoji reactions, spectator count), async notifications (unread badges), daily scene challenges + leaderboard.

**Infra/DX:** Custom auth (PBKDF2, D1 sessions), hash routing, onboard modal, connection toasts, perf overlay (always-on, Shift+P toggle), AI architecture audit (prompt versioning, structured logging, quality telemetry), vendor chunk splitting, Board.tsx decomposition, code cleanup sprint (16 items), AI model upgrade (GLM-4.7-flash default, runtime model selector dropdown, $5/day cap, Anthropic toggle), tool_choice shim (belt-and-suspenders for Workers AI models).

**Killed:** Contextual AI Actions (clustering unreliable), Intent Preview (overlap with batch undo at 3x cost).

## Open Tech Debt

### Security
- Rate limiting shipped (feat/rate-limit): auth login 10/min + signup 5/min (IP-based, 429+Retry-After); AI chat 30 msg/min per user (WS error message). In-memory per isolate/DO - acceptable first pass.
- AI route accepts arbitrary boardId - can create phantom DOs
- No upper bound on AI chat history (fix: `maxPersistedMessages` in agents@0.5.0)
- Username enumeration via signup 409

### Architecture
- ChatAgent error handling loose - tool failures logged but swallowed, LLM unaware of partial success
- Reactive first-exchange timing gap: `_triggerReactivePersona` (via `ctx.waitUntil`) runs before AIChatAgent base class adds the new assistant message to `this.messages`, so the first reactive call always skips with `no-assistant-message`. SAGE reliably triggers on the 2nd+ exchange. Low priority - no fix needed, just a known quirk.
- GLM 4.7 Flash reactive latency: second concurrent `generateText` call takes 30-40s on GLM (cold path, no streaming). UAT must wait 45-60s or send a follow-up message before testing reactive.

### UX/Polish
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close code handling
- No guard against sendMessage when ChatAgent WS disconnected

## CF Agent Patterns (exploration summary)

*From CF Agents docs, Code Mode blog, patterns docs. Full writeups removed - see git history.*

| Pattern | Status | Notes |
|---------|--------|-------|
| Code Mode | Watch for GA | LLM writes TS calling tools as APIs in V8 isolate. Worker Loader API in closed beta. Would be transformative for multi-tool scenes. |
| Agent state sync | Skip | `setState()` auto-persists + broadcasts. Our per-object LWW + optimistic updates is simpler for canvas. |
| Task queues | Low priority | `this.queue()` with auto-retry. Our `ctx.waitUntil()` is fine for best-effort reactive persona + activity recording. |
| Tool approval gates | Nice-to-have | `needsApproval` on tools. Could gate deleteObject behind user confirmation. Now first-class in agents@0.5.0. |
| Evaluator-Optimizer | Interesting | Generate -> evaluate -> loop. Could check layout overlap after scene setup. Prompt-eval harness is the offline version. |
| Batch tool | **Shipped** | Tool #12 batchExecute. N round trips -> 1. GLM uses it unprompted. |

## Key Decisions

Decisions now live as `// KEY-DECISION <date>: <rationale>` comments in source code at the exact location.
Search: `grep -r "KEY-DECISION" src/` or `git log --all --grep="KEY-DECISION"`.

Historical decisions (pre-migration, for reference):
- Feb 18: Multiplayer improv canvas as north star - nobody has multiplayer + AI + canvas + improv
- Feb 17: Template coord injection over LLM geometry - LLM as content generator, not geometry solver
- Feb 17: Overlap score metric over visual QA - single number for AI layout quality
- Feb 16: AI priority over more shapes - Gauntlet AI exercise, AI is differentiator
- Feb 19: GLM-4.7-flash over Mistral Small 3.1 - Mistral ignores tool_choice:auto in streaming, GLM native + 6x cheaper
- Feb 19: Killed Contextual AI Actions - clustering via LLM unreliable
- Feb 19: Killed Intent Preview - 3x cost vs batch undo, improv wants immediacy

## AI Model Pricing (Workers AI, $0.011/1K neurons)

| Model | Input $/M tok | Output $/M tok | ~$/scene | Tool calling | Notes |
|-------|---------------|----------------|----------|--------------|-------|
| **GLM-4.7-flash** | $0.06 | $0.40 | **$0.02** | Native (no shim needed) | **Current default.** Cheapest input. |
| GPT-OSS-20B | $0.20 | $0.30 | $0.04 | Good (agentic tuning) | Cheapest output. |
| Mistral Small 3.1 24B | $0.35 | $0.56 | $0.08 | Broken (needs shim) | Previous default. |
| Llama 4 Scout 17B MoE | $0.27 | $0.85 | $0.06 | Supported | Most expensive output. |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | $0.26 | Excellent | Behind ENABLE_ANTHROPIC_API toggle. |

*Scene estimate: ~200K input + ~12K output tokens per 20-turn scene. `stopWhen: stepCountIs(5)` caps round-trips. $5/day budget per DO.*

## Archived Docs (in git history)

| File | Contents | Removed |
|------|----------|---------|
| `docs/ai-architecture.md` | AI request lifecycle diagram | pre-session |
| `docs/ai-cost-analysis.md` | Token cost estimates | pre-session |
| `docs/ai-dev-log.md` | AI development session log | pre-session |
| `docs/social-post.md` | Social media draft | pre-session |
| `docs/thurs-am.md` | Thu AM pickup: what shipped, ai-tools-fix in-progress, UAT backlog (6 items), unshipped roadmap | Feb 19 |
| `docs/tomorrow.md` | Sprint plan for 5 features: AI cursor (partial), contextual actions (killed), batch undo (shipped), intent preview (killed), board generation (shipped) | Feb 19 |
| `docs/ux-intents-exploration.md` | Dynamic intent chip design (shipped) | Feb 19 |
| `docs/exploration-code-mode.md` | CF Code Mode deep dive | Feb 19 |
| `docs/exploration-state-sync.md` | Agent SDK state sync analysis | Feb 19 |
| `docs/exploration-task-queues.md` | Task queues vs ctx.waitUntil | Feb 19 |
| `docs/exploration-tool-approval.md` | Tool approval gates pattern | Feb 19 |
| `docs/exploration-evaluator-optimizer.md` | Evaluator-optimizer loop pattern | Feb 19 |
| `docs/exploration-batch-tool.md` | Batch tool design (shipped as tool #12) | Feb 19 |
| `follow-ups.md` (root) | 16-item code cleanup sprint (all shipped) + feature priority list | Feb 19 |
