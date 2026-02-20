import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createSDKTools, isPlainObject, rectsOverlap, generateImageDataUrl } from "./ai-tools-sdk";
import { createTracingMiddleware, wrapLanguageModel, Langfuse } from "./tracing-middleware";
import {
  SYSTEM_PROMPT,
  SCENE_SETUP_PROMPT,
  INTENT_PROMPTS,
  MOMENTUM_PROMPT,
  DIRECTOR_PROMPTS,
  DIRECTOR_PROMPTS_HAT,
  DIRECTOR_PROMPTS_YESAND,
  PROMPT_VERSION,
  computeScenePhase,
  MAX_AUTONOMOUS_EXCHANGES,
  buildPersonaSystemPrompt,
  buildRelationshipBlock,
  computeBudgetPhase,
  BUDGET_PROMPTS,
  buildGameModePromptBlock,
  computeLifecyclePhase,
  buildLifecycleBlock,
  CRITIC_PROMPT,
  buildCanvasReactionPrompt,
} from "./prompts";
import type { GameModeState } from "./prompts";
import { HAT_PROMPTS, getRandomHatPrompt } from "./hat-prompts";
import type { Bindings } from "./env";
import { recordBoardActivity } from "./env";
import type {
  BoardObject,
  BoardObjectProps,
  BoardStub,
  CanvasAction,
  CharacterRelationship,
  GameMode,
  Persona,
  SceneLifecyclePhase,
} from "../shared/types";
import { SCENE_TURN_BUDGET, DEFAULT_PERSONAS, AI_MODELS, AI_USER_ID } from "../shared/types";
import { getTemplateById } from "../shared/board-templates";

/**
 * Strip leaked model internals from output text: <think> blocks, <tool_call> fragments,
 * and content before stray </think> tags. GLM 4.7 Flash leaks these into visible chat by
 * exchange 3+, causing 1000-3000+ word circular reasoning blobs in the UI.
 *
 * KEY-DECISION 2026-02-19: Applied at 3 sites - display (ensurePersonaPrefix),
 * message construction (buildGenerateTextMessage), and history storage (both above).
 * Cleaning at construction time handles both display AND history pollution in one pass.
 */
function cleanModelOutput(text: string): string {
  // Strip <think>...</think> blocks (multiline, lazy - handles multiple blocks correctly)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Strip <tool_call>...</tool_call> fragments
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
  // Strip content before stray </think> tags (partial leak: block opened but truncated before close)
  const strayThinkClose = cleaned.indexOf("</think>");
  if (strayThinkClose !== -1) {
    cleaned = cleaned.slice(strayThinkClose + "</think>".length);
  }
  // Strip stray <tool_call> without closing tag (truncated leak)
  const strayToolCall = cleaned.indexOf("<tool_call>");
  if (strayToolCall !== -1) {
    cleaned = cleaned.slice(0, strayToolCall);
  }
  return cleaned.trim();
}

/**
 * Blocklist for output moderation. Covers slurs, explicit sexual content, and harmful instructions.
 * Not a general profanity filter - mild improv language (damn, hell, ass) is fine.
 *
 * KEY-DECISION 2026-02-20: Simple regex blocklist over external moderation API.
 * No added latency, no cost, no external dependency. ~20 patterns cover the obvious
 * harm vectors (slurs, explicit sexual, hate speech, harmful instructions) for a public
 * improv gallery. Word-boundary anchors + leet-speak variants prevent easy circumvention.
 */
const CONTENT_BLOCKLIST: RegExp[] = [
  // Racial and ethnic slurs
  /\bn[i!1][gq]{2}[ae3]r\b/i,
  /\bf[a@4][gq]{2}[o0]t\b/i,
  /\bk[i!1]k[e3]\b/i,
  /\bsp[i!1][ck]\b/i,
  /\bch[i!1]nk\b/i,
  /\bwetback\b/i,
  // Explicit sexual content (not mild innuendo)
  /\bpornograph/i,
  /\bsex(?:ual)?\s+(?:explicit|assault|traffic)/i,
  /\bchild\s+(?:sex|porn|nude)/i,
  /\bminor\s+(?:sex|porn|nude)/i,
  // Hate speech
  /\bheil\s+hitler\b/i,
  /\bwhite\s+(?:power|supremac)/i,
  /\bgas\s+the\s+\w+s\b/i,
  // Harmful real-world instructions
  /\b(?:make|build)\s+(?:a\s+)?(?:bomb|explosive)\b/i,
  /\bhow\s+to\s+(?:make|synthesize)\s+\w*(?:drug|meth|fentanyl)/i,
  /\bhow\s+to\s+(?:kill|murder|poison)\s+(?:a\s+)?(?:person|someone|people)\b/i,
  /\bkill\s+(?:your|ur)self\b/i,
];

/**
 * Sanitize AI output text against the content blocklist.
 * Returns a safe replacement string if flagged; original text otherwise.
 * Applied at all AI response output points before persisting to message history.
 */
function moderateOutput(boardId: string, text: string): string {
  for (const pattern of CONTENT_BLOCKLIST) {
    if (pattern.test(text)) {
      console.warn(JSON.stringify({ event: "moderation:flagged", boardId, pattern: pattern.source }));
      return "[scene paused for content review]";
    }
  }
  return text;
}

/** Check if text contains flagged content (exported for gallery gate in index.ts). */
export function containsFlaggedContent(text: string): boolean {
  return CONTENT_BLOCKLIST.some((p) => p.test(text));
}

/**
 * Sanitize UIMessages to ensure all tool invocation inputs are valid objects.
 * Some LLMs (especially smaller ones) sometimes emit tool calls with string,
 * null, or array inputs instead of JSON objects. This causes API validation
 * errors ("Input should be a valid dictionary") when the conversation history
 * is sent back to the model on subsequent turns.
 */
function sanitizeMessages(messages: UIMessage[]): { messages: UIMessage[]; repairedCount: number } {
  let repairedCount = 0;
  const sanitized = messages.map((msg) => {
    if (msg.role !== "assistant" || !msg.parts) return msg;

    let needsRepair = false;
    const cleanedParts = msg.parts.map((part) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = part as any;

      // Static tool parts (from streamText): type is "tool-<toolName>"
      // AI SDK v6 names these "tool-createStickyNote", "tool-getBoardState", etc.
      if (
        typeof p.type === "string" &&
        p.type.startsWith("tool-") &&
        p.type !== "dynamic-tool" &&
        !isPlainObject(p.input)
      ) {
        needsRepair = true;
        console.warn(
          JSON.stringify({
            event: "ai:sanitize:input",
            tool: p.type.slice(5),
            inputType: p.input === null ? "null" : Array.isArray(p.input) ? "array" : typeof p.input,
            toolCallId: p.toolCallId,
          }),
        );
        return { ...p, input: {} };
      }

      // dynamic-tool parts (from director generateText)
      if (p.type === "dynamic-tool" && !isPlainObject(p.input)) {
        needsRepair = true;
        console.warn(
          JSON.stringify({
            event: "ai:sanitize:input",
            tool: p.toolName,
            inputType: p.input === null ? "null" : Array.isArray(p.input) ? "array" : typeof p.input,
            toolCallId: p.toolCallId,
          }),
        );
        return { ...p, input: {} };
      }

      return part;
    });

    if (needsRepair) {
      repairedCount++;
      return { ...msg, parts: cleanedParts };
    }
    return msg;
  });
  return { messages: sanitized, repairedCount };
}

export class ChatAgent extends AIChatAgent<Bindings> {
  /* eslint-disable @typescript-eslint/no-explicit-any */

  // KEY-DECISION 2026-02-20: Cap at 100 messages. Each scene = 1 user msg + 1 AI + 1 reactive
  // per turn. SCENE_TURN_BUDGET caps human turns, so max ~3x turns msgs + overhead fits well
  // under 100. This prevents unbounded DO Storage growth across scenes on the same board.
  maxPersistedMessages = 100;

  // Lightweight mutex: prevents concurrent AI generation (chat + director).
  // Do NOT replace with _activeStreamId - it's unreliable after DO hibernation.
  // (ResumableStream.restore() picks up stale stream metadata with a 5-min threshold,
  // causing false positives that permanently block director nudges on prod.)
  private _isGenerating = false;

  // Multi-agent persona state (resets on DO hibernation - that's fine, defaults work)
  private _activePersonaIndex = 0; // which persona responds to the next human message
  private _autonomousExchangeCount = 0; // consecutive autonomous exchanges (reset on human msg)

  // KEY-DECISION 2026-02-19: Per-message ephemeral pattern (same as body.model/body.gameMode).
  // Claims reset on DO hibernation; client re-sends personaId on every message so DO wakes up
  // knowing the claim without any persistence layer. This avoids D1 writes for ephemeral state.
  private _personaClaims = new Map<string, string>(); // username -> Persona.id

  // Game mode state (resets on DO hibernation - client re-sends gameMode on each message)
  private _gameMode: GameMode = "freeform";
  private _hatPromptIndex = -1;
  private _hatExchangeCount = 0;
  private _hatPromptCount = 0; // increments on each new hat prompt for spatial offset calculation
  private _yesAndCount = 0;

  // Per-message requested model (resets on DO hibernation - client re-sends model on each message)
  private _requestedModel = "";

  // Per-user AI rate limit (30 msg/min per username). Resets on DO hibernation - that's fine,
  // the window is short and we'd rather allow traffic after a cold start than block it.
  private _userRateLimit = new Map<string, { count: number; windowStart: number }>();

  // Daily AI budget tracking (resets on DO hibernation - conservative, prevents runaway spend)
  private _dailySpendNeurons = 0;
  private _dailySpendDate = ""; // YYYY-MM-DD UTC, resets when date changes

  // Langfuse client - lazily initialized on first request, null if env vars absent.
  // undefined = not yet checked; null = env vars missing, skip; Langfuse = active.
  private _langfuseClient: Langfuse | null | undefined = undefined;

  // Canvas reaction engine state (resets on DO hibernation - correct, short-lived debounce state)
  // Persistent schedule (onCanvasReaction) wakes the DO; empty buffer guard handles the stale-schedule case.
  private _pendingCanvasActions: CanvasAction[] = [];
  private _canvasReactionCooldownUntil = 0;
  private _lastHumanMessageAt = 0;

