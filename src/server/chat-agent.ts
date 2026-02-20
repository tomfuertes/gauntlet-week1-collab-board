import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createSDKTools, isPlainObject, rectsOverlap } from "./ai-tools-sdk";
import { createTracingMiddleware, wrapLanguageModel, Langfuse } from "./tracing-middleware";
import {
  SYSTEM_PROMPT,
  DIRECTOR_PROMPTS,
  DIRECTOR_PROMPTS_HAT,
  DIRECTOR_PROMPTS_YESAND,
  PROMPT_VERSION,
  computeScenePhase,
  MAX_AUTONOMOUS_EXCHANGES,
  buildPersonaSystemPrompt,
  computeBudgetPhase,
  BUDGET_PROMPTS,
  buildGameModePromptBlock,
} from "./prompts";
import type { GameModeState } from "./prompts";
import { HAT_PROMPTS, getRandomHatPrompt } from "./hat-prompts";
import type { Bindings } from "./env";
import { recordBoardActivity } from "./env";
import type { BoardObject, BoardObjectProps, GameMode, Persona } from "../shared/types";
import { SCENE_TURN_BUDGET, DEFAULT_PERSONAS, AI_MODELS } from "../shared/types";

/**
 * Sanitize UIMessages to ensure all tool invocation inputs are valid objects.
 * Some LLMs (especially smaller ones) sometimes emit tool calls with string,
 * null, or array inputs instead of JSON objects. This causes API validation
 * errors ("Input should be a valid dictionary") when the conversation history
 * is sent back to the model on subsequent turns.
 */
function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
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

    if (needsRepair) return { ...msg, parts: cleanedParts };
    return msg;
  });
}

export class ChatAgent extends AIChatAgent<Bindings> {
  /* eslint-disable @typescript-eslint/no-explicit-any */

  // Lightweight mutex: prevents concurrent AI generation (chat + director).
  // Do NOT replace with _activeStreamId - it's unreliable after DO hibernation.
  // (ResumableStream.restore() picks up stale stream metadata with a 5-min threshold,
  // causing false positives that permanently block director nudges on prod.)
  private _isGenerating = false;

  // Multi-agent persona state (resets on DO hibernation - that's fine, defaults work)
  private _activePersonaIndex = 0; // which persona responds to the next human message
  private _autonomousExchangeCount = 0; // consecutive autonomous exchanges (reset on human msg)

