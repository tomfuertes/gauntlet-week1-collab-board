import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { Langfuse } from "langfuse";

export { wrapLanguageModel, Langfuse };

interface TraceContext {
  boardId: string;
  trigger: string;
  persona: string;
  model: string;
  promptVersion: string;
}

/** Extract the system prompt string from a prompt messages array.
 *  In AI SDK v6, the system is always the first message with role === 'system'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSystemPrompt(prompt: any[]): string {
  const sys = prompt.find((m) => m.role === "system");
  if (!sys) return "";
  return typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content);
}

/** Write a trace row to D1. Fire-and-forget safe - logs errors internally, never throws. */
async function writeD1Trace(
  db: D1Database,
  ctx: TraceContext & {
    ts: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    systemPrompt: string;
    messageCount: number;
    toolCallsJson: string;
    finishReason: string;
    error?: string;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO ai_traces
         (board_id, ts, trigger, persona, model, prompt_version,
          duration_ms, input_tokens, output_tokens, system_prompt,
          message_count, tool_calls_json, finish_reason, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ctx.boardId,
        ctx.ts,
        ctx.trigger,
        ctx.persona,
        ctx.model,
        ctx.promptVersion,
        ctx.durationMs,
        ctx.inputTokens,
        ctx.outputTokens,
        ctx.systemPrompt,
        ctx.messageCount,
        ctx.toolCallsJson,
        ctx.finishReason,
        ctx.error ?? null,
      )
      .run();
  } catch (err) {
    // Never let trace writes surface to callers - observability must not affect reliability
    console.error(JSON.stringify({ event: "trace:d1-error", boardId: ctx.boardId, error: String(err) }));
  }
}

/** Create a Langfuse generation span and end it with results.
 *  Requires langfuse to be initialized (non-null). Fire-and-forget safe. */
function recordLangfuseGeneration(
  lf: Langfuse,
  ctx: TraceContext & {
    startTime: Date;
    systemPrompt: string;
    inputTokens: number;
    outputTokens: number;
    toolCallsJson: string;
    finishReason: string;
    error?: string;
  },
): void {
  try {
    const trace = lf.trace({
      name: ctx.trigger,
      metadata: { boardId: ctx.boardId, promptVersion: ctx.promptVersion },
      tags: [ctx.trigger, ctx.model, `persona:${ctx.persona}`],
    });
    const generation = trace.generation({
      name: `${ctx.trigger}:${ctx.persona}`,
      model: ctx.model,
      startTime: ctx.startTime,
      // Truncate system prompt for display - full version is in D1
      input: ctx.systemPrompt.slice(0, 4000),
      metadata: { promptVersion: ctx.promptVersion, boardId: ctx.boardId },
    });
    const toolCalls = (() => {
      try {
        return JSON.parse(ctx.toolCallsJson);
      } catch {
        return [];
      }
    })();
    generation.end({
      output: toolCalls.length > 0 ? toolCalls : ctx.finishReason,
      usage: { input: ctx.inputTokens, output: ctx.outputTokens, unit: "TOKENS" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      level: (ctx.error ? "ERROR" : "DEFAULT") as any,
      statusMessage: ctx.error,
    });
    // Flush async - fire and forget (DO stays alive long enough for this to complete)
    lf.flushAsync().catch((err) => {
      console.error(JSON.stringify({ event: "trace:langfuse-flush-error", boardId: ctx.boardId, error: String(err) }));
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "trace:langfuse-error", boardId: ctx.boardId, error: String(err) }));
  }
}

/**
 * Creates a LanguageModelMiddleware that writes AI request traces to D1 and
 * optionally to Langfuse (if a Langfuse client is provided).
 *
 * KEY-DECISION 2026-02-19: wrapLanguageModel middleware chosen over LangSmith npm or
 * @microlabs/otel-cf-workers because: (1) zero new deps for D1 path - uses ai@6 already
 * installed, (2) no untested AIChatAgent + instrumentDO() interaction, (3) captures the
 * assembled system prompt (persona+gamemode+phase) which is the primary debugging target.
 * Langfuse v3 (fetch-based) added as optional cloud UI layer on top of D1.
 * See docs/sessions/langsmith-observability.md for full decision rationale.
 */
