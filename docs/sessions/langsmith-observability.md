# LangSmith + LangChain Observability: Research & Decision

*Research session: 2026-02-19 | Branch: feat/langsmith-observability*

---

## Context

**Goal:** Add observability into AI prompts, tool execution, and model behavior. Current state is `console.debug(JSON.stringify({...}))` structured logs only - no prompt tracing, no tool call inspection, no queryable trace history.

**Stack:** Vercel AI SDK v6 (`streamText`, `generateText`) + Cloudflare Agents SDK (`AIChatAgent` DO) + Workers AI (GLM-4.7-flash default) + Hono + D1.

**Key hooks already in code:**
- `wrappedOnFinish` in `chat-agent.ts:503` - receives full `steps[]` with all tool calls/results
- `_logRequestStart/End` at `chat-agent.ts:232/246` - structured JSON logs (timing, counts)
- `ai:quality` telemetry event (overlap scoring) already wired
- `[observability] enabled = true` in wrangler.toml (CF native invocation logs)

**What's missing:**
- Full system prompt capture (changes per persona, game mode, budget phase)
- Tool call args and results (for "why did AI create this object?")
- Queryable trace history across sessions

---

## Research Findings

### 1. LangSmith + Vercel AI SDK v6 Compatibility

**Official support exists.** Two integration patterns documented:

**Pattern A - `wrapAISDK` (current recommended):**
```ts
import { wrapAISDK } from "langsmith/experimental/vercel";
const { streamText, generateText } = wrapAISDK({ client });
// drop-in replacement - same API surface
```
Wraps the SDK functions (not the model). Intercepts at `doGenerate`/`doStream` level. Captures tool calls in LLM response but **not tool result values** in UI (open issue langchain-ai/langsmith-sdk#1603).

**Pattern B - `wrapAISDKModel` (deprecated):**
```ts
import { wrapAISDKModel } from "langsmith/wrappers/vercel";
streamText({ model: wrapAISDKModel(myModel), ... })
```
Wraps the model object. Deprecated in favor of Pattern A.

**`awaitPendingTraceBatches()` is mandatory** in serverless - without it, the isolate dies before traces flush:
```ts
await client.awaitPendingTraceBatches(); // call after response is returned
```

**Known bugs in `langsmith` npm wrapper:**
- Stream abort causes uncaught exceptions (#2023)
- Token counts not rendered in UI (#999)
- Tool call raw results not surfaced in trace UI (#1603)

---

### 2. Cloudflare Workers V8 Isolate Constraints

**RESOLVED: `nodejs_compat` is already on in wrangler.toml** (`compatibility_flags = ["nodejs_compat"]`).

This is the critical pre-condition. The main concerns are:

| Concern | Status | Notes |
|---------|--------|-------|
| `nodejs_compat` required | ✅ Already on | `compatibility_flags = ["nodejs_compat"]` |
| LangSmith npm package CF compat | ⚠️ Unverified | No confirmed production case for Workers; reads `process.env` (polyfilled), uses fetch internally but untested |
| `@opentelemetry/sdk-node` | ❌ Blocked | Uses `fs`, `path`, `http` - not available in Workers even with `nodejs_compat` |
| `@opentelemetry/sdk-trace-base` | ✅ Works | Fetch-based; works in Workers with `nodejs_compat` |
| `@microlabs/otel-cf-workers` | ✅ Designed for Workers | OTLP/HTTP JSON, no gRPC, no Node.js sys APIs. 15K weekly DLs. Supports `instrumentDO()`. |
| External HTTP (to LangSmith) | ✅ Works | CF Workers allow outbound fetch to any host |

**Key risk with `AIChatAgent` DO:** `instrumentDO()` from `@microlabs/otel-cf-workers` creates a class proxy. Because `ChatAgent` extends `AIChatAgent` (which handles its own WebSocket routing), the proxy may interfere. **Untested combination.** Safer to configure a TracerProvider at module scope instead.

---

### 3. Vercel AI SDK v6 Built-in Telemetry

**`experimental_telemetry` option** (works on `streamText`, `generateText`, `generateObject`, `streamObject`):

```ts
const result = streamText({
  model,
  system: systemPrompt,
  messages,
  tools,
  experimental_telemetry: {
    isEnabled: true,
    functionId: "chat-agent",          // groups spans; resource.name in OTel
    recordInputs: true,                // captures system + messages + tools (default true)
    recordOutputs: true,               // captures text + toolCalls (default true)
    metadata: {
      boardId: this.name,
      model: this._getModelName(),
      promptVersion: PROMPT_VERSION,
      trigger: "chat",
    },
  },
});
```

**OTel spans created automatically:**
- `ai.streamText` - top-level span (whole call incl. all steps)
- `ai.streamText.doStream` - per LLM call (one per step)
- `ai.toolCall` - one per tool invocation

**Span attributes captured (when `recordInputs/Outputs: true`):**
- `ai.prompt.messages` - full messages array as JSON (incl. system prompt)
- `ai.prompt.tools` - tool definitions
- `ai.response.toolCalls` - tool call args
- `ai.usage.inputTokens` / `ai.usage.outputTokens`
- `ai.response.text`, `ai.response.finishReason`
- `ai.telemetry.functionId`, `ai.model.id`, `ai.model.provider`

**Note: system prompt IS captured** in `ai.prompt.messages` (as the first system-role message). This is the only way to get the constructed system prompt (persona + game mode + budget phase) in a trace without keeping a manual reference.

**`wrapLanguageModel` middleware (AI SDK v6 stable API):**

```ts
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';

const tracingMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate, params }) => {
    // params.prompt = messages array (system is first element)
    // params.tools = tool definitions
    const result = await doGenerate();
    // result.content = text + tool calls
    // result.usage = { inputTokens, outputTokens }
    // result.response.body = raw HTTP response
    return result;
  },
  wrapStream: async ({ doStream, params }) => {
    // Same params access, streaming result
    return doStream();
  },
};

const wrappedModel = wrapLanguageModel({
  model: this._getModel(),
  middleware: tracingMiddleware,
});
```

This middleware gives access to `params` (including system prompt and full message history) **before** the model call, and the complete result **after**. This is the cleanest way to capture the full trace without external deps.

---

### 4. LangSmith OTLP Endpoint (2024 addition)

LangSmith now accepts OTLP traces directly:
- Endpoint: `https://api.smith.langchain.com/otel/v1/traces`
- Headers: `x-api-key: <LANGSMITH_API_KEY>`, `Langsmith-Project: collabboard`

This means the `langsmith` npm package is **not required** to send traces to LangSmith. Any OTLP-compliant exporter can send to LangSmith. The `ai.*` spans from `experimental_telemetry` are OTel-standard and will appear in the LangSmith trace UI.

---

## Architectural Options

### Option A: `wrapAISDK` from `langsmith` npm

**How:** Install `langsmith`, wrap `streamText`/`generateText` globally with `wrapAISDK({ client })`, call `awaitPendingTraceBatches()` after each response.

**Pros:**
- Best LangSmith UI experience (native trace nesting, eval workflows)
- Minimal call-site changes (wraps the functions, not call sites)
- Captures tool calls (partially - results not shown in UI per #1603)

**Cons:**
- ⚠️ **CF Workers compatibility unverified** - no confirmed production report for this exact stack
- Known bugs: stream abort crashes (#2023), token UI gaps (#999), tool results not shown (#1603)
- Adds `langsmith` bundle (~1.1MB packed) - check against 10MB Worker limit
- `awaitPendingTraceBatches()` call needs to be hooked correctly (after response, before isolate dies)
- Package actively evolving - API changes between versions

**Verdict:** High potential, but unverified in production for CF Workers. Bug list is concerning for a $5/day budget scenario where every call matters.

---

### Option B: OTel via `@microlabs/otel-cf-workers` → LangSmith OTLP

**How:** Install `@microlabs/otel-cf-workers` + `@opentelemetry/api`. Configure TracerProvider at module scope pointing to LangSmith OTLP endpoint. Add `experimental_telemetry: { isEnabled: true, ... }` to each `streamText`/`generateText` call.

```ts
// chat-agent.ts top of file (module scope, runs once)
import { NodeSDK } from "@opentelemetry/sdk-node"; // NO - blocked in Workers
// Instead, use @opentelemetry/sdk-trace-base:
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Called once when the module initializes (DO class definition)
// NOTE: env not available at module scope in DOs - needs lazy init
```

**Problem:** DOs don't have `env` at module scope, so the API key can't be injected at TracerProvider init time. Needs lazy initialization on first request, which complicates the singleton pattern.

**Alternative:** Use `@microlabs/otel-cf-workers`'s `instrumentDO()`:
```ts
// src/server/index.ts
export const ChatAgent = instrumentDO(RawChatAgent, (env) => ({
  exporter: {
    url: "https://api.smith.langchain.com/otel/v1/traces",
    headers: { "x-api-key": env.LANGSMITH_API_KEY, "Langsmith-Project": "collabboard" },
  },
  service: { name: "collabboard-chat" },
}));
```

But `instrumentDO` + `AIChatAgent` base class interaction is **untested** - may interfere with WebSocket handling.

**Pros:**
- `nodejs_compat` already on → OTel libraries work
- Zero `langsmith` npm bundle in Worker
- `experimental_telemetry` is stable Vercel AI SDK v6 API
- Full span capture: system prompt, messages, tools, tool calls, usage
- LangSmith OTLP endpoint = traces appear in LangSmith UI without their SDK

**Cons:**
- `instrumentDO` + `AIChatAgent` compatibility unverified
- Lazy TracerProvider init pattern needed for env-bound API key
- Two new packages vs. zero for Option C

**Verdict:** Architecturally correct but has an untested integration seam with `AIChatAgent`.

---

### Option C: `wrapLanguageModel` Middleware → D1 Trace Log

**How:** Use AI SDK v6's stable `wrapLanguageModel` + `LanguageModelMiddleware` to intercept all model calls. Log full traces (system prompt, messages, tool calls, results, usage, latency) as JSON rows in D1. Zero external deps, zero external HTTP calls.

```ts
// src/server/tracing-middleware.ts (new file, ~80 lines)
import { type LanguageModelMiddleware } from 'ai';
import type { D1Database } from '@cloudflare/workers-types';

export function createTracingMiddleware(db: D1Database, boardId: string): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, params }) => {
      const startMs = Date.now();
      const systemMsg = params.prompt.find(m => m.role === 'system');
      try {
        const result = await doGenerate();
        await db.prepare(
          `INSERT INTO ai_traces (board_id, ts, duration_ms, input_tokens, output_tokens,
           system_prompt, tool_calls, finish_reason) VALUES (?,?,?,?,?,?,?,?)`
        ).bind(
          boardId, Date.now(), Date.now() - startMs,
          result.usage?.inputTokens ?? 0,
          result.usage?.outputTokens ?? 0,
          systemMsg?.content ?? '',
          JSON.stringify(result.content.filter(c => c.type === 'tool-call')),
          result.finishReason,
        ).run();
        return result;
      } catch (err) {
        // Log error trace row, re-throw
        await db.prepare(
          `INSERT INTO ai_traces (board_id, ts, duration_ms, error) VALUES (?,?,?,?)`
        ).bind(boardId, Date.now(), Date.now() - startMs, String(err)).run();
        throw err;
      }
    },
    // wrapStream: similar pattern using stream consumer
  };
}

// In chat-agent.ts _getModel():
import { wrapLanguageModel } from 'ai';
// ...
const model = wrapLanguageModel({
  model: this._getRawModel(),
  middleware: createTracingMiddleware(this.env.DB, this.name),
});
```

**D1 migration needed:**
```sql
CREATE TABLE ai_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  trigger TEXT,       -- 'chat' | 'reactive' | 'director'
  persona TEXT,
  model TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  system_prompt TEXT,
  messages TEXT,      -- JSON array
  tool_calls TEXT,    -- JSON array
  finish_reason TEXT,
  error TEXT
);
CREATE INDEX ai_traces_board_id ON ai_traces(board_id, ts);
```

**Pros:**
- ✅ Zero new npm deps (uses `wrapLanguageModel` from already-installed `ai@6`)
- ✅ Zero external HTTP calls per trace (no latency, no flakiness)
- ✅ Full system prompt captured via `params.prompt`
- ✅ Full tool calls captured in `result.content`
- ✅ Works perfectly in CF Workers DOs - no AIChatAgent conflicts
- ✅ Queryable via D1 SQL (or exported to any tool)
- ✅ Privacy-preserving (data stays in your D1, never sent to third party)
- ✅ No API key management for tracing service

**Cons:**
- No LangSmith UI (eval workflows, prompt comparison, playground)
- D1 row growth needs pruning (e.g., keep 30 days by `ts`)
- `wrapStream` intercepting streaming is more complex (need to tap the ReadableStream)

**Verdict:** Highest confidence implementation. Works today with zero unknowns. Adds the most debugging value per line of code. Can always add LangSmith export later.

---

## Recommendation

**Implement Option C (D1 middleware) now. Option B (OTel → LangSmith) if/when LangSmith UI value is needed.**

**Rationale:**

1. **CF Workers + AIChatAgent = unverified for all third-party observability solutions.** Neither `wrapAISDK` (Option A) nor `instrumentDO` + OTel (Option B) has a confirmed production deployment with `AIChatAgent` as the base class. The custom middleware (Option C) sidesteps both untested integration seams.

2. **`wrapLanguageModel` is already in `ai@6.0.91`** - the dep is installed. Adding the tracing middleware is a ~80-line addition with no new packages.

3. **D1 is already in stack.** No new infrastructure. Query traces with `wrangler d1 execute` or the prompt-eval harness already in the repo.

4. **Primary debugging need = prompt tuning.** The prompt-eval harness (`scripts/prompt-eval.ts`) already exists for layout scoring. The missing piece is "what exact system prompt did GLM-4.7-flash receive for this session?" - D1 traces answer this directly.

5. **LangSmith adds account management overhead and privacy risk** for a solo dev project at $5/day. The trace data includes full system prompts (persona identity, improv content) which is sensitive to send to a third party.

**When to revisit Option B:**
- Multi-dev collaboration where a shared LangSmith project makes sense
- Need for LangSmith's eval workflows (A/B prompt comparison, automated graders)
- If the prompt-eval harness outgrows D1-based querying

---

## Implementation Plan (Option C)

### Files to create
- `src/server/tracing-middleware.ts` - `LanguageModelMiddleware` impl (~80 lines)
- `migrations/0006_ai_traces.sql` - D1 schema

### Files to modify
- `src/server/chat-agent.ts` - `_getModel()` wraps with middleware; pass `db` and `boardId`
  - **Change is localized to `_getModel()`** - no other call sites change
- `CLAUDE.md` - add tracing middleware to Architecture section

### Prototype: `_getModel()` modification

```ts
// BEFORE
private _getModel() {
  if (this._useAnthropic()) { ... }
  // ... workers AI setup
  return (createWorkersAI({...}) as any)(modelId);
}

// AFTER
private _getModel() {
  if (this._useAnthropic()) {
    const model = createAnthropic(...)('claude-haiku-4-5-20251001');
    return wrapLanguageModel({ model, middleware: this._getTracingMiddleware() });
  }
  // ... workers AI setup (unchanged)
  const baseModel = (createWorkersAI({...}) as any)(modelId);
  return wrapLanguageModel({ model: baseModel, middleware: this._getTracingMiddleware() });
}

private _getTracingMiddleware(): LanguageModelMiddleware {
  return createTracingMiddleware(this.env.DB, this.name, {
    model: this._getModelName(),
    promptVersion: PROMPT_VERSION,
  });
}
```

### Implementation notes

- `wrapStream` interception requires tapping the `ReadableStream` - use `TransformStream` to observe chunks without breaking the stream. The system prompt and message history come from `params.prompt` (captured before the call), so streaming result details are optional.
- D1 writes are fire-and-forget (`ctx.waitUntil`-style) - log errors but never let D1 failures block the AI response.
- Row size: system prompt ~2KB + messages ~4KB + tool calls ~1KB = ~7KB per trace. At 20 turns/scene × N scenes/day, D1 storage is not a concern.
- Prune with: `DELETE FROM ai_traces WHERE ts < unixepoch('now', '-30 days') * 1000`

### Query examples (once implemented)

```sql
-- All traces for a board in the last hour
SELECT ts, trigger, persona, duration_ms, input_tokens, output_tokens, finish_reason
FROM ai_traces WHERE board_id = '<id>' ORDER BY ts DESC LIMIT 20;

-- Tool call frequency
SELECT json_each.value->>'toolName' as tool, count(*) as calls
FROM ai_traces, json_each(tool_calls) GROUP BY tool ORDER BY calls DESC;

-- Traces with errors
SELECT board_id, ts, error FROM ai_traces WHERE error IS NOT NULL ORDER BY ts DESC;

-- System prompt evolution by promptVersion
SELECT DISTINCT system_prompt FROM ai_traces WHERE board_id = '<id>' ORDER BY ts;
```

---

## Decision: Proceed with Option C

**Implementation is 2-3 hours:**
1. D1 migration (0006_ai_traces.sql) - 30 min
2. `tracing-middleware.ts` - 60 min (includes `wrapStream` tapping)
3. `chat-agent.ts` `_getModel()` modification - 30 min
4. CLAUDE.md update + UAT (verify traces appear in D1 for a chat session) - 30 min

**Defer to orchestrator:** Option B evaluation. If/when LangSmith UI is needed, the D1 approach can be extended to also POST to LangSmith REST API from the middleware `wrapGenerate` - same trace data, no `langsmith` npm package required (REST POST to `https://api.smith.langchain.com/otel/v1/traces`).