  // Game mode state (resets on DO hibernation - client re-sends gameMode on each message)
  private _gameMode: GameMode = "freeform";
  private _hatPromptIndex = -1;
  private _hatExchangeCount = 0;
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
   *  Wraps the base model with D1 + Langfuse tracing middleware that captures
   *  system prompt, token usage, and tool calls for each request. */
  private _getTracedModel(trigger: string, persona: string) {
    return wrapLanguageModel({
      model: this._getModel(),
      middleware: createTracingMiddleware(
        this.env.DB,
        {
          boardId: this.name,
          trigger,
          persona,
          model: this._getModelName(),
          promptVersion: PROMPT_VERSION,
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
    const startTime = Date.now();
    const personas = await this._getPersonas();
    const activeIndex = this._activePersonaIndex % personas.length;
    const activePersona = personas[activeIndex];
    const otherPersona = personas.length > 1 ? personas[(activeIndex + 1) % personas.length] : undefined;
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

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

    // Update game mode from client (sent on every message so it survives DO hibernation)
    if (body?.gameMode && ["hat", "yesand", "freeform"].includes(body.gameMode)) {
      this._gameMode = body.gameMode as GameMode;
    }

    // Update requested model from client (sent on every message so it survives DO hibernation)
    if (body?.model && AI_MODELS.some((m) => m.id === body.model)) {
      this._requestedModel = body.model as string;
    }

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
      } else if (this._hatPromptIndex === -1) {
        // First message in hat mode - pick initial prompt
        const pick = getRandomHatPrompt();
        this._hatPromptIndex = pick.index;
        this._hatExchangeCount = 0;
      }
      this._hatExchangeCount++;
    }

    // Track yes-and beat count
    if (this._gameMode === "yesand") {
      this._yesAndCount++;
    }

    // Build game mode prompt block
    const gameModeState: GameModeState = {
      hatPrompt: this._hatPromptIndex >= 0 ? HAT_PROMPTS[this._hatPromptIndex] : undefined,
      hatExchangeCount: this._hatExchangeCount,
      yesAndCount: this._yesAndCount,
    };
    const gameModeBlock = buildGameModePromptBlock(this._gameMode, gameModeState);

    // Build persona-aware system prompt with optional selection + multiplayer context
    let systemPrompt = buildPersonaSystemPrompt(activePersona, otherPersona, SYSTEM_PROMPT, gameModeBlock);

    // Inject budget phase prompt when not in normal phase
    if (budgetPhase !== "normal") {
      systemPrompt += `\n\n${BUDGET_PROMPTS[budgetPhase]}`;
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
      const finishArg = args[0] as { steps?: { toolCalls?: unknown[] }[] } | undefined;
      const steps = finishArg?.steps?.length ?? 0;
      const toolCalls =
        finishArg?.steps?.reduce((sum: number, s: { toolCalls?: unknown[] }) => sum + (s.toolCalls?.length ?? 0), 0) ??
        0;
      this._logRequestEnd("chat", activePersona.name, startTime, steps, toolCalls);

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
      const result = streamText({
        model: this._getTracedModel("chat", activePersona.name),
        system: systemPrompt,
        messages: await convertToModelMessages(sanitizeMessages(this.messages)),
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
    const needsFix = !!firstTextPart && !firstTextPart.text.startsWith(`[${personaName}]`);
    if (!needsFix) {
      if (!firstTextPart) {
        console.warn(
          JSON.stringify({
            event: "persona:prefix:no-text-part",
            boardId: this.name,
            persona: personaName,
          }),
        );
      }
      return;
    }

    // Only prefix the first text part - leave subsequent parts (e.g. "Done!") untouched
    let patched = false;
    const newParts = lastMsg.parts.map((part) => {
      if (!patched && part.type === "text" && !part.text.startsWith(`[${personaName}]`)) {
        patched = true;
        return { ...part, text: `[${personaName}] ${part.text}` };
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
    } else if (result.text.startsWith(`[${personaName}]`)) {
      text = result.text;
    } else {
      text = `[${personaName}] ${result.text}`;
    }
    if (text) {
      parts.push({ type: "text" as const, text });
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
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

    // Pass the same game mode block to the reactive persona
    const reactiveGameModeState: GameModeState = {
      hatPrompt: this._hatPromptIndex >= 0 ? HAT_PROMPTS[this._hatPromptIndex] : undefined,
      hatExchangeCount: this._hatExchangeCount,
      yesAndCount: this._yesAndCount,
    };
    const reactiveGameModeBlock = buildGameModePromptBlock(this._gameMode, reactiveGameModeState);

    // Extract what the active persona just created for context injection
    const lastActionSummary = this._describeLastAction();

    const reactiveSystem =
      buildPersonaSystemPrompt(reactivePersona, activePersona, SYSTEM_PROMPT, reactiveGameModeBlock) +
      `\n\n[REACTIVE MODE] ${activePersona.name} just placed: ${lastActionSummary || "objects on the canvas"}. ` +
      `React in character with exactly 1 spoken sentence (required - always produce text). ` +
      `Optionally place 1 canvas object that BUILDS on theirs (same area, related content) - do NOT use batchExecute.`;

    const model = this._getTracedModel("reactive", reactivePersona.name);

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
      const result = await generateText({
        model,
        system: reactiveSystem,
        messages: await convertToModelMessages(sanitizeMessages(this.messages)),
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
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

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

      // Director nudge uses the active persona's voice + budget-aware prompts
      let directorSystem =
        buildPersonaSystemPrompt(directorPersona, directorOther, SYSTEM_PROMPT, directorGameModeBlock) +
        `\n\n[DIRECTOR MODE] You are the scene director. The players have been quiet for a while. ` +
        directorInstructions +
        `\n\nAct NOW - add something to the canvas to restart momentum. ` +
        `Keep your chat response to 1 sentence max, something provocative that invites players to react.`;
      if (directorBudget !== "normal") {
        directorSystem += `\n\n${BUDGET_PROMPTS[directorBudget]}`;
      }

      const result = await generateText({
        model: this._getTracedModel("director", directorPersona.name),
        system: directorSystem,
        messages: await convertToModelMessages(sanitizeMessages(this.messages)),
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
