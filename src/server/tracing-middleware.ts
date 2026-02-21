import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { Langfuse } from "langfuse";

export { wrapLanguageModel, Langfuse };

interface TraceContext {
  boardId: string;
  trigger: string;
  persona: string;
  model: string;
  promptVersion: string;
  gameMode?: string;
  scenePhase?: string;
  intentChip?: string;
}

/** Create a Langfuse generation span and end it with results.
 *  Fire-and-forget safe - logs errors internally, never throws. */
function recordLangfuseGeneration(
  lf: Langfuse,
  ctx: TraceContext & {
    startTime: Date;

    prompt: any[];
    responseText: string;
    inputTokens: number;
    outputTokens: number;
    toolCallsJson: string;
    finishReason: string;
    error?: string;
  },
): void {
  try {
    const toolCalls = (() => {
      try {
        return JSON.parse(ctx.toolCallsJson);
      } catch {
        return [];
      }
    })();
    const output: { text?: string; toolCalls?: unknown[] } = {};
    if (ctx.responseText) output.text = ctx.responseText;
    if (toolCalls.length > 0) output.toolCalls = toolCalls;
    const resolvedOutput = Object.keys(output).length > 0 ? output : ctx.finishReason;

    const metadata = {
      boardId: ctx.boardId,
      promptVersion: ctx.promptVersion,
      ...(ctx.gameMode && { gameMode: ctx.gameMode }),
      ...(ctx.scenePhase && { scenePhase: ctx.scenePhase }),
      ...(ctx.intentChip && { intentChip: ctx.intentChip }),
    };
    const trace = lf.trace({
      name: ctx.trigger,
      input: ctx.prompt,
      output: resolvedOutput,
      metadata,
      tags: [ctx.trigger, ctx.model, `persona:${ctx.persona}`],
    });
    const generation = trace.generation({
      name: `${ctx.trigger}:${ctx.persona}`,
      model: ctx.model,
      startTime: ctx.startTime,
      input: ctx.prompt,
      metadata,
    });
    generation.end({
      output: resolvedOutput,
      usage: { input: ctx.inputTokens, output: ctx.outputTokens, unit: "TOKENS" },

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
 * Creates a LanguageModelMiddleware that writes AI request traces to Langfuse.
 *
 * KEY-DECISION 2026-02-19: wrapLanguageModel middleware chosen over LangSmith npm or
 * @microlabs/otel-cf-workers because: (1) zero new deps - uses ai@6 already installed,
 * (2) no untested AIChatAgent + instrumentDO() interaction, (3) captures the assembled
 * system prompt (persona+gamemode+phase) which is the primary debugging target.
 * Langfuse v3 (fetch-based) provides full I/O capture for debugging tool calls and
 * board quality. D1 ai_traces table removed - Langfuse is the sole observability layer.
 */
export function createTracingMiddleware(ctx: TraceContext, langfuse?: Langfuse | null): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",

    // Sanitize tool-call inputs before every API call (including each step within a multi-step
    // streamText). Prevents Anthropic API error: "tool_use.input: Input should be a valid dictionary"
    // when the model generates null/string/array inputs.
    // KEY-DECISION 2026-02-21: transformParams fires per-step (catches within-turn invalid inputs).
    // sanitizeMessages() in chat-agent.ts covers the between-turn history sanitization.
    // Together they cover all invalid-input paths to Anthropic.

    transformParams: async ({ params }: { params: any }) => {
      const prompt = params.prompt;
      if (!Array.isArray(prompt)) return params;
      const needsFix = prompt.some(
        (msg: any) =>
          msg.role === "assistant" &&
          Array.isArray(msg.content) &&
          msg.content.some(
            (part: any) =>
              part.type === "tool-call" &&
              (typeof part.input !== "object" || part.input === null || Array.isArray(part.input)),
          ),
      );
      if (!needsFix) return params;
      console.warn(JSON.stringify({ event: "middleware:sanitize-tool-input", boardId: ctx.boardId }));
      return {
        ...params,

        prompt: prompt.map((msg: any) => {
          if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;
          return {
            ...msg,

            content: msg.content.map((part: any) => {
              if (
                part.type === "tool-call" &&
                (typeof part.input !== "object" || part.input === null || Array.isArray(part.input))
              ) {
                return { ...part, input: {} };
              }
              return part;
            }),
          };
        }),
      };
    },

    // Intercept non-streaming calls (reactive persona + director nudge use generateText)
    wrapGenerate: async ({ doGenerate, params }) => {
      const startTime = new Date();

      const prompt = (params as any).prompt ?? [];

      let result: any;
      try {
        result = await doGenerate();
      } catch (err) {
        if (langfuse) {
          recordLangfuseGeneration(langfuse, {
            ...ctx,
            startTime,
            prompt,
            responseText: "",
            inputTokens: 0,
            outputTokens: 0,
            toolCallsJson: "[]",
            finishReason: "error",
            error: String(err),
          });
        }
        throw err;
      }

      const toolCalls = Array.isArray(result?.content)
        ? result.content
            .filter((c: { type: string }) => c.type === "tool-call")
            .map((c: { toolName: string; input: unknown }) => ({ name: c.toolName, input: c.input }))
        : [];
      const responseText = Array.isArray(result?.content)
        ? result.content
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text: string }) => c.text)
            .join("")
        : "";

      if (langfuse) {
        recordLangfuseGeneration(langfuse, {
          ...ctx,
          startTime,
          prompt,
          responseText,
          inputTokens: result?.usage?.inputTokens?.total ?? 0,
          outputTokens: result?.usage?.outputTokens?.total ?? 0,
          toolCallsJson: JSON.stringify(toolCalls),
          finishReason: result?.finishReason ?? "unknown",
        });
      }

      return result;
    },

    // Intercept streaming calls (main chat uses streamText). Tee the stream so we can
    // observe the finish event without blocking the client-facing stream.
    wrapStream: async ({ doStream, params }) => {
      const startTime = new Date();

      const prompt = (params as any).prompt ?? [];

      const streamResult = (await doStream()) as any;

      if (!langfuse) return streamResult;

      const [stream1, stream2]: [ReadableStream<any>, ReadableStream<any>] = streamResult.stream.tee();

      // Consume stream2 in background to capture finish event, then write trace.
      // stream1 is returned to the caller unchanged.
      (async () => {
        const toolCalls: Array<{ name: string; input: unknown }> = [];
        let inputTokens = 0;
        let outputTokens = 0;
        let finishReason = "unknown";
        let responseText = "";

        const reader = (stream2 as ReadableStream<any>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = value as any;
            if (chunk?.type === "text-delta") {
              responseText += chunk.delta;
            }
            if (chunk?.type === "tool-call") {
              toolCalls.push({ name: chunk.toolName, input: chunk.input });
            }
            if (chunk?.type === "finish") {
              finishReason = chunk.finishReason ?? "unknown";
              inputTokens = chunk.usage?.inputTokens?.total ?? 0;
              outputTokens = chunk.usage?.outputTokens?.total ?? 0;
            }
          }
        } finally {
          reader.releaseLock();
        }
        recordLangfuseGeneration(langfuse, {
          ...ctx,
          startTime,
          prompt,
          responseText,
          inputTokens,
          outputTokens,
          toolCallsJson: JSON.stringify(toolCalls),
          finishReason,
        });
      })().catch((err) => {
        console.error(JSON.stringify({ event: "trace:stream-error", boardId: ctx.boardId, error: String(err) }));
      });

      return { ...streamResult, stream: stream1 };
    },
  };
}
