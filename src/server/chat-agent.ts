import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import type { UIMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createSDKTools, isPlainObject } from "./ai-tools-sdk";
import {
  SYSTEM_PROMPT,
  DIRECTOR_PROMPTS,
  PROMPT_VERSION,
  computeScenePhase,
} from "./prompts";
import type { Bindings } from "./env";
import { recordBoardActivity } from "./env";
import type { BoardObject } from "../shared/types";

/**
 * Sanitize UIMessages to ensure all tool invocation inputs are valid objects.
 * Free-tier LLMs (e.g., GLM-4.7-Flash) sometimes emit tool calls with string,
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
            inputType:
              p.input === null
                ? "null"
                : Array.isArray(p.input)
                  ? "array"
                  : typeof p.input,
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
            inputType:
              p.input === null
                ? "null"
                : Array.isArray(p.input)
                  ? "array"
                  : typeof p.input,
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

  /** Returns both the model instance and its display name for logging */
  private _getModelInfo(): { model: any; name: string } {
    if (this.env.ANTHROPIC_API_KEY) {
      return {
        model: createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY })("claude-haiku-4-5-20251001"),
        name: "claude-haiku-4-5",
      };
    }
    return {
      model: (createWorkersAI({ binding: this.env.AI }) as any)("@cf/zai-org/glm-4.7-flash"),
      name: "glm-4.7-flash",
    };
  }

  /** Log AI request start with structured fields */
  private _logRequestStart(trigger: string, extras?: Record<string, unknown>): void {
    const { name: modelName } = this._getModelInfo();
    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger,
        ...extras,
      }),
    );
  }

  /** Log AI request end with timing and tool call counts */
  private _logRequestEnd(
    trigger: string,
    startTime: number,
    steps: number,
    toolCalls: number,
    extras?: Record<string, unknown>,
  ): void {
    const { name: modelName } = this._getModelInfo();
    const durationMs = Date.now() - startTime;
    console.debug(
      JSON.stringify({
        event: "ai:request:end",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger,
        steps,
        toolCalls,
        durationMs,
        ...extras,
      }),
    );
  }

  /** Build a UIMessage from a generateText result (used by director nudge) */
  private _buildDirectorMessage(result: any): UIMessage | null {
    const parts: UIMessage["parts"] = [];

    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        const tr = step.toolResults.find(
          (r: { toolCallId: string }) => r.toolCallId === tc.toolCallId,
        );
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

    if (result.text) {
      parts.push({ type: "text" as const, text: result.text });
    }

    if (parts.length === 0) return null;

    return {
      id: crypto.randomUUID(),
      role: "assistant",
      parts,
    };
  }

  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // this.name = boardId (set by client connecting to /agents/ChatAgent/<boardId>)
    this._isGenerating = true;
    const startTime = Date.now();
    const { model } = this._getModelInfo();

    this._logRequestStart("chat");

    // Record chat activity for async notifications (non-blocking)
    this.ctx.waitUntil(
      recordBoardActivity(this.env.DB, this.name).catch((err: unknown) => {
        console.error(JSON.stringify({ event: "activity:record", trigger: "chat", error: String(err) }));
      }),
    );

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

    // Build system prompt with optional selection + multiplayer context
    let systemPrompt = SYSTEM_PROMPT;
    const body =
      options && "body" in options ? (options as any).body : undefined;

    // Multiplayer attribution: tell the AI who is speaking
    if (body?.username) {
      systemPrompt += `\n\nThis is a multiplayer board. Messages from users are prefixed with [username]. The current speaker is ${body.username}. Address users by name when relevant.`;
    }

    if (body?.selectedIds?.length) {
      const objects = await boardStub.readObjects();
      const selected = (objects as BoardObject[]).filter((o: BoardObject) =>
        body.selectedIds.includes(o.id),
      );
      if (selected.length > 0) {
        const desc = selected
          .map(
            (o: BoardObject) =>
              `- ${o.type} (id: ${o.id}${o.props.text ? `, text: "${o.props.text}"` : ""})`,
          )
          .join("\n");
        systemPrompt += `\n\nThe user has selected ${selected.length} object(s) on the board:\n${desc}\nWhen the user refers to "selected", "these", or "this", they mean the above objects. Use their IDs directly.`;
      }
    }

    // Show AI in presence bar while responding (best-effort, never blocks AI response)
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(JSON.stringify({ event: "ai:presence:start-error", error: String(err) }));
    });

    let presenceCleared = false;
    const clearPresence = async () => {
      if (presenceCleared) return;
      presenceCleared = true;
      try {
        await boardStub.setAiPresence(false);
      } catch (err) {
        console.debug(JSON.stringify({ event: "ai:presence:cleanup-error", error: String(err) }));
      }
    };

    const wrappedOnFinish: typeof onFinish = async (...args: Parameters<typeof onFinish>) => {
      this._isGenerating = false;
      await clearPresence();

      // Request-level metrics from onFinish
      const finishArg = args[0] as { steps?: { toolCalls?: unknown[] }[] } | undefined;
      const steps = finishArg?.steps?.length ?? 0;
      const toolCalls = finishArg?.steps?.reduce(
        (sum: number, s: { toolCalls?: unknown[] }) => sum + (s.toolCalls?.length ?? 0),
        0,
      ) ?? 0;

      this._logRequestEnd("chat", startTime, steps, toolCalls);

      return onFinish(...args);
    };

    // Clean up presence if client disconnects mid-stream
    options?.abortSignal?.addEventListener("abort", () => {
      this._isGenerating = false;
      clearPresence();
    }, { once: true });

    // Reset the director inactivity timer on every user message
    this._resetDirectorTimer();

    try {
      const result = streamText({
        model,
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
  async onDirectorNudge(
    _payload: unknown,
    currentSchedule?: { id: string },
  ) {
    // Guard: skip if another timer was set after this one fired
    // Note: the SDK deletes the schedule row AFTER the callback returns,
    // so we must exclude the currently-executing schedule by ID
    const lastSchedules = this.getSchedules({ type: "delayed" });
    const hasPending = lastSchedules.some(
      (s) =>
        s.callback === "onDirectorNudge" && s.id !== currentSchedule?.id,
    );
    if (hasPending) {
      console.debug(JSON.stringify({ event: "director:skip", reason: "newer-timer", boardId: this.name }));
      return;
    }

    // Guard: skip if AI is already generating a response
    if (this._isGenerating) {
      console.debug(JSON.stringify({ event: "director:skip", reason: "generating", boardId: this.name }));
      return;
    }

    // Guard: skip if no scene started
    if (this.messages.length === 0) {
      console.debug(JSON.stringify({ event: "director:skip", reason: "no-messages", boardId: this.name }));
      return;
    }

    this._isGenerating = true;
    const startTime = Date.now();

    // Determine scene phase from user message count
    const userMessageCount = this.messages.filter(
      (m) => m.role === "user",
    ).length;
    const phase = computeScenePhase(userMessageCount);

    this._logRequestStart("director", { messageCount: this.messages.length });

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

    const { model } = this._getModelInfo();

    // Show AI presence while generating
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(JSON.stringify({ event: "ai:presence:start-error", trigger: "director", error: String(err) }));
    });

    try {
      const directorSystem =
        SYSTEM_PROMPT +
        `\n\n[DIRECTOR MODE] You are the scene director. The players have been quiet for a while. ` +
        `Current scene phase: ${phase.toUpperCase()}. ` +
        DIRECTOR_PROMPTS[phase] +
        `\n\nAct NOW - add something to the canvas to restart momentum. ` +
        `Keep your chat response to 1 sentence max, something provocative that invites players to react.`;

      const result = await generateText({
        model,
        system: directorSystem,
        messages: await convertToModelMessages(sanitizeMessages(this.messages)),
        tools,
        stopWhen: stepCountIs(3),
      });

      const directorMessage = this._buildDirectorMessage(result);
      if (directorMessage) {
        this.messages.push(directorMessage);
        await this.persistMessages(this.messages);
      }

      const totalToolCalls = result.steps.reduce(
        (sum, s) => sum + s.toolCalls.length,
        0,
      );

      this._logRequestEnd("director", startTime, result.steps.length, totalToolCalls, { phase });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "director:nudge-error",
          boardId: this.name,
          error: String(err),
        }),
      );
    } finally {
      this._isGenerating = false;
      await boardStub.setAiPresence(false).catch((err: unknown) => {
        console.debug(JSON.stringify({ event: "ai:presence:cleanup-error", trigger: "director", error: String(err) }));
      });
    }
  }
}