  /** Check if daily AI budget is exhausted. Returns true if over budget. */
  private _isOverBudget(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (this._dailySpendDate !== today) {
      this._dailySpendNeurons = 0;
      this._dailySpendDate = today;
    }
    // $0.011 per 1K neurons -> budget_usd / 0.011 * 1000 = max neurons
    const maxNeurons = (parseFloat(String(this.env.DAILY_AI_BUDGET_USD) || "5") / 0.011) * 1000;
    return this._dailySpendNeurons >= maxNeurons;
  }

  /** Track neuron usage after a request (rough estimate: ~1 neuron per token) */
  private _trackUsage(inputTokens: number, outputTokens: number) {
    const today = new Date().toISOString().slice(0, 10);
    if (this._dailySpendDate !== today) {
      this._dailySpendNeurons = 0;
      this._dailySpendDate = today;
    }
    this._dailySpendNeurons += inputTokens + outputTokens;
  }

  /** Rate-limit AI messages per user: 30/min. Returns limited=true with retryAfter seconds. */
  private _checkUserRateLimit(username: string): {
    limited: boolean;
    retryAfter: number;
  } {
    const LIMIT = 30;
    const WINDOW_MS = 60_000;
    const now = Date.now();
    const entry = this._userRateLimit.get(username);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this._userRateLimit.set(username, { count: 1, windowStart: now });
      return { limited: false, retryAfter: 0 };
    }
    if (entry.count >= LIMIT) {
      const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
      return { limited: true, retryAfter };
    }
    entry.count++;
    return { limited: false, retryAfter: 0 };
  }

  /** Load board personas from D1, falling back to defaults on error or empty result.
   *  Never throws - D1 failures degrade gracefully to defaults with a logged warning. */
  private async _getPersonas(): Promise<Persona[]> {
    try {
      const { results } = await this.env.DB.prepare(
        "SELECT id, name, trait, color FROM board_personas WHERE board_id = ? ORDER BY created_at",
      )
        .bind(this.name)
        .all<Persona>();
      return results.length > 0 ? (results as Persona[]) : [...DEFAULT_PERSONAS];
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "personas:load-error",
          boardId: this.name,
          error: String(err),
        }),
      );
      return [...DEFAULT_PERSONAS];
    }
  }

  /** Resolve which persona should respond to the current message.
   *  If the username has a claimed personaId that still exists in the personas array, use it.
   *  Otherwise fall back to round-robin via _activePersonaIndex (backward compatible). */
  private _resolveActivePersona(
    personas: Persona[],
    username?: string,
  ): { activeIndex: number; activePersona: Persona; otherPersona: Persona | undefined } {
    let activeIndex = this._activePersonaIndex % personas.length;
    if (username) {
      const claimedId = this._personaClaims.get(username);
      if (claimedId) {
        const claimedIndex = personas.findIndex((p) => p.id === claimedId);
        if (claimedIndex !== -1) {
          activeIndex = claimedIndex;
        }
      }
    }
    const activePersona = personas[activeIndex];
    const otherPersona = personas.length > 1 ? personas[(activeIndex + 1) % personas.length] : undefined;
    return { activeIndex, activePersona, otherPersona };
  }

  /** Resolve the selected model entry from AI_MODELS registry.
   *  Priority: per-message requested model > DEFAULT_AI_MODEL env var > undefined (Workers AI fallback) */
  private _resolveModelEntry() {
    const modelId = this._requestedModel || (this.env as unknown as Record<string, string>).DEFAULT_AI_MODEL || "";
    return modelId ? AI_MODELS.find((m) => m.id === modelId) : undefined;
  }

  /** Choose model based on provider routing: workers-ai, openai, or anthropic */
  private _getModel() {
    const entry = this._resolveModelEntry();
    const provider = entry?.provider ?? "workers-ai";

    // OpenAI provider
    if (provider === "openai" && this.env.OPENAI_API_KEY) {
      return createOpenAI({ apiKey: this.env.OPENAI_API_KEY })(entry!.modelId);
    }

    // Anthropic provider
    if (provider === "anthropic" && this.env.ANTHROPIC_API_KEY) {
      return createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY })(entry!.modelId);
    }

    // Workers AI provider (default fallback)
    const modelId =
      entry?.provider === "workers-ai" ? entry.modelId : this.env.WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash";
    // workers-ai-provider v3.1.1 drops tool_choice from buildRunInputs (only forwards `tools`).
    // All Workers AI models benefit from explicit tool_choice:"auto"; shim applies universally.
    const ai = this.env.AI as any;
    const shimmedBinding = {
      run: (model: string, inputs: Record<string, unknown>, options?: unknown) => {
        const hasTools = !!(inputs?.tools && (inputs.tools as unknown[]).length > 0);
        console.debug(
          JSON.stringify({
            event: "ai:shim",
            model,
            hasTools,
            toolCount: hasTools ? (inputs.tools as unknown[]).length : 0,
            hadToolChoice: !!inputs?.tool_choice,
            injecting: hasTools,
          }),
        );
        return ai.run(model, hasTools ? { ...inputs, tool_choice: "auto" } : inputs, options);
      },
    };
    return (createWorkersAI({ binding: shimmedBinding as any }) as any)(modelId);
  }

  /** Lazily initialize Langfuse client. Returns null if env vars not configured.
   *  Cached per DO instance (survives across requests until hibernation).
   *
   *  KEY-DECISION 2026-02-19: langfuse v3 (not @langfuse/otel) chosen for CF Workers compat.
   *  @langfuse/otel depends on NodeTracerProvider which uses Node.js APIs blocked in Workers.
   *  langfuse v3 is fetch-based - works in edge runtimes. flushAt:1 + flushInterval:0 ensures
   *  traces flush immediately per request (no background timer accumulating in the DO). */
  private _getLangfuse(): Langfuse | null {
    if (this._langfuseClient !== undefined) return this._langfuseClient as Langfuse | null;
    if (!this.env.LANGFUSE_PUBLIC_KEY || !this.env.LANGFUSE_SECRET_KEY) {
      this._langfuseClient = null;
      return null;
    }
    const client = new Langfuse({
      publicKey: this.env.LANGFUSE_PUBLIC_KEY,
      secretKey: this.env.LANGFUSE_SECRET_KEY,
      baseUrl: this.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
      flushAt: 1,
      flushInterval: 0,
    });
    this._langfuseClient = client;
    console.debug(JSON.stringify({ event: "langfuse:init", boardId: this.name }));
    return client;
  }

  /** Return a traced model for a specific request type.
   *  Wraps the base model with Langfuse tracing middleware that captures
   *  full conversation I/O, token usage, and tool calls for each request. */
  private _getTracedModel(
    trigger: string,
    persona: string,
    options?: { gameMode?: string; scenePhase?: string; intentChip?: string },
  ) {
    return wrapLanguageModel({
      model: this._getModel(),
      middleware: createTracingMiddleware(
        {
          boardId: this.name,
          trigger,
          persona,
          model: this._getModelName(),
          promptVersion: PROMPT_VERSION,
          ...(options?.gameMode && { gameMode: options.gameMode }),
          ...(options?.scenePhase && { scenePhase: options.scenePhase }),
          ...(options?.intentChip && { intentChip: options.intentChip }),
        },
        this._getLangfuse(),
      ),
    });
  }

  /** Model name for logging (avoids exposing full model object) */
  private _getModelName(): string {
    const entry = this._resolveModelEntry();
    if (entry) return entry.id;
    return (this.env.WORKERS_AI_MODEL || "glm-4.7-flash").split("/").pop() || "workers-ai";
  }

  /** Check if current model is a Workers AI model (for budget/neuron tracking) */
  private _isWorkersAI(): boolean {
    const entry = this._resolveModelEntry();
    return !entry || entry.provider === "workers-ai";
  }

  /** Structured log: AI request started */
  private _logRequestStart(trigger: string, persona: string, extra?: Record<string, unknown>) {
    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: this._getModelName(),
        promptVersion: PROMPT_VERSION,
        trigger,
        persona,
        ...extra,
      }),
    );
  }

  /** Structured log: AI request completed with timing/step metrics */
  private _logRequestEnd(
    trigger: string,
    persona: string,
    startTime: number,
    steps: number,
    toolCalls: number,
    extra?: Record<string, unknown>,
  ) {
    // Rough neuron tracking: ~2K input + ~500 output per step (conservative estimate).
    // Actual usage varies by model/context but this prevents runaway spend.
    if (this._isWorkersAI()) {
      this._trackUsage(steps * 2000, steps * 500);
    }
    console.debug(
      JSON.stringify({
        event: "ai:request:end",
        boardId: this.name,
        model: this._getModelName(),
        promptVersion: PROMPT_VERSION,
        trigger,
        persona,
        steps,
        toolCalls,
        durationMs: Date.now() - startTime,
        dailyNeurons: this._dailySpendNeurons,
        ...extra,
      }),
    );
  }

  /** Fire-and-forget: record sanitize repair event in Langfuse when weak models emit malformed tool inputs.
   *  KEY-DECISION 2026-02-20: Separate trace (not correlated with generation trace) because sanitize
   *  runs before the AI call. Grouped by model tag so degradation appears as rising metric over time. */
  private _traceSanitizeRepair(trigger: string, repairedCount: number): void {
    const lf = this._getLangfuse();
    if (!lf) return;
    try {
      const trace = lf.trace({
        name: "sanitize:repair",
        metadata: { boardId: this.name, model: this._getModelName(), trigger, repairedCount },
        tags: ["sanitize", `model:${this._getModelName()}`, `trigger:${trigger}`],
      });
      lf.score({ traceId: trace.id, name: "sanitized_messages", value: repairedCount });
      lf.flushAsync().catch((err) => {
        console.error(JSON.stringify({ event: "trace:langfuse-flush-error", boardId: this.name, error: String(err) }));
      });
    } catch (err) {
      console.error(JSON.stringify({ event: "trace:sanitize-error", boardId: this.name, error: String(err) }));
    }
  }

  /** Fire-and-forget: record tool execution failures in Langfuse.
   *  Called after streamText/generateText when any tool returned an error response.
   *  Tool errors here mean Board DO rejected the mutation (object not found, out of bounds, etc.) */
  private _traceToolFailures(
    trigger: string,
    steps: { toolCalls: unknown[]; toolResults?: { toolCallId: string; output: unknown }[] }[],
  ): void {
    const lf = this._getLangfuse();
    if (!lf) return;
    try {
      const failedOutcomes: { toolName: string; error: unknown }[] = [];
      for (const step of steps) {
        for (const tr of step.toolResults ?? []) {
          if (isPlainObject(tr.output) && "error" in tr.output) {
            const toolCall = step.toolCalls.find((tc) => isPlainObject(tc) && tc.toolCallId === tr.toolCallId) as
              | Record<string, unknown>
              | undefined;
            const toolName = typeof toolCall?.toolName === "string" ? toolCall.toolName : "unknown";
            failedOutcomes.push({
              toolName,
              error: tr.output.error,
            });
          }
        }
      }
      if (failedOutcomes.length === 0) return;
      const trace = lf.trace({
        name: "tool:outcome:failed",
        metadata: { boardId: this.name, model: this._getModelName(), trigger, failedTools: failedOutcomes },
        tags: ["tool:failed", `model:${this._getModelName()}`, `trigger:${trigger}`],
      });
      lf.score({ traceId: trace.id, name: "tool_failures", value: failedOutcomes.length });
      lf.flushAsync().catch((err) => {
        console.error(JSON.stringify({ event: "trace:langfuse-flush-error", boardId: this.name, error: String(err) }));
      });
    } catch (err) {
      console.error(JSON.stringify({ event: "trace:tool-outcome-error", boardId: this.name, error: String(err) }));
    }
  }

  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // this.name = boardId (set by client connecting to /agents/ChatAgent/<boardId>)

    // Extract body early - used for rate limiting AND throughout the method
    const body = options && "body" in options ? (options as any).body : undefined;

    // KEY-DECISION 2026-02-19: Rate limit check before _isGenerating mutex -
    // if _checkUserRateLimit throws, mutex won't leak permanently blocking director/reactive.
    // "anonymous" fallback is intentionally a shared bucket (fail-safe direction vs. bypassing limit).
    const userKey = body?.username || "anonymous";
    const rl = this._checkUserRateLimit(userKey);
    if (rl.limited) {
      console.warn(
        JSON.stringify({
          event: "rate-limit:ai",
          boardId: this.name,
          user: userKey,
        }),
      );
      const lf = this._getLangfuse();
      if (lf) {
        lf.trace({
          name: "rate-limit:ai",
          metadata: { boardId: this.name, user: userKey, retryAfter: rl.retryAfter },
          tags: ["rate-limit"],
        });
        lf.flushAsync().catch((err) => {
          console.error(
            JSON.stringify({ event: "trace:langfuse-flush-error", boardId: this.name, error: String(err) }),
          );
        });
      }
      const rlMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "text" as const,
            text: `Too many messages! Please slow down - try again in ${rl.retryAfter}s.`,
          },
        ],
      };
      this.messages.push(rlMsg);
      await this.persistMessages(this.messages);
      return new Response(JSON.stringify({ error: "rate-limited" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    this._isGenerating = true;
    this._autonomousExchangeCount = 0; // human spoke - reset cooldown
    this._lastHumanMessageAt = Date.now(); // track for canvas reaction "player is chatting" guard
    const startTime = Date.now();

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);

    // KEY-DECISION 2026-02-19: Server-side template seeding. When body.templateId is present,
    // create all template objects via Board DO RPC (guaranteed count), rewrite the user message
    // to displayText, and set a flag so the system prompt injects the template description
    // instead of SCENE_SETUP_PROMPT. This replaced LLM-parsed pseudocode which was unreliable.
    let templateDescription: string | undefined;
    if (body?.templateId) {
      const template = getTemplateById(body.templateId as string);
      if (template) {
        const seedBatchId = crypto.randomUUID();

        // Seed all template objects on the board. Errors are non-fatal: if seeding
        // partially fails, the AI still responds to whatever objects were created.
        try {
          for (const objSpec of template.objects) {
            const obj: BoardObject = {
              ...objSpec,
              id: crypto.randomUUID(),
              createdBy: AI_USER_ID,
              updatedAt: Date.now(),
              batchId: seedBatchId,
            } as BoardObject;
            await boardStub.mutate({ type: "obj:create", obj });
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "template:seed:error",
              boardId: this.name,
              templateId: template.id,
              batchId: seedBatchId,
              error: String(err),
            }),
          );
        }

        console.debug(
          JSON.stringify({
            event: "template:seed",
            boardId: this.name,
            templateId: template.id,
            objectCount: template.objects.length,
            batchId: seedBatchId,
          }),
        );

        // Rewrite the last user message to show displayText instead of raw pseudocode/templateId
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          const userPrefix = body?.username ? `[${body.username}] ` : "";
          this.messages[this.messages.length - 1] = {
            ...lastMsg,
            parts: [{ type: "text" as const, text: `${userPrefix}${template.displayText}` }],
          };
        }

        templateDescription = template.description;
      }
    }

    // Update persona claim from client (re-sent on every message for hibernation resilience)
    if (body?.personaId && body?.username) {
      this._personaClaims.set(body.username as string, body.personaId as string);
    }

    const personas = await this._getPersonas();
    const { activeIndex, activePersona, otherPersona } = this._resolveActivePersona(personas, body?.username);
    // Budget enforcement: count human turns (the message just added is already in this.messages)
    const humanTurns = this.messages.filter((m) => m.role === "user").length;
    const budgetPhase = computeBudgetPhase(humanTurns, SCENE_TURN_BUDGET);
    this._logRequestStart("chat", activePersona.name, {
      budgetPhase,
      humanTurns,
    });

    // Daily spend cap: reject if over budget (Workers AI only - Anthropic has its own billing)
    if (this._isWorkersAI() && this._isOverBudget()) {
      this._isGenerating = false;
      console.warn(
        JSON.stringify({
          event: "budget:daily-cap",
          boardId: this.name,
          neurons: this._dailySpendNeurons,
        }),
      );
      const lf = this._getLangfuse();
      if (lf) {
        lf.trace({
          name: "budget:daily-cap",
          metadata: { boardId: this.name, neurons: this._dailySpendNeurons },
          tags: ["budget", "daily-cap"],
        });
        lf.flushAsync().catch((err) => {
          console.error(
            JSON.stringify({ event: "trace:langfuse-flush-error", boardId: this.name, error: String(err) }),
          );
        });
      }
      const capMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "text" as const,
            text: `[${activePersona.name}] The AI has reached its daily budget. Come back tomorrow for more improv!`,
          },
        ],
      };
      this.messages.push(capMsg);
      await this.persistMessages(this.messages);
      return new Response(JSON.stringify({ error: "daily-budget-exceeded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Reject if scene is over - the last human message pushed us past the budget
    if (humanTurns > SCENE_TURN_BUDGET) {
      this._isGenerating = false;
      console.debug(
        JSON.stringify({
          event: "budget:reject",
          boardId: this.name,
          humanTurns,
          budget: SCENE_TURN_BUDGET,
        }),
      );
      const lf = this._getLangfuse();
      if (lf) {
        lf.trace({
          name: "budget:scene-over",
          metadata: { boardId: this.name, humanTurns, budget: SCENE_TURN_BUDGET },
          tags: ["budget", "scene-over"],
        });
        lf.flushAsync().catch((err) => {
          console.error(
            JSON.stringify({ event: "trace:langfuse-flush-error", boardId: this.name, error: String(err) }),
          );
        });
      }
      // Build a "scene is over" assistant message so the client sees feedback
      const overMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "text" as const,
            text: `[${activePersona.name}] Scene's over! That was a great run. Start a new scene to play again.`,
          },
        ],
      };
      this.messages.push(overMsg);
      await this.persistMessages(this.messages);
      return new Response(JSON.stringify({ error: "scene-over" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Record chat activity for async notifications (non-blocking)
    this.ctx.waitUntil(
      recordBoardActivity(this.env.DB, this.name).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            event: "activity:record",
            trigger: "chat",
            error: String(err),
          }),
        );
      }),
    );

    // Generate stage background on first message (non-blocking, parallel with AI response)
    if (humanTurns <= 1) {
      const promptText =
        this.messages
          .filter((m) => m.role === "user")
          .at(-1)
          ?.parts?.filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("") ?? "";
      this.ctx.waitUntil(
        this._generateBackground(promptText, boardStub as unknown as BoardStub, templateDescription).catch(
          (err: unknown) => {
            console.error(
              JSON.stringify({
                event: "background:error",
                boardId: this.name,
                error: String(err),
              }),
            );
          },
        ),
      );
    }

    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI, this.ctx.storage);

    // Update game mode from client (sent on every message so it survives DO hibernation)
    if (body?.gameMode && ["hat", "yesand", "freeform"].includes(body.gameMode)) {
      this._gameMode = body.gameMode as GameMode;
    }

    // Update requested model from client (sent on every message so it survives DO hibernation)
    if (body?.model && AI_MODELS.some((m) => m.id === body.model)) {
      this._requestedModel = body.model as string;
    }

    // Compute scene phase for tracing context
    const scenePhase = computeScenePhase(humanTurns);
    const intentChip = typeof body?.intent === "string" ? (body.intent as string) : undefined;

    // Handle hat mode prompt lifecycle
    if (this._gameMode === "hat") {
      // Check for [NEXT-HAT-PROMPT] marker to advance prompt
      const lastUserMsg = this.messages[this.messages.length - 1];
      const lastUserText =
        lastUserMsg?.parts
          ?.filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("") ?? "";
      if (lastUserText.includes("[NEXT-HAT-PROMPT]")) {
        const pick = getRandomHatPrompt(this._hatPromptIndex);
        this._hatPromptIndex = pick.index;
        this._hatExchangeCount = 0;
        this._hatPromptCount++;
      } else if (this._hatPromptIndex === -1) {
        // First message in hat mode - pick initial prompt
        const pick = getRandomHatPrompt();
        this._hatPromptIndex = pick.index;
        this._hatExchangeCount = 0;
        this._hatPromptCount = 0;
      }
      this._hatExchangeCount++;
    }

    // Track yes-and beat count
    if (this._gameMode === "yesand") {
      this._yesAndCount++;
    }

    // Build game mode prompt block
    // Hat prompt spatial offset: each new prompt gets x+=600 so scenes don't pile up.
    // Clamped to canvas right edge (1150 - 500 frame width = 650 max x).
    const hatXOffset = Math.min(50 + this._hatPromptCount * 600, 650);
    const gameModeState: GameModeState = {
      hatPrompt: this._hatPromptIndex >= 0 ? HAT_PROMPTS[this._hatPromptIndex] : undefined,
      hatExchangeCount: this._hatExchangeCount,
      hatPromptOffset: hatXOffset,
      yesAndCount: this._yesAndCount,
    };
    const gameModeBlock = buildGameModePromptBlock(this._gameMode, gameModeState);

    // Clear relationships and lifecycle phase at scene start (first message = fresh scene)
    if (this.messages.length <= 1) {
      await this.ctx.storage.delete("narrative:relationships");
      await this.ctx.storage.delete("scene:lifecyclePhase");
    }

    // Load scene relationships for system prompt injection
    const relationships = (await this.ctx.storage.get<CharacterRelationship[]>("narrative:relationships")) ?? [];
    const relBlock = buildRelationshipBlock(relationships);

    // Load stored lifecycle phase and compute effective phase (more advanced of stored vs auto)
    const storedLifecyclePhase = await this.ctx.storage.get<SceneLifecyclePhase>("scene:lifecyclePhase");
    const lifecyclePhase = computeLifecyclePhase(humanTurns, storedLifecyclePhase ?? undefined);

    // Build persona-aware system prompt with optional selection + multiplayer context
    let systemPrompt = buildPersonaSystemPrompt(activePersona, otherPersona, SYSTEM_PROMPT, gameModeBlock, relBlock);

    // Inject lifecycle phase guidance (skip for hat mode - rapid-fire scenes don't have dramatic arc)
    if (this._gameMode !== "hat") {
      systemPrompt += `\n\n${buildLifecycleBlock(lifecyclePhase)}`;
    }

    // Auto-archive on curtain (>=5 human turns to avoid archiving micro-scenes)
    // KEY-DECISION 2026-02-20: ctx.waitUntil so archiving never delays the AI response stream.
    // 5-turn minimum prevents empty boards from appearing in the gallery after a quick curtain call.
    if (lifecyclePhase === "curtain" && humanTurns >= 5) {
      this.ctx.waitUntil(
        boardStub.archiveScene().catch((err: unknown) => {
          console.error(
            JSON.stringify({
              event: "archive:unhandled",
              boardId: this.name,
              error: String(err),
            }),
          );
        }),
      );
      this.ctx.waitUntil(
        this._generateCriticReview(boardStub as unknown as BoardStub).catch((err: unknown) => {
          console.error(
            JSON.stringify({
              event: "critic:unhandled",
              boardId: this.name,
              error: String(err),
            }),
          );
        }),
      );
    }

    // Scene setup: inject template description (if template was seeded) or generic scene structure
    if (templateDescription) {
      systemPrompt += `\n\nSCENE ALREADY SET: The canvas has been populated with the scene. Here's what's there:\n${templateDescription}\nReact to what's on the canvas. Do NOT recreate these objects - they already exist. Riff on the scene in character.`;
    } else if (humanTurns <= 1) {
      systemPrompt += `\n\n${SCENE_SETUP_PROMPT}`;
    }

    // Intent-specific guidance: injected only when player clicked a dramatic chip.
    // Runtime type check (body is `any`) before lookup - unknown keys log a warning for
    // debugging version mismatches between client chip labels and INTENT_PROMPTS keys.
    const intentKey = typeof body?.intent === "string" ? (body.intent as string) : undefined;
    if (intentKey && INTENT_PROMPTS[intentKey]) {
      systemPrompt += `\n\n${INTENT_PROMPTS[intentKey]}`;
    } else if (intentKey) {
      console.warn(JSON.stringify({ event: "chat:unknown-intent", boardId: this.name, intent: intentKey }));
    }

    // Inject budget phase prompt when not in normal phase
    if (budgetPhase !== "normal") {
      systemPrompt += `\n\n${BUDGET_PROMPTS[budgetPhase]}`;
    }

    // Momentum nudge: after 3+ exchanges, prompt AI to end with a provocative hook
    if (humanTurns >= 3 && budgetPhase === "normal") {
      systemPrompt += `\n\n${MOMENTUM_PROMPT}`;
    }

    // Multiplayer attribution: tell the AI who is speaking
    if (body?.username) {
      systemPrompt += `\n\nThis is a multiplayer board. Messages from users are prefixed with [username]. The current speaker is ${body.username}. Address users by name when relevant.`;
    }

    if (body?.selectedIds?.length) {
      const objects = await boardStub.readObjects();
      const selected = (objects as BoardObject[]).filter((o: BoardObject) => body.selectedIds.includes(o.id));
      if (selected.length > 0) {
        const desc = selected
          .map(
            (o: BoardObject) =>
              `- ${o.type} (id: ${o.id}${(o.props as BoardObjectProps).text ? `, text: "${(o.props as BoardObjectProps).text}"` : ""})`,
          )
          .join("\n");
        systemPrompt += `\n\nThe user has selected ${selected.length} object(s) on the board:\n${desc}\nWhen the user refers to "selected", "these", or "this", they mean the above objects. Use their IDs directly.`;
      }
    }

    // Show AI in presence bar while responding (best-effort, never blocks AI response)
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(
        JSON.stringify({
          event: "ai:presence:start-error",
          error: String(err),
        }),
      );
    });

    let presenceCleared = false;
    const clearPresence = async () => {
      if (presenceCleared) return;
      presenceCleared = true;
      try {
        await boardStub.setAiPresence(false);
      } catch (err) {
        console.debug(
          JSON.stringify({
            event: "ai:presence:cleanup-error",
            error: String(err),
          }),
        );
      }
    };

    const wrappedOnFinish: typeof onFinish = async (...args: Parameters<typeof onFinish>) => {
      this._isGenerating = false;
      await clearPresence();

      // Request-level metrics from onFinish
      const finishArg = args[0] as
        | {
            steps?: { toolCalls?: unknown[]; toolResults?: { toolCallId: string; output: unknown }[] }[];
          }
        | undefined;
      const steps = finishArg?.steps?.length ?? 0;
      const toolCalls =
        finishArg?.steps?.reduce((sum: number, s: { toolCalls?: unknown[] }) => sum + (s.toolCalls?.length ?? 0), 0) ??
        0;
      this._logRequestEnd("chat", activePersona.name, startTime, steps, toolCalls);
      this._traceToolFailures("chat", (finishArg?.steps ?? []) as any[]);

      // Quality telemetry: per-response layout scoring for prompt tuning
      // Canvas bounds mirror LAYOUT RULES in prompts.ts: (50,60) to (1150,780)
      if (toolCalls > 0) {
        try {
          const allObjects: BoardObject[] = await boardStub.readObjects();
          const batchObjs = allObjects.filter((o) => o.batchId === batchId);

          // Warn if tools were called but no objects matched this batchId -
          // could indicate a timing/persistence issue rather than a real "zero objects" result
          if (batchObjs.length === 0) {
            console.warn(
              JSON.stringify({
                event: "ai:quality:empty-batch",
                boardId: this.name,
                batchId,
                toolCalls,
                totalObjects: allObjects.length,
              }),
            );
          } else {
            const otherObjs = allObjects.filter((o) => o.batchId !== batchId);

            let batchOverlap = 0;
            for (let i = 0; i < batchObjs.length; i++)
              for (let j = i + 1; j < batchObjs.length; j++)
                if (rectsOverlap(batchObjs[i], batchObjs[j])) batchOverlap++;

            let crossOverlap = 0;
            for (const newObj of batchObjs)
              for (const oldObj of otherObjs) if (rectsOverlap(newObj, oldObj)) crossOverlap++;

            const inBounds = batchObjs.filter(
              (o) => o.x >= 50 && o.y >= 60 && o.x + o.width <= 1150 && o.y + o.height <= 780,
            ).length;

            console.debug(
              JSON.stringify({
                event: "ai:quality",
                promptVersion: PROMPT_VERSION,
                batchOverlap,
                crossOverlap,
                objectsCreated: batchObjs.length,
                inBounds,
                model: this._getModelName(),
              }),
            );
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "ai:quality:error",
              boardId: this.name,
              batchId,
              error: String(err),
              stack: err instanceof Error ? err.stack : undefined,
            }),
          );
        }
      }

      // Ensure active persona's message has the [NAME] prefix (LLMs sometimes forget)
      this._ensurePersonaPrefix(activePersona.name);

      // Enforce game mode rules (e.g. Yes-And prefix) after persona prefix is in place
      this._enforceGameModeRules(activePersona.name);

      // Sanitize AI output against content blocklist before persisting
      this._moderateLastMessage();

      // Auto-name the board from scene content on 3rd human turn
      if (humanTurns === 3) {
        this.ctx.waitUntil(
          this._generateBoardName(boardStub as unknown as BoardStub).catch((err: unknown) => {
            console.error(
              JSON.stringify({
                event: "board:name:unhandled",
                boardId: this.name,
                error: String(err),
              }),
            );
          }),
        );
      }

      // Trigger reactive persona to "yes, and" the active persona's response
      this.ctx.waitUntil(
        this._triggerReactivePersona(activeIndex, personas).catch((err: unknown) => {
          console.error(
            JSON.stringify({
              event: "reactive:unhandled",
              boardId: this.name,
              error: String(err),
            }),
          );
        }),
      );

      return onFinish(...args);
    };

    // Clean up presence if client disconnects mid-stream
    options?.abortSignal?.addEventListener(
      "abort",
      () => {
        this._isGenerating = false;
        clearPresence();
      },
      { once: true },
    );

    // Reset the director inactivity timer on every user message
    this._resetDirectorTimer();

    try {
      const { messages: sanitizedMsgs, repairedCount } = sanitizeMessages(this.messages);
      if (repairedCount > 0) this._traceSanitizeRepair("chat", repairedCount);
      const result = streamText({
        model: this._getTracedModel("chat", activePersona.name, {
          gameMode: this._gameMode,
          scenePhase,
          intentChip,
        }),
        system: systemPrompt,
        messages: await convertToModelMessages(sanitizedMsgs),
        tools,
        onFinish: wrappedOnFinish,
        stopWhen: stepCountIs(5),
        abortSignal: options?.abortSignal,
      });

      return result.toUIMessageStreamResponse();
    } catch (err) {
      this._isGenerating = false;
      await clearPresence();
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Stage background generation (non-blocking, fire-and-forget via ctx.waitUntil)
  // ---------------------------------------------------------------------------

  /** Generate a theatrical backdrop image and place it on the canvas.
   *  Called via ctx.waitUntil on the first human message - never blocks the AI response.
   *  Canvas bounds from prompts.ts LAYOUT RULES: (50,60) to (1150,780). */
  private async _generateBackground(
    userPrompt: string,
    boardStub: BoardStub,
    templateDescription?: string,
  ): Promise<void> {
    // Guard: check for existing background to prevent duplicates (page refresh / reconnect)
    const existingObjects = await boardStub.readObjects();
    if (existingObjects.some((o: BoardObject) => o.isBackground)) {
      console.debug(JSON.stringify({ event: "background:skip", reason: "exists", boardId: this.name }));
      return;
    }

    // Derive backdrop prompt: use template description when available, otherwise user's message
    const sceneContext = templateDescription || userPrompt;
    const imagePrompt = `stage backdrop, theatrical, wide establishing shot, painterly style: ${sceneContext}`;

    const src = await generateImageDataUrl(this.env.AI, imagePrompt);

    const obj: BoardObject = {
      id: crypto.randomUUID(),
      type: "image",
      isBackground: true,
      x: 50,
      y: 60,
      width: 1100,
      height: 720,
      rotation: 0,
      props: { src, prompt: imagePrompt },
      createdBy: AI_USER_ID,
      updatedAt: Date.now(),
    } as BoardObject;

    await boardStub.mutate({ type: "obj:create", obj });

    console.debug(
      JSON.stringify({
        event: "background:created",
        boardId: this.name,
        id: obj.id,
        promptLen: imagePrompt.length,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Auto board naming (fires once on 3rd human turn via ctx.waitUntil)
  // ---------------------------------------------------------------------------

  /** Generate a creative board name from scene content and update D1.
   *  Fires once via ctx.waitUntil - never blocks the AI response stream.
   *
   *  KEY-DECISION 2026-02-20: meta:autoNamed DO Storage flag prevents re-run after DO hibernation.
   *  WHERE name = 'Untitled Board' guard means user-renamed boards are never overwritten.
   *  Claude Haiku used for naming quality; Workers AI fallback when ANTHROPIC_API_KEY absent. */
  private async _generateBoardName(boardStub: BoardStub): Promise<void> {
    // Guard: only name once per board lifetime
    const alreadyNamed = await this.ctx.storage.get<boolean>("meta:autoNamed");
    if (alreadyNamed) return;
    // Set flag immediately to prevent concurrent runs from a second message arriving
    await this.ctx.storage.put("meta:autoNamed", true);

    // Gather first 3 human messages with [username] prefixes stripped
    const humanTexts = this.messages
      .filter((m) => m.role === "user")
      .slice(0, 3)
      .map((m) => {
        const text =
          m.parts
            ?.filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("") ?? "";
        return text.replace(/^\[[^\]]+\]\s*/, ""); // strip [username] prefix
      })
      .filter((t) => t.length > 0);

    if (humanTexts.length === 0) return;

    // Canvas text: sticky notes and frame titles for scene context
    let canvasTexts: string[] = [];
    try {
      const objects = await boardStub.readObjects();
      canvasTexts = objects
        .filter((o) => (o.type === "sticky" || o.type === "frame") && !o.isBackground)
        .map((o) => (o.props as BoardObjectProps).text || "")
        .filter((t) => t.length > 0)
        .slice(0, 10);
    } catch {
      // canvas read failure - proceed without canvas context
    }

    const sceneLines = [
      `Game mode: ${this._gameMode}`,
      `Players said:\n${humanTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
      canvasTexts.length > 0 ? `Canvas: ${canvasTexts.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Cap context at 600 chars to keep naming cheap
    const namingPrompt =
      `You name improv comedy scenes. Given this scene:\n${sceneLines.slice(0, 600)}\n\n` +
      `Write ONE title (max 5 words) that:\n` +
      `- Captures THIS scene's specific absurd collision\n` +
      `- Sounds like an improv episode: "The Dentist's Garlic Problem", "Vampires Need Therapy Too"\n` +
      `- Never uses: Board, Session, Untitled, Collaborative, Improv, Scene\n` +
      `- Is funny or intriguing\n\n` +
      `Title only. No quotes. No explanation.`;

    let rawName = "";
    try {
      if (this.env.ANTHROPIC_API_KEY) {
        // Claude Haiku: cheap, much better at creative naming than Workers AI
        const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
        const result = await generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          messages: [{ role: "user" as const, content: namingPrompt }],
        });
        rawName = result.text;
      } else {
        // Workers AI fallback - quality varies by model
        const modelId = (this.env as unknown as Record<string, string>).WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash";
        const workerAi = createWorkersAI({ binding: this.env.AI as any });
        const result = await generateText({
          model: (workerAi as any)(modelId),
          messages: [{ role: "user" as const, content: namingPrompt }],
        });
        rawName = result.text;
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "board:name:gen-error", boardId: this.name, error: String(err) }));
      return;
    }

    // Sanitize: strip wrapping quotes, enforce max 8 words
    const boardName = rawName
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/\s+/)
      .slice(0, 8)
      .join(" ")
      .trim();

    if (!boardName) return;

    try {
      await this.env.DB.prepare(
        "UPDATE boards SET name = ?, updated_at = datetime('now') WHERE id = ? AND name = 'Untitled Board'",
      )
        .bind(boardName, this.name)
        .run();
      console.debug(JSON.stringify({ event: "board:named", boardId: this.name, name: boardName }));
    } catch (err) {
      console.error(JSON.stringify({ event: "board:name:db-error", boardId: this.name, error: String(err) }));
    }
  }

  // ---------------------------------------------------------------------------
  // AI Critic Review (fires once at curtain phase via ctx.waitUntil)
  // ---------------------------------------------------------------------------

  /** Generate a witty 1-5 star critic review from the scene transcript and persist to D1.
   *  Fires once via ctx.waitUntil - never blocks the AI response stream.
   *
   *  KEY-DECISION 2026-02-20: meta:criticReviewed DO Storage flag prevents re-run after hibernation.
   *  Claude Haiku used for review quality; Workers AI fallback when ANTHROPIC_API_KEY absent.
   *  Transcript capped at 2000 chars to keep the call cheap; strips [PERSONA] prefixes so the
   *  critic sees clean dialogue, not protocol noise. */
  private async _generateCriticReview(boardStub: BoardStub): Promise<void> {
    // Guard: only review once per board lifetime
    const alreadyReviewed = await this.ctx.storage.get<boolean>("meta:criticReviewed");
    if (alreadyReviewed) return;
    await this.ctx.storage.put("meta:criticReviewed", true);

    // Extract transcript: human + assistant text, strip [PERSONA] prefixes
    const transcriptLines: string[] = [];
    for (const msg of this.messages) {
      const textParts = msg.parts?.filter((p) => p.type === "text") ?? [];
      for (const p of textParts) {
        const text = (p as { type: "text"; text: string }).text
          .replace(/^\[([^\]]+)\]\s*/, "") // strip [PERSONA] prefix
          .trim();
        if (text) transcriptLines.push(`${msg.role === "user" ? "Player" : "AI"}: ${text}`);
      }
    }

    if (transcriptLines.length === 0) return;

    // Cap transcript to keep the review call cheap
    const fullTranscript = transcriptLines.join("\n");
    const transcript = fullTranscript.length > 2000 ? fullTranscript.slice(0, 2000) + "..." : fullTranscript;

    const reviewPrompt = `${CRITIC_PROMPT}\n\nSCENE TRANSCRIPT:\n${transcript}`;

    let rawResponse = "";
    let modelName = "";
    try {
      if (this.env.ANTHROPIC_API_KEY) {
        const anthropic = createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
        const result = await generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          messages: [{ role: "user" as const, content: reviewPrompt }],
        });
        rawResponse = result.text;
        modelName = "claude-haiku-4.5";
      } else {
        const modelId = (this.env as unknown as Record<string, string>).WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash";
        const workerAi = createWorkersAI({ binding: this.env.AI as any });
        const result = await generateText({
          model: (workerAi as any)(modelId),
          messages: [{ role: "user" as const, content: reviewPrompt }],
        });
        rawResponse = result.text;
        modelName = modelId.split("/").pop() || "workers-ai";
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "critic:gen-error", boardId: this.name, error: String(err) }));
      return;
    }

    // Parse SCORE: [1-5] and REVIEW: [text] from response
    const scoreMatch = rawResponse.match(/SCORE:\s*([1-5])/);
    const reviewMatch = rawResponse.match(/REVIEW:\s*(.+?)(?:\n|$)/s);

    if (!scoreMatch || !reviewMatch) {
      console.warn(JSON.stringify({ event: "critic:parse-fail", boardId: this.name, raw: rawResponse.slice(0, 200) }));
      return;
    }

    const score = parseInt(scoreMatch[1], 10);
    const review = reviewMatch[1].trim();

    if (!review) return;

    // Persist via Board DO RPC (same pattern as archiveScene)
    try {
      await (boardStub as any).saveCriticReview(review, score, modelName);
      console.debug(JSON.stringify({ event: "critic:saved", boardId: this.name, score, model: modelName }));
    } catch (err) {
      console.error(JSON.stringify({ event: "critic:save-error", boardId: this.name, error: String(err) }));
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-agent persona helpers
  // ---------------------------------------------------------------------------

  /** Ensure the last assistant message starts with [PERSONA_NAME] prefix.
   *  Only checks/patches the FIRST text part - patching all parts causes [NAME] to appear
   *  mid-text when multi-step streamText produces text before AND after tool calls.
   *  Uses immutable update + persist to avoid mutating SDK-owned objects. */
  private _ensurePersonaPrefix(personaName: string) {
    const lastMsg = this.messages[this.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    // Only check the first text part to avoid false positives on subsequent parts (e.g. "Done!")
    const firstTextPart = lastMsg.parts.find((p) => p.type === "text");
    if (!firstTextPart) {
      console.warn(
        JSON.stringify({
          event: "persona:prefix:no-text-part",
          boardId: this.name,
          persona: personaName,
        }),
      );
      return;
    }
    // Clean think/tool_call leaks from raw text and strip any wrong-persona prefix before checking
    const cleanedFirst = cleanModelOutput(firstTextPart.text).replace(/^\[([^\]]+)\]\s*/, (match, name) =>
      name === personaName ? match : "",
    );
    // Guard: if cleaning wiped the entire text (LLM emitted only reasoning, no visible content),
    // skip patching - a "[PERSONA] " placeholder is worse than leaving the message as-is.
    if (!cleanedFirst) return;
    const needsFix = !cleanedFirst.startsWith(`[${personaName}]`);
    if (!needsFix && cleanedFirst === firstTextPart.text) return; // text unchanged, nothing to do

    // Only prefix the first text part - leave subsequent parts (e.g. "Done!") untouched
    let patched = false;
    const newParts = lastMsg.parts.map((part) => {
      if (!patched && part.type === "text") {
        patched = true;
        const finalText = needsFix ? `[${personaName}] ${cleanedFirst}` : cleanedFirst;
        return { ...part, text: finalText };
      }
      return part;
    });
    this.messages[this.messages.length - 1] = { ...lastMsg, parts: newParts };
    this.ctx.waitUntil(
      this.persistMessages(this.messages).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            event: "persona:prefix:persist-error",
            boardId: this.name,
            error: String(err),
          }),
        );
      }),
    );
  }

  /** Enforce game mode rules on the last assistant message via post-processing.
   *  For Yes-And Chain mode: prepend "Yes, and " after the persona prefix if missing.
   *  Runs after _ensurePersonaPrefix so the prefix is already in place. */
  private _enforceGameModeRules(personaName: string) {
    if (this._gameMode !== "yesand") return;

    const lastMsg = this.messages[this.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const firstTextPart = lastMsg.parts.find((p) => p.type === "text");
    if (!firstTextPart) return;

    // After persona prefix, check if the response starts with "Yes, and" (case-insensitive)
    const prefix = `[${personaName}] `;
    const textAfterPrefix = firstTextPart.text.startsWith(prefix)
      ? firstTextPart.text.slice(prefix.length)
      : firstTextPart.text;

    if (/^yes,?\s+and/i.test(textAfterPrefix)) return; // already correct

    // Prepend "Yes, and " after the persona prefix
    const newText = firstTextPart.text.startsWith(prefix)
      ? `${prefix}Yes, and ${textAfterPrefix}`
      : `Yes, and ${firstTextPart.text}`;

    let patched = false;
    const newParts = lastMsg.parts.map((part) => {
      if (!patched && part.type === "text") {
        patched = true;
        return { ...part, text: newText };
      }
      return part;
    });
    this.messages[this.messages.length - 1] = { ...lastMsg, parts: newParts };
    this.ctx.waitUntil(
      this.persistMessages(this.messages).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            event: "game-mode-rules:persist-error",
            boardId: this.name,
            error: String(err),
          }),
        );
      }),
    );
  }

  /** Moderate the last assistant message against the content blocklist (streaming/chat path).
   *  Runs after _ensurePersonaPrefix and _enforceGameModeRules - mutates in-place and persists. */
  private _moderateLastMessage() {
    const lastMsg = this.messages[this.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const firstTextPart = lastMsg.parts.find((p) => p.type === "text");
    if (!firstTextPart) return;

    const moderated = moderateOutput(this.name, firstTextPart.text);
    if (moderated === firstTextPart.text) return; // no change - skip persist

    const newParts = lastMsg.parts.map((part) => (part === firstTextPart ? { ...part, text: moderated } : part));
    this.messages[this.messages.length - 1] = { ...lastMsg, parts: newParts };
    this.ctx.waitUntil(
      this.persistMessages(this.messages).catch((err: unknown) => {
        console.error(JSON.stringify({ event: "moderation:persist-error", boardId: this.name, error: String(err) }));
      }),
    );
  }

  /** Build a UIMessage from a generateText result with tool-call parts and persona-prefixed text.
   *  Returns null if the result produced no parts (no tools called, no text). */
  private _buildGenerateTextMessage(
    result: {
      text: string;
      steps: {
        toolCalls: any[];
        toolResults: { toolCallId: string; output: unknown }[];
      }[];
    },
    personaName: string,
    fallbackText?: string,
  ): UIMessage | null {
    const parts: UIMessage["parts"] = [];

    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        const tr = step.toolResults.find((r: { toolCallId: string }) => r.toolCallId === tc.toolCallId);
        const safeInput = isPlainObject(tc.input) ? tc.input : {};
        if (tr) {
          parts.push({
            type: "dynamic-tool" as const,
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            state: "output-available" as const,
            input: safeInput,
            output: tr.output,
          });
        } else {
          parts.push({
            type: "dynamic-tool" as const,
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            state: "output-error" as const,
            input: safeInput,
            errorText: "Tool execution did not return a result",
          });
        }
      }
    }

    let text: string;
    if (!result.text) {
      text = fallbackText ?? "";
    } else {
      // Clean think/tool_call leaks before prefixing (handles both display and history pollution)
      let cleaned = cleanModelOutput(result.text);
      // Strip wrong-persona prefix: reactive persona may echo the active persona's [NAME] tag
      // because the conversation history is saturated with the other persona's prefix style.
      // Replace any [NAME] prefix that doesn't match the expected persona.
      cleaned = cleaned.replace(/^\[([^\]]+)\]\s*/, (match, name) => {
        return name === personaName ? match : "";
      });
      if (cleaned.startsWith(`[${personaName}]`)) {
        text = cleaned;
      } else {
        text = cleaned ? `[${personaName}] ${cleaned}` : "";
      }
    }
    if (text) {
      parts.push({ type: "text" as const, text: moderateOutput(this.name, text) });
    }

    if (parts.length === 0) return null;

    return {
      id: crypto.randomUUID(),
      role: "assistant",
      parts,
    };
  }

  /** Summarize the last tool calls made by the active persona for reactive context injection.
   *  Returns a 1-line summary string; empty string if no tool parts found. */
  private _describeLastAction(): string {
    const lastAssistantMsg = [...this.messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistantMsg) return "";

    const summaries: string[] = [];
    const getStr = (v: unknown): string => (typeof v === "string" && v.length > 0 ? v : "");
    for (const part of lastAssistantMsg.parts) {
      const p = part as Record<string, unknown>;
      const input = isPlainObject(p.input) ? (p.input as Record<string, unknown>) : {};
      // Prefer text/title/prompt for label - skip fill (it's a hex color, not a description)
      const detail = getStr(input.text) || getStr(input.title) || getStr(input.prompt);
      // tool-* parts: produced by streamText (primary/chat path)
      if (typeof p.type === "string" && p.type.startsWith("tool-") && p.type !== "dynamic-tool") {
        summaries.push((p.type as string).replace("tool-", "") + (detail ? `: "${detail}"` : ""));
        // dynamic-tool parts: produced by generateText (_buildGenerateTextMessage / director nudge path)
      } else if (p.type === "dynamic-tool" && typeof p.toolName === "string") {
        summaries.push(p.toolName + (detail ? `: "${detail}"` : ""));
      }
    }
    return summaries.slice(0, 3).join(", ");
  }

  /** After the active persona finishes, trigger the other persona to react.
   *  KEY-DECISION 2026-02-19: Claims _isGenerating mutex BEFORE the 2s UX delay to prevent
   *  TOCTOU races (human message arriving between check and claim would cause concurrent generation). */
  private async _triggerReactivePersona(activeIndex: number, personas?: Persona[]) {
    // Guard: scene budget exhausted - no reactive exchanges after scene ends
    const reactiveHumanTurns = this.messages.filter((m) => m.role === "user").length;
    if (computeBudgetPhase(reactiveHumanTurns, SCENE_TURN_BUDGET) === "scene-over") {
      console.debug(
        JSON.stringify({
          event: "reactive:skip",
          reason: "scene-over",
          boardId: this.name,
        }),
      );
      return;
    }

    // Guard: cooldown exceeded (check before claiming mutex)
    if (this._autonomousExchangeCount >= MAX_AUTONOMOUS_EXCHANGES) {
      console.debug(
        JSON.stringify({
          event: "reactive:skip",
          reason: "cooldown",
          boardId: this.name,
        }),
      );
      return;
    }

    // Guard: already generating (human message or concurrent caller)
    if (this._isGenerating) {
      console.debug(
        JSON.stringify({
          event: "reactive:skip",
          reason: "busy",
          boardId: this.name,
        }),
      );
      return;
    }

    // Guard: need at least one assistant message to react to
    if (!this.messages.some((m) => m.role === "assistant")) {
      console.debug(
        JSON.stringify({
          event: "reactive:skip",
          reason: "no-assistant-message",
          boardId: this.name,
        }),
      );
      return;
    }

    // Claim mutex BEFORE the delay to prevent TOCTOU races
    this._isGenerating = true;
    this._autonomousExchangeCount++;

    // UX delay - let the active persona's message settle before the reaction
    await new Promise((r) => setTimeout(r, 2000));

    // Re-check: human may have interrupted during the delay (onChatMessage resets count)
    if (this._autonomousExchangeCount === 0) {
      this._isGenerating = false;
      console.debug(
        JSON.stringify({
          event: "reactive:skip",
          reason: "human-interrupted",
          boardId: this.name,
        }),
      );
      return;
    }

    // Load personas if not passed in (director nudge path).
    // Guard: _getPersonas() is documented to never throw, but wrap anyway -
    // any unexpected throw here would leave _isGenerating stuck at true for the DO lifetime.
    let effectivePersonas: Persona[];
    try {
      effectivePersonas = personas ?? (await this._getPersonas());
    } catch (err) {
      this._isGenerating = false;
      console.error(
        JSON.stringify({
          event: "reactive:personas-error",
          boardId: this.name,
          error: String(err),
        }),
      );
      return;
    }
    // Skip reactive if only 1 persona (can't react to yourself)
    if (effectivePersonas.length <= 1) {
      this._isGenerating = false;
      console.debug(
        JSON.stringify({
          event: "reactive:skip",
          reason: "single-persona",
          boardId: this.name,
        }),
      );
      return;
    }
    const boundActive = activeIndex % effectivePersonas.length;
    const reactiveIndex = (boundActive + 1) % effectivePersonas.length;
    const reactivePersona = effectivePersonas[reactiveIndex];
    const activePersona = effectivePersonas[boundActive];
    const startTime = Date.now();
    this._logRequestStart("reactive", reactivePersona.name);

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI, this.ctx.storage);

    // Pass the same game mode block to the reactive persona
    const reactiveGameModeState: GameModeState = {
      hatPrompt: this._hatPromptIndex >= 0 ? HAT_PROMPTS[this._hatPromptIndex] : undefined,
      hatExchangeCount: this._hatExchangeCount,
      hatPromptOffset: Math.min(50 + this._hatPromptCount * 600, 650),
      yesAndCount: this._yesAndCount,
    };
    const reactiveGameModeBlock = buildGameModePromptBlock(this._gameMode, reactiveGameModeState);

    // Extract what the active persona just created for context injection
    const lastActionSummary = this._describeLastAction();

    // Load scene relationships for reactive persona context
    const reactiveRelationships =
      (await this.ctx.storage.get<CharacterRelationship[]>("narrative:relationships")) ?? [];
    const reactiveRelBlock = buildRelationshipBlock(reactiveRelationships);

    // Load lifecycle phase for reactive persona (same storage key)
    const reactiveStoredPhase = await this.ctx.storage.get<SceneLifecyclePhase>("scene:lifecyclePhase");
    const reactiveLifecyclePhase = computeLifecyclePhase(
      this.messages.filter((m) => m.role === "user").length,
      reactiveStoredPhase ?? undefined,
    );

    const reactiveLifecycleBlock = this._gameMode !== "hat" ? `\n\n${buildLifecycleBlock(reactiveLifecyclePhase)}` : "";
    const reactiveSystem =
      buildPersonaSystemPrompt(reactivePersona, activePersona, SYSTEM_PROMPT, reactiveGameModeBlock, reactiveRelBlock) +
      reactiveLifecycleBlock +
      `\n\n[REACTIVE MODE] ${activePersona.name} just placed: ${lastActionSummary || "objects on the canvas"}. ` +
      `React in character with exactly 1 spoken sentence (required - always produce text). ` +
      `Optionally place 1 canvas object that BUILDS on theirs (same area, related content) - do NOT use batchExecute.`;

    const reactiveScenePhase = computeScenePhase(this.messages.filter((m) => m.role === "user").length);
    const model = this._getTracedModel("reactive", reactivePersona.name, {
      gameMode: this._gameMode,
      scenePhase: reactiveScenePhase,
    });

    // Show AI presence while generating
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(
        JSON.stringify({
          event: "ai:presence:start-error",
          trigger: "reactive",
          error: String(err),
        }),
      );
    });

    try {
      const { messages: sanitizedMsgs, repairedCount } = sanitizeMessages(this.messages);
      if (repairedCount > 0) this._traceSanitizeRepair("reactive", repairedCount);
      const result = await generateText({
        model,
        system: reactiveSystem,
        messages: await convertToModelMessages(sanitizedMsgs),
        tools,
        stopWhen: stepCountIs(2),
      });

      // Build and persist UIMessage from generateText result
      const reactiveMessage = this._buildGenerateTextMessage(
        result,
        reactivePersona.name,
        `[${reactivePersona.name}] ...`,
      );
      if (reactiveMessage) {
        this.messages.push(reactiveMessage);
        await this.persistMessages(this.messages);
      }

      const totalToolCalls = result.steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
      this._logRequestEnd("reactive", reactivePersona.name, startTime, result.steps.length, totalToolCalls);
      this._traceToolFailures("reactive", result.steps as any[]);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "reactive:error",
          boardId: this.name,
          persona: reactivePersona.name,
          autonomousExchangeCount: this._autonomousExchangeCount,
          error: String(err),
          // Include stack trace to distinguish programming bugs from transient AI/network errors
          stack: err instanceof Error ? err.stack : undefined,
        }),
      );
    } finally {
      // Toggle persona regardless of success/failure - prevents getting stuck
      this._activePersonaIndex = reactiveIndex;
      this._isGenerating = false;
      await boardStub.setAiPresence(false).catch((err: unknown) => {
        console.debug(
          JSON.stringify({
            event: "ai:presence:cleanup-error",
            trigger: "reactive",
            error: String(err),
          }),
        );
      });
    }
  }

  // ---------------------------------------------------------------------------
  // AI Director - proactive scene complications after inactivity
  // ---------------------------------------------------------------------------

  /** Cancel existing director schedule and set a new 60s timer */
  private _resetDirectorTimer() {
    this.ctx.waitUntil(
      (async () => {
        try {
          // Cancel any existing director nudge schedules
          const existing = this.getSchedules({ type: "delayed" });
          for (const s of existing) {
            if (s.callback === "onDirectorNudge") {
              await this.cancelSchedule(s.id);
            }
          }
          // Only schedule if there's an active scene (messages exist)
          if (this.messages.length > 0) {
            await this.schedule(60, "onDirectorNudge" as keyof this);
            console.debug(
              JSON.stringify({
                event: "director:timer-set",
                boardId: this.name,
                delaySeconds: 60,
              }),
            );
          }
        } catch (err) {
          console.warn(
            JSON.stringify({
              event: "director:timer-error",
              boardId: this.name,
              error: String(err),
            }),
          );
        }
      })(),
    );
  }

  // ---------------------------------------------------------------------------
  // Auto-director - canvas action RPC stub (T2 implements reaction engine)
  // ---------------------------------------------------------------------------

  /** Receives canvas mutation notifications from Board DO after each player action.
   *  Buffers significant actions and resets the 5s debounce timer.
   *  Non-significant actions (position drags) reset the timer without buffering,
   *  preventing reactions from firing mid-drag. */
  async onCanvasAction(action: CanvasAction): Promise<void> {
    console.debug(
      JSON.stringify({
        event: "canvas-action:received",
        boardId: this.name,
        type: action.type,
        userId: action.userId,
        username: action.username,
        objectId: action.objectId,
        objectType: action.objectType,
        significant: action.significant,
        ts: action.ts,
      }),
    );

    // Buffer significant actions for interest scoring (position drags are not significant)
    if (action.significant) {
      this._pendingCanvasActions.push(action);
    }

    // Reset the 5s canvas-reaction timer on ALL actions (including non-significant drags).
    // KEY-DECISION 2026-02-20: Cancel-then-reschedule on every action so drag repositioning
    // suppresses the reaction timer. Players dragging should not trigger canvas reactions.
    // Timer is only rescheduled if there are buffered significant actions to react to.
    try {
      const existing = this.getSchedules({ type: "delayed" });
      for (const s of existing) {
        if (s.callback === "onCanvasReaction") {
          await this.cancelSchedule(s.id);
        }
      }
      if (this.messages.length > 0 && this._pendingCanvasActions.length > 0) {
        await this.schedule(5, "onCanvasReaction" as keyof this);
        console.debug(
          JSON.stringify({
            event: "canvas-action:timer-set",
            boardId: this.name,
            pendingCount: this._pendingCanvasActions.length,
            delaySeconds: 5,
          }),
        );
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "canvas-action:timer-error",
          boardId: this.name,
          error: String(err),
        }),
      );
    }
  }

  /** Called by DO schedule after 5s of player idle - reacts to recent canvas mutations in character.
   *  Drains the pending action buffer, scores interest level, and generates a reaction if the
   *  scene warrants it. Guards prevent reactions during active generation or chat. */
  async onCanvasReaction(_payload: unknown, currentSchedule?: { id: string }) {
    // Guard: skip if a newer canvas-reaction schedule exists (this one is stale).
    // KEY-DECISION 2026-02-20: Check newer-timer BEFORE draining buffer - if a newer schedule
    // exists, we preserve the buffer for it (draining would leave the newer schedule empty).
    const allSchedules = this.getSchedules({ type: "delayed" });
    const hasPending = allSchedules.some((s) => s.callback === "onCanvasReaction" && s.id !== currentSchedule?.id);
    if (hasPending) {
      console.debug(JSON.stringify({ event: "canvas-reaction:skip", reason: "newer-timer", boardId: this.name }));
      return;
    }

    // Drain buffer (always, once we've confirmed we're the active timer)
    const actions = this._pendingCanvasActions;
    this._pendingCanvasActions = [];

    // Guard 1: empty buffer
    if (actions.length === 0) {
      console.debug(JSON.stringify({ event: "canvas-reaction:skip", reason: "empty-buffer", boardId: this.name }));
      return;
    }

    // Guard 2: another AI generation in progress
    if (this._isGenerating) {
      console.debug(JSON.stringify({ event: "canvas-reaction:skip", reason: "generating", boardId: this.name }));
      return;
    }

    // Guard 3: cooldown active (30s between canvas reactions)
    const now = Date.now();
    if (now < this._canvasReactionCooldownUntil) {
      console.debug(
        JSON.stringify({
          event: "canvas-reaction:skip",
          reason: "cooldown",
          boardId: this.name,
          cooldownRemainingMs: this._canvasReactionCooldownUntil - now,
        }),
      );
      return;
    }

    // Guard 4: no scene started yet
    if (this.messages.length === 0) {
      console.debug(JSON.stringify({ event: "canvas-reaction:skip", reason: "no-messages", boardId: this.name }));
      return;
    }

    // Guard 5: scene budget exhausted
    const humanTurns = this.messages.filter((m) => m.role === "user").length;
    if (computeBudgetPhase(humanTurns, SCENE_TURN_BUDGET) === "scene-over") {
      console.debug(JSON.stringify({ event: "canvas-reaction:skip", reason: "scene-over", boardId: this.name }));
      return;
    }

    // Guard 6: player sent a chat message in the last 10s (they're engaged in chat, not just placing objects)
    if (now - this._lastHumanMessageAt < 10_000) {
      console.debug(
        JSON.stringify({
          event: "canvas-reaction:skip",
          reason: "recent-chat",
          boardId: this.name,
          msSinceChat: now - this._lastHumanMessageAt,
        }),
      );
      return;
    }

    // Interest scoring - only react if the buffered actions are sufficiently interesting
    let score = 0;
    for (const a of actions) {
      if (a.type === "obj:create") {
        score += a.objectType === "person" || a.objectType === "frame" || a.objectType === "sticky" ? 2 : 1;
      } else if (a.type === "obj:delete") {
        score += 1;
      } else if (a.type === "obj:update" && a.text) {
        score += 1;
      }
    }

    console.debug(
      JSON.stringify({
        event: "canvas-reaction:evaluate",
        boardId: this.name,
        score,
        actionCount: actions.length,
        threshold: 2,
      }),
    );

    if (score < 2) {
      console.debug(
        JSON.stringify({ event: "canvas-reaction:skip", reason: "low-interest", boardId: this.name, score }),
      );
      return;
    }

    // React!
    this._isGenerating = true;
    const startTime = Date.now();
    const reactionPersonas = await this._getPersonas();
    const reactionIndex = this._activePersonaIndex % reactionPersonas.length;
    const reactionPersona = reactionPersonas[reactionIndex];
    const reactionOther =
      reactionPersonas.length > 1 ? reactionPersonas[(reactionIndex + 1) % reactionPersonas.length] : undefined;

    this._logRequestStart("canvas-action", reactionPersona.name, { actionCount: actions.length, score });

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI, this.ctx.storage);

    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(JSON.stringify({ event: "ai:presence:start-error", trigger: "canvas-action", error: String(err) }));
    });

    let didReact = false;
    try {
      const relationships = (await this.ctx.storage.get<CharacterRelationship[]>("narrative:relationships")) ?? [];
      const relBlock = buildRelationshipBlock(relationships);

      const gameModeState: GameModeState = {
        hatPrompt: this._hatPromptIndex >= 0 ? HAT_PROMPTS[this._hatPromptIndex] : undefined,
        hatExchangeCount: this._hatExchangeCount,
        hatPromptOffset: Math.min(50 + this._hatPromptCount * 600, 650),
        yesAndCount: this._yesAndCount,
      };
      const gameModeBlock = buildGameModePromptBlock(this._gameMode, gameModeState);

      const storedPhase = await this.ctx.storage.get<SceneLifecyclePhase>("scene:lifecyclePhase");
      const lifecyclePhase = computeLifecyclePhase(humanTurns, storedPhase ?? undefined);
      const lifecycleBlock = this._gameMode !== "hat" ? `\n\n${buildLifecycleBlock(lifecyclePhase)}` : "";

      const canvasReactionSystem =
        buildPersonaSystemPrompt(reactionPersona, reactionOther, SYSTEM_PROMPT, gameModeBlock, relBlock) +
        lifecycleBlock +
        `\n\n${buildCanvasReactionPrompt(actions)}`;

      const { messages: sanitizedMsgs, repairedCount } = sanitizeMessages(this.messages);
      if (repairedCount > 0) this._traceSanitizeRepair("canvas-action", repairedCount);

      const result = await generateText({
        model: this._getTracedModel("canvas-action", reactionPersona.name, { gameMode: this._gameMode }),
        system: canvasReactionSystem,
        messages: await convertToModelMessages(sanitizedMsgs),
        tools,
        stopWhen: stepCountIs(2),
      });

      const reactionMessage = this._buildGenerateTextMessage(
        result,
        reactionPersona.name,
        `[${reactionPersona.name}] ...`,
      );
      if (reactionMessage) {
        this.messages.push(reactionMessage);
        await this.persistMessages(this.messages);
      }

      const totalToolCalls = result.steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
      this._logRequestEnd("canvas-action", reactionPersona.name, startTime, result.steps.length, totalToolCalls, {
        score,
        actionCount: actions.length,
      });
      this._traceToolFailures("canvas-action", result.steps as any[]);

      // Set 30s cooldown to prevent back-to-back canvas reactions
      this._canvasReactionCooldownUntil = Date.now() + 30_000;
      didReact = true;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "canvas-reaction:error",
          boardId: this.name,
          persona: reactionPersona.name,
          score,
          error: String(err),
        }),
      );
    } finally {
      this._isGenerating = false;
      await boardStub.setAiPresence(false).catch((err: unknown) => {
        console.debug(
          JSON.stringify({ event: "ai:presence:cleanup-error", trigger: "canvas-action", error: String(err) }),
        );
      });
    }

    if (didReact) {
      // Reset director timer (AI just acted - restart 60s inactivity window)
      this._resetDirectorTimer();
      // Trigger reactive persona cascade (same pattern as onChatMessage wrappedOnFinish)
      // Called AFTER _isGenerating = false so _triggerReactivePersona's busy guard passes
      this._autonomousExchangeCount++;
      this.ctx.waitUntil(
        this._triggerReactivePersona(reactionIndex, reactionPersonas).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "reactive:unhandled", boardId: this.name, error: String(err) }));
        }),
      );
    }
  }

  /** Called by DO alarm after 60s of inactivity - generates a proactive scene complication */
  async onDirectorNudge(_payload: unknown, currentSchedule?: { id: string }) {
    // Guard: skip if another timer was set after this one fired
    // Note: the SDK deletes the schedule row AFTER the callback returns,
    // so we must exclude the currently-executing schedule by ID
    const lastSchedules = this.getSchedules({ type: "delayed" });
    const hasPending = lastSchedules.some((s) => s.callback === "onDirectorNudge" && s.id !== currentSchedule?.id);
    if (hasPending) {
      console.debug(
        JSON.stringify({
          event: "director:skip",
          reason: "newer-timer",
          boardId: this.name,
        }),
      );
      return;
    }

    // Guard: skip if AI is already generating a response
    if (this._isGenerating) {
      console.debug(
        JSON.stringify({
          event: "director:skip",
          reason: "generating",
          boardId: this.name,
        }),
      );
      return;
    }

    // Guard: skip if no scene started
    if (this.messages.length === 0) {
      console.debug(
        JSON.stringify({
          event: "director:skip",
          reason: "no-messages",
          boardId: this.name,
        }),
      );
      return;
    }

    // Guard: skip if scene budget exhausted - don't nudge a completed scene
    const directorHumanTurns = this.messages.filter((m) => m.role === "user").length;
    const directorBudget = computeBudgetPhase(directorHumanTurns, SCENE_TURN_BUDGET);
    if (directorBudget === "scene-over") {
      console.debug(
        JSON.stringify({
          event: "director:skip",
          reason: "scene-over",
          boardId: this.name,
          humanTurns: directorHumanTurns,
        }),
      );
      return;
    }

    this._isGenerating = true;
    const startTime = Date.now();
    const directorPersonas = await this._getPersonas();
    const directorIndex = this._activePersonaIndex % directorPersonas.length;
    const directorPersona = directorPersonas[directorIndex];
    const directorOther =
      directorPersonas.length > 1 ? directorPersonas[(directorIndex + 1) % directorPersonas.length] : undefined;

    // Determine scene phase from user message count
    const userMessageCount = directorHumanTurns;
    const phase = computeScenePhase(userMessageCount);
    this._logRequestStart("director", directorPersona.name, {
      messageCount: this.messages.length,
      budgetPhase: directorBudget,
    });

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI, this.ctx.storage);

    // Show AI presence while generating
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(
        JSON.stringify({
          event: "ai:presence:start-error",
          trigger: "director",
          error: String(err),
        }),
      );
    });

    try {
      // Build game mode block for director
      const directorGameModeState: GameModeState = {
        hatPrompt: this._hatPromptIndex >= 0 ? HAT_PROMPTS[this._hatPromptIndex] : undefined,
        hatExchangeCount: this._hatExchangeCount,
        hatPromptOffset: Math.min(50 + this._hatPromptCount * 600, 650),
        yesAndCount: this._yesAndCount,
      };
      const directorGameModeBlock = buildGameModePromptBlock(this._gameMode, directorGameModeState);

      // Mode-specific director instructions
      let directorInstructions: string;
      if (this._gameMode === "hat") {
        const hatKey = this._hatExchangeCount >= 5 ? "wrapup" : "active";
        directorInstructions = DIRECTOR_PROMPTS_HAT[hatKey];
      } else if (this._gameMode === "yesand") {
        const yesandKey = this._yesAndCount >= 10 ? "wrapup" : "active";
        directorInstructions = DIRECTOR_PROMPTS_YESAND[yesandKey];
      } else {
        directorInstructions = `Current scene phase: ${phase.toUpperCase()}. ` + DIRECTOR_PROMPTS[phase];
      }

      // Load scene relationships for director context
      const directorRelationships =
        (await this.ctx.storage.get<CharacterRelationship[]>("narrative:relationships")) ?? [];
      const directorRelBlock = buildRelationshipBlock(directorRelationships);

      // Load lifecycle phase for director (auto-computed from user message count)
      const directorStoredPhase = await this.ctx.storage.get<SceneLifecyclePhase>("scene:lifecyclePhase");
      const directorLifecyclePhase = computeLifecyclePhase(directorHumanTurns, directorStoredPhase ?? undefined);
      const directorLifecycleBlock =
        this._gameMode !== "hat" ? `\n\n${buildLifecycleBlock(directorLifecyclePhase)}` : "";

      // Director nudge uses the active persona's voice + budget-aware prompts
      let directorSystem =
        buildPersonaSystemPrompt(
          directorPersona,
          directorOther,
          SYSTEM_PROMPT,
          directorGameModeBlock,
          directorRelBlock,
        ) +
        directorLifecycleBlock +
        `\n\n[DIRECTOR MODE] You are the scene director. The players have been quiet for a while. ` +
        directorInstructions +
        `\n\nAct NOW - add something to the canvas to restart momentum. ` +
        `Keep your chat response to 1 sentence max, something provocative that invites players to react.`;
      if (directorBudget !== "normal") {
        directorSystem += `\n\n${BUDGET_PROMPTS[directorBudget]}`;
      }

      const { messages: sanitizedMsgs, repairedCount } = sanitizeMessages(this.messages);
      if (repairedCount > 0) this._traceSanitizeRepair("director", repairedCount);
      const result = await generateText({
        model: this._getTracedModel("director", directorPersona.name, {
          gameMode: this._gameMode,
          scenePhase: phase,
        }),
        system: directorSystem,
        messages: await convertToModelMessages(sanitizedMsgs),
        tools,
        stopWhen: stepCountIs(3),
      });

      // Build and persist UIMessage from generateText result
      const directorMessage = this._buildGenerateTextMessage(result, directorPersona.name);
      if (directorMessage) {
        this.messages.push(directorMessage);
        await this.persistMessages(this.messages);
      }

      const totalToolCalls = result.steps.reduce((sum, s) => sum + s.toolCalls.length, 0);
      this._logRequestEnd("director", directorPersona.name, startTime, result.steps.length, totalToolCalls, { phase });
      this._traceToolFailures("director", result.steps as any[]);

      // Director nudge also triggers the other persona to react
      // Pass directorPersonas to avoid a redundant second D1 query
      this._autonomousExchangeCount++;
      this.ctx.waitUntil(
        this._triggerReactivePersona(directorIndex, directorPersonas).catch((err: unknown) => {
          console.error(
            JSON.stringify({
              event: "reactive:unhandled",
              boardId: this.name,
              error: String(err),
            }),
          );
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "director:nudge-error",
          boardId: this.name,
          persona: directorPersona.name,
          phase,
          error: String(err),
        }),
      );
    } finally {
      this._isGenerating = false;
      await boardStub.setAiPresence(false).catch((err: unknown) => {
        console.debug(
          JSON.stringify({
            event: "ai:presence:cleanup-error",
            trigger: "director",
            error: String(err),
          }),
        );
      });
    }
  }
}
