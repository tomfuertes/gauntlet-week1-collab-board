# @cloudflare/codemode Exploration (YesAInd)

Date: 2026-02-20

## Executive Summary

- **It's "CodeMode", not "codemod."** `@cloudflare/codemode` is an Agents SDK feature that lets LLMs write executable TypeScript to orchestrate tool calls, instead of using standard JSON tool-calling. It is not a migration/refactoring tool.
- **YesAInd is the wrong use case, even accounting for the pipeline.** CodeMode shines with 100s-1000s of tools (e.g. Cloudflare's 2500-endpoint API). We have 16 tools today, reaching ~19 after #20/#22/#23 land. Even speculatively we top out at ~30. The codebase is growing in DO Storage complexity and WS protocol richness, not in LLM tool surface area. `batchExecute` already solves multi-step coordination, and `choreograph` (#20) is correctly designed as declarative input (step array), not imperative orchestration.
- **Our models can't handle it.** GPT-4o Mini and GLM-4.7-Flash already struggle with basic tool calling (see `sanitizeMessages`, `cleanModelOutput`, the `tool_choice` shim). Asking them to write TypeScript would make things worse, not better.

**Recommendation: Anti-recommend adoption. Watch from a distance.**

---

## What CodeMode Actually Is

Strip the marketing: CodeMode converts your AI SDK `tool()` definitions into a TypeScript type definition, gives the LLM a single "write code" tool, and executes the generated code in a sandboxed V8 isolate via the Worker Loader API.

**Standard tool calling:**
```
LLM -> JSON tool call -> system executes -> result -> LLM -> next tool call -> ...
```

**CodeMode:**
```
LLM -> writes TypeScript function -> sandbox executes all tool calls in one pass -> final result -> LLM
```

The pitch: LLMs have seen lots of TypeScript in training data but relatively little synthetic tool-calling syntax. By letting the LLM write code, it can orchestrate complex multi-tool workflows with loops, conditionals, and variable passing - all in a single round-trip.

Sources:
- [Cloudflare blog: Code Mode](https://blog.cloudflare.com/code-mode/)
- [Cloudflare blog: Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/)
- [GitHub: agents/docs/codemode.md](https://github.com/cloudflare/agents/blob/main/docs/codemode.md)

---

## Trajectory: Where the Codebase Is Heading

Before the area-by-area analysis, it's important to map the pipeline. Several changes are in-flight or designed that expand the CF surface area:

**In-flight (being implemented now):**
- #22 Narrative state: DO Storage persistence for character relationships, `storage: DurableObjectStorage` as 4th param to `createSDKTools()`, new **`setRelationship`** AI tool

**Designed, queued:**
- #23 Scene lifecycle: explicit `SceneLifecyclePhase` with DO Storage, new **`advanceScenePhase`** AI tool, `archiveScene()` Board DO RPC
- #20 Anim P3 choreography: `obj:sequence` WS message type, new **`choreograph`** AI tool with step arrays
- #48 AI critic review: async AI review of completed scenes (not an in-scene tool)

**Tool count trajectory:**
| Milestone | Tool count | Notes |
|-----------|-----------|-------|
| Current | 16 | 15 base + batchExecute |
| After #22 | 17 | + setRelationship |
| After #23 | 18 | + advanceScenePhase |
| After #20 | 19 | + choreograph |
| Speculative future | ~25-30 | audio, physics, NPC behavior, etc. |

**Key observation:** The pipeline adds ~3 tools, reaching ~19. This is still 5x below the threshold where CodeMode's token compression becomes meaningful. Even an optimistic "speculative future" of 25-30 tools stays below the inflection point.

**However, tool complexity is increasing faster than tool count.** The `choreograph` tool (#20) takes step arrays with sequential dependencies - "move character A to X, wait 500ms, create text at Y, move character to Z." This is exactly the kind of multi-step orchestration CodeMode is designed for. But it's also the kind of tool that budget models would struggle with even more in code-generation mode (getting the step array schema right in JSON is easier than writing a correct async function with awaited sequential calls).

**The real growth axis is DO Storage patterns, not LLM tools.** #22 threads `DurableObjectStorage` into the tool factory. #23 adds scene lifecycle persistence. These are server-side architectural changes that increase internal complexity but don't change the LLM's tool surface in a way CodeMode addresses. CodeMode operates at the LLM-to-tool boundary; DO Storage patterns are below that boundary.

---

## Area-by-Area Analysis

### 1. Tool Orchestration (CodeMode's primary value prop)

**Current state:** 16 tools in `src/server/ai-tools-sdk.ts`. Pipeline adds 3 more (setRelationship, advanceScenePhase, choreograph) reaching ~19.

**Pain level: Low.** The `batchExecute` tool already solves multi-step coordination. It runs up to 10 operations sequentially, covers "create a scene" use cases, and is dead simple for the LLM to invoke (just an array of `{tool, args}`). The AI typically creates 3-5 objects per turn (`stopWhen: stepCountIs(5)`).

**Choreography nuance (#20):** The `choreograph` tool is the closest thing to a CodeMode use case in our pipeline. It involves sequenced steps with timing dependencies. But the design calls for a single tool with a step-array parameter (declarative), not multi-tool orchestration (imperative). This is the right design: the LLM declares "what" and the server handles "how" - no code generation needed.

**CodeMode fit:** Poor. Even at 19 tools, the token overhead is ~3-4K tokens - well within budget. The headline stat ("81% fewer tokens for a 31-event task") is for orchestrating across 2500 endpoints. Our tool calls are simple CRUD + a few state transitions with no branching logic.

**Verdict: Not applicable.** We're 5x below the tool count where CodeMode becomes interesting, `batchExecute` handles multi-step, and `choreograph` is correctly designed as declarative input.

### 2. Model Compatibility

**Current state:** 8 models across 3 providers (`src/shared/types.ts`). Default: GPT-4o Mini. Workers AI fallback: GLM-4.7-Flash. Premium: Claude Haiku 4.5.

**Pain level: High (but CodeMode makes it worse).** GLM-4.7-Flash already:
- Leaks `<think>` blocks into output (hence `cleanModelOutput()` in `chat-agent.ts:42-58`)
- Emits malformed tool inputs (strings/nulls instead of objects) requiring `sanitizeMessages()` (`chat-agent.ts:67-121`)
- Needs a `tool_choice: "auto"` shim because `workers-ai-provider` drops it (`chat-agent.ts:282-299`)

**CodeMode risk:** If GLM can't reliably emit `{"tool": "createStickyNote", "args": {"text": "hello"}}`, it will absolutely butcher `async () => { const note = await codemode.createStickyNote({text: "hello"}); ... }`. Code generation requires stronger reasoning than structured JSON output. GPT-4o Mini would fare better but still - we'd be adding complexity to handle a capability our cheapest models can't use.

**Verdict: Anti-recommend.** CodeMode is designed for frontier models (GPT-5, Claude Opus). Using it with budget models would increase failure rates.

### 3. Sandboxing and Security

**Current state:** All tool execution is server-side via Board DO RPC stubs. Tools can only interact with the specific board they're bound to. No client-side execution surface.

**Pain level: Zero.** Security model is already tight. Each `createSDKTools()` call is scoped to a single Board DO stub and batchId. The LLM can't escape the board boundary.

**CodeMode addition:** Runs generated code in an isolated Worker via Worker Loader API. Adds defense-in-depth but we have no attack surface that needs it - our tools are pure data mutations, not arbitrary code execution.

**Verdict: Not applicable.** No security gap to fill.

### 4. Observability and Tracing

**Current state:** `src/server/tracing-middleware.ts` wraps models with Langfuse tracing. `instrumentExecute()` in `ai-tools-sdk.ts:209-265` logs per-tool timing, success/failure, and input validation. Tool failures are traced separately via `_traceToolFailures()`. Recently shipped: gameMode/scenePhase/intentChip metadata threading, sanitize repair traces, tool outcome failure traces with Langfuse scores.

**Pipeline trajectory:** Langfuse integration is deepening, not plateauing. The eval harness now feeds Langfuse scores. New tools (#22 setRelationship, #23 advanceScenePhase, #20 choreograph) will each need `instrumentExecute` wrapping and Langfuse trace correlation. Per-tool granularity is becoming more valuable as the system grows, not less.

**Pain level: Low.** Observability is comprehensive and getting richer.

**CodeMode risk:** Would make tool calls opaque. Instead of individual `ai:tool` log events with timing, we'd see a single "code executed" event. The `instrumentExecute` wrapper - now covering 16 tools with structured logging, error returns, and Langfuse score correlation - would become dead code. We'd need to rebuild all per-tool observability inside the sandbox, which isn't straightforward since the sandbox communicates via Workers RPC. This is especially costly given the recent investment in tool failure tracing (`_traceToolFailures`) and sanitize repair tracking.

**Verdict: Anti-recommend.** Adoption would regress observability at exactly the time we're investing in making it richer.

### 5. Infrastructure Complexity

**Current state:** `wrangler.toml` has D1, 2 DOs (Board, ChatAgent), AI binding, observability. Clean and minimal.

**CodeMode requirements:**
- New `worker_loaders` binding in `wrangler.toml`
- `zod-to-ts` dependency bundles the TypeScript compiler - significant bundle size increase
- Known bug: `__filename is not defined` during local dev ([Issue #623](https://github.com/cloudflare/agents/issues/623)) - requires Vite `define` hack
- Worker Loader API is still in closed beta for production
- `@cloudflare/codemode` is experimental (agents SDK 0.5.x)

**Pain level of adoption: High.** Three new moving parts (Worker Loader, zod-to-ts, dynamic isolate spawning) added to an already complex DO architecture. Each tool call would spin up an isolated Worker - latency implications for the real-time improv experience where response speed matters.

**Verdict: Anti-recommend.** Complexity cost far outweighs benefit. Production readiness is questionable.

### 6. Agents SDK Patterns (AIChatAgent)

**Current state:** `ChatAgent` extends `AIChatAgent` from `@cloudflare/ai-chat`. Uses AI SDK's `streamText`/`generateText` with `tool()` definitions. Standard integration pattern.

**CodeMode compatibility:** CodeMode uses `createCodeTool()` which returns a single AI SDK-compatible tool. It could theoretically replace our 15 tools with 1 "write code" tool. But this changes the entire tool execution model:
- `streamText()` with 15 tools -> `streamText()` with 1 tool (code)
- Per-tool Zod validation -> runtime code execution validation
- `batchExecute` becomes redundant (CodeMode IS the batch mechanism)
- `drawScene` tool's proportional coordinate system would need to be reimplemented as a TypeScript library callable from sandbox

**Verdict: Not applicable.** Major refactor for no functional gain.

### 7. Wrangler/D1 Migration Patterns

**Not relevant.** CodeMode is not a codemod/migration tool. There are no automated codemods for migrating CF Workers patterns. Wrangler v4 migration is manual (`wrangler.toml` -> `wrangler.jsonc` can be done by hand; CF discussed but never shipped a codemod for this).

---

## Devil's Advocate: Where the Hype Doesn't Match Reality

### "81% fewer tokens"
This stat is from a 31-event complex task with the Cloudflare API (2500 endpoints). For YesAInd's typical 3-5 object creation per turn, the token savings would be negligible - possibly even negative after including the TypeScript type definitions and sandbox overhead in each request.

### "LLMs are better at writing code than making tool calls"
This is true for GPT-4, Claude Opus, etc. It is NOT true for GLM-4.7-Flash, which struggles to produce valid JSON tool calls. The training data argument cuts both ways - these smaller models have seen less high-quality TypeScript than frontier models.

### "Code Mode reduces round-trips"
YesAInd already caps at 5 steps (`stepCountIs(5)`) for chat, 2 for reactive, 3 for director. The round-trip overhead is bounded. And the `batchExecute` tool already eliminates round-trips for multi-object creation.

### "Secure sandbox execution"
Our tools are pure data mutations on a scoped DO stub. There's nothing to sandbox beyond what the DO boundary already provides. Adding a V8 isolate layer is security theater for this use case.

### "Works with MCP tools"
YesAInd doesn't use MCP. Our tools are local AI SDK tools bound to Board DO stubs. MCP would add unnecessary network hops for same-process tool execution.

### The naming confusion itself is a red flag
The fact that the team confused "codemod" (AST-based code transformation) with "CodeMode" (LLM code execution) suggests the marketing positioning is unclear. If experienced developers can't distinguish what the tool does from its name, adoption friction will be high.

---

## When CodeMode WOULD Make Sense for YesAInd

Given the current pipeline (#20, #22, #23, #48), tool count reaches ~19. Even aggressively speculating (audio, physics, NPC behavior, audience interaction), we'd hit ~30 in 6 months. Revisit if ANY of these conditions become true simultaneously:

1. **Tool count exceeds 40 AND tools have cross-dependencies.** Pure count isn't enough - 40 independent CRUD tools still work fine with standard calling. The trigger is when tools need to chain results with conditional logic that `batchExecute`'s pre-computed args can't express. The `choreograph` tool (#20) is correctly designed as declarative (step array), avoiding this. If future tools can't follow that pattern, CodeMode becomes relevant.
2. **Default model upgrades to frontier tier.** GPT-4o (not Mini), Claude Sonnet 4+, or equivalent. Budget models can't reliably generate TypeScript. The current model mix (GPT-4o Mini default, GLM fallback) rules out CodeMode entirely. Watch for: if we deprecate GLM and move default to a $5+/MTok model.
3. **Worker Loader API exits beta AND agents SDK hits 1.0.** Both are prerequisites. Currently: Worker Loader is closed beta, `@cloudflare/codemode` is experimental. Adopting experimental infra for a real-time collaborative app is reckless.
4. **`batchExecute` hits its ceiling.** If we find ourselves wanting conditional logic between batch steps ("create A, read board, if overlap then move A, else create B"), `batchExecute` can't express this. CodeMode can. But: redesigning `batchExecute` to support result references (e.g., `$ref: "step.0.created"`) would be a simpler, lower-risk solution than adopting CodeMode.

**Most likely scenario:** None of these trigger in 2026. The codebase is growing in DO Storage complexity and WS protocol richness, not in LLM tool surface area. The architectural direction (declarative tool inputs like choreograph's step array) actively avoids the multi-tool orchestration pattern that CodeMode addresses.

---

## Concrete Next Steps

**None for adoption.** But:

1. **Track Worker Loader API GA** - add to task #32 (already tracking workers-ai-provider). When it exits beta, re-evaluate.
2. **Monitor agents SDK 1.0** - `@cloudflare/codemode` is experimental. Wait for stable release before any integration work.
3. **If tool count grows past 30**, prototype CodeMode with Claude Haiku (our most capable model) on a branch. Measure: token usage, latency, tool call success rate vs current approach. Don't commit until numbers prove it out.

---

## References

- [Cloudflare Blog: Code Mode](https://blog.cloudflare.com/code-mode/)
- [Cloudflare Blog: Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/)
- [GitHub: agents/docs/codemode.md](https://github.com/cloudflare/agents/blob/main/docs/codemode.md)
- [GitHub Issue #623: __filename not defined](https://github.com/cloudflare/agents/issues/623)
- [WorkOS: Token savings analysis](https://workos.com/blog/cloudflare-code-mode-cuts-token-usage-by-81)
- [Matt Collins: First impressions](https://www.mattcollins.net/2025/11/first-impressions-of-cloudflares-code-mode)