export function createTracingMiddleware(
  db: D1Database,
  ctx: TraceContext,
  langfuse?: Langfuse | null,
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",

    // Intercept non-streaming calls (reactive persona + director nudge use generateText)
    wrapGenerate: async ({ doGenerate, params }) => {
      const startMs = Date.now();
      const startTime = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (params as any).prompt ?? [];
      const systemPrompt = extractSystemPrompt(prompt);
      const messageCount = prompt.filter((m: { role: string }) => m.role !== "system").length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any;
      try {
        result = await doGenerate();
      } catch (err) {
        const row = {
          ...ctx,
          ts: Date.now(),
          durationMs: Date.now() - startMs,
          inputTokens: 0,
          outputTokens: 0,
          systemPrompt,
          messageCount,
          toolCallsJson: "[]",
          finishReason: "error",
          error: String(err),
        };
        writeD1Trace(db, row).catch(() => {});
        if (langfuse) recordLangfuseGeneration(langfuse, { ...row, startTime });
        throw err;
      }

      const toolCalls = Array.isArray(result?.content)
        ? result.content
            .filter((c: { type: string }) => c.type === "tool-call")
            .map((c: { toolName: string; args: unknown }) => ({ name: c.toolName, args: c.args }))
        : [];
      const row = {
        ...ctx,
        ts: Date.now(),
        durationMs: Date.now() - startMs,
        inputTokens: result?.usage?.inputTokens ?? 0,
        outputTokens: result?.usage?.outputTokens ?? 0,
        systemPrompt,
        messageCount,
        toolCallsJson: JSON.stringify(toolCalls),
        finishReason: result?.finishReason ?? "unknown",
      };

      writeD1Trace(db, row).catch(() => {});
      if (langfuse) recordLangfuseGeneration(langfuse, { ...row, startTime });

      return result;
    },

    // Intercept streaming calls (main chat uses streamText). Tee the stream so we can
    // observe the finish event without blocking the client-facing stream.
    wrapStream: async ({ doStream, params }) => {
      const startMs = Date.now();
      const startTime = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (params as any).prompt ?? [];
      const systemPrompt = extractSystemPrompt(prompt);
      const messageCount = prompt.filter((m: { role: string }) => m.role !== "system").length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamResult = (await doStream()) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [stream1, stream2]: [ReadableStream<any>, ReadableStream<any>] = streamResult.stream.tee();

      // Consume stream2 in background to capture finish event, then write traces.
      // stream1 is returned to the caller unchanged.
      (async () => {
        const toolCalls: Array<{ name: string; args: unknown }> = [];
        let inputTokens = 0;
        let outputTokens = 0;
        let finishReason = "unknown";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reader = (stream2 as ReadableStream<any>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chunk = value as any;
            if (chunk?.type === "tool-call") {
              toolCalls.push({ name: chunk.toolName, args: chunk.args });
            }
            if (chunk?.type === "finish") {
              finishReason = chunk.finishReason ?? "unknown";
              inputTokens = chunk.usage?.inputTokens ?? 0;
              outputTokens = chunk.usage?.outputTokens ?? 0;
            }
          }
        } finally {
          reader.releaseLock();
        }
        const row = {
          ...ctx,
          ts: Date.now(),
          durationMs: Date.now() - startMs,
          inputTokens,
          outputTokens,
          systemPrompt,
          messageCount,
          toolCallsJson: JSON.stringify(toolCalls),
          finishReason,
        };
        await writeD1Trace(db, row);
        if (langfuse) recordLangfuseGeneration(langfuse, { ...row, startTime });
      })().catch((err) => {
        console.error(JSON.stringify({ event: "trace:stream-error", boardId: ctx.boardId, error: String(err) }));
      });

      return { ...streamResult, stream: stream1 };
    },
  };
}
