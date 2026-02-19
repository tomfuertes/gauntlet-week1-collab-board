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
  PERSONAS,
  MAX_AUTONOMOUS_EXCHANGES,
  buildPersonaSystemPrompt,
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

  // Multi-agent persona state (resets on DO hibernation - that's fine, defaults work)
  private _activePersonaIndex = 0; // which persona responds to the next human message
  private _autonomousExchangeCount = 0; // consecutive autonomous exchanges (reset on human msg)

  /** Choose model: Haiku if ANTHROPIC_API_KEY set, else GLM free tier */
  private _getModel() {
    return this.env.ANTHROPIC_API_KEY
      ? createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY })(
          "claude-haiku-4-5-20251001"
        )
      : (createWorkersAI({ binding: this.env.AI }) as any)(
          "@cf/zai-org/glm-4.7-flash"
        );
  }

  /** Model name for logging (avoids exposing full model object) */
  private _getModelName(): string {
    return this.env.ANTHROPIC_API_KEY
      ? "claude-haiku-4-5"
      : "glm-4.7-flash";
  }

  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // this.name = boardId (set by client connecting to /agents/ChatAgent/<boardId>)
    this._isGenerating = true;
    this._autonomousExchangeCount = 0; // human spoke - reset cooldown
    const startTime = Date.now();
    const modelName = this._getModelName();
    const activePersona = PERSONAS[this._activePersonaIndex];

    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger: "chat",
        persona: activePersona.name,
      })
    );

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

    // Build persona-aware system prompt with optional selection + multiplayer context
    let systemPrompt = buildPersonaSystemPrompt(this._activePersonaIndex, SYSTEM_PROMPT);
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

    // Capture persona index for the reactive trigger (before it might change)
    const activeIndex = this._activePersonaIndex;

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

      const durationMs = Date.now() - startTime;
      console.debug(
        JSON.stringify({
          event: "ai:request:end",
          boardId: this.name,
          model: modelName,
          promptVersion: PROMPT_VERSION,
          trigger: "chat",
          persona: activePersona.name,
          steps,
          toolCalls,
          durationMs,
        })
      );

      // Ensure active persona's message has the [NAME] prefix (LLMs sometimes forget)
      this._ensurePersonaPrefix(activeIndex);

      // Trigger reactive persona to "yes, and" the active persona's response
      this.ctx.waitUntil(
        this._triggerReactivePersona(activeIndex).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "reactive:unhandled", boardId: this.name, error: String(err) }));
        })
      );

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
        model: this._getModel(),
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
   *  Uses immutable update + persist to avoid mutating SDK-owned objects. */
  private _ensurePersonaPrefix(personaIndex: number) {
    const persona = PERSONAS[personaIndex];
    const lastMsg = this.messages[this.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const needsFix = lastMsg.parts.some(
      (p) => p.type === "text" && !p.text.startsWith(`[${persona.name}]`)
    );
    if (!needsFix) {
      if (!lastMsg.parts.some((p) => p.type === "text")) {
        console.warn(JSON.stringify({ event: "persona:prefix:no-text-part", boardId: this.name, persona: persona.name }));
      }
      return;
    }

    const newParts = lastMsg.parts.map((part) => {
      if (part.type === "text" && !part.text.startsWith(`[${persona.name}]`)) {
        return { ...part, text: `[${persona.name}] ${part.text}` };
      }
      return part;
    });
    this.messages[this.messages.length - 1] = { ...lastMsg, parts: newParts };
    this.ctx.waitUntil(
      this.persistMessages(this.messages).catch((err: unknown) => {
        console.error(JSON.stringify({ event: "persona:prefix:persist-error", boardId: this.name, error: String(err) }));
      })
    );
  }

  /** After the active persona finishes, trigger the other persona to react.
   *  Claims _isGenerating mutex BEFORE the delay to prevent TOCTOU races. */
  private async _triggerReactivePersona(activeIndex: number) {
    // Guard: cooldown exceeded (check before claiming mutex)
    if (this._autonomousExchangeCount >= MAX_AUTONOMOUS_EXCHANGES) {
      console.debug(JSON.stringify({ event: "reactive:skip", reason: "cooldown", boardId: this.name }));
      return;
    }

    // Guard: already generating (human message or concurrent caller)
    if (this._isGenerating) {
      console.debug(JSON.stringify({ event: "reactive:skip", reason: "busy", boardId: this.name }));
      return;
    }

    // Guard: need at least one assistant message to react to
    if (!this.messages.some((m) => m.role === "assistant")) {
      console.debug(JSON.stringify({ event: "reactive:skip", reason: "no-assistant-message", boardId: this.name }));
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
      console.debug(JSON.stringify({ event: "reactive:skip", reason: "human-interrupted", boardId: this.name }));
      return;
    }

    const reactiveIndex = activeIndex === 0 ? 1 : 0;
    const reactivePersona = PERSONAS[reactiveIndex];
    const activePersona = PERSONAS[activeIndex];
    const modelName = this._getModelName();
    const startTime = Date.now();

    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger: "reactive",
        persona: reactivePersona.name,
      })
    );

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

    const reactiveSystem =
      buildPersonaSystemPrompt(reactiveIndex, SYSTEM_PROMPT) +
      `\n\n[REACTIVE MODE] You are responding autonomously to what just happened. ` +
      `Your improv partner ${activePersona.name} just made their move. ` +
      `React to it and the human's prompt. Keep it brief - 1 sentence of chat and 1-2 canvas actions max. ` +
      `Do NOT repeat or summarize what ${activePersona.name} did - build on it.`;

    const model = this._getModel();

    // Show AI presence while generating
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(JSON.stringify({ event: "ai:presence:start-error", trigger: "reactive", error: String(err) }));
    });

    try {
      const result = await generateText({
        model,
        system: reactiveSystem,
        messages: await convertToModelMessages(sanitizeMessages(this.messages)),
        tools,
        stopWhen: stepCountIs(3),
      });

      // Build UIMessage from generateText result (same pattern as director nudge)
      const parts: UIMessage["parts"] = [];

      for (const step of result.steps) {
        for (const tc of step.toolCalls) {
          const tr = step.toolResults.find(
            (r: { toolCallId: string }) => r.toolCallId === tc.toolCallId
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

      // Add text part with persona prefix
      const text = result.text
        ? (result.text.startsWith(`[${reactivePersona.name}]`)
            ? result.text
            : `[${reactivePersona.name}] ${result.text}`)
        : `[${reactivePersona.name}] *reacts to the scene*`;
      parts.push({ type: "text" as const, text });

      if (parts.length > 0) {
        const reactiveMessage: UIMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts,
        };
        this.messages.push(reactiveMessage);
        await this.persistMessages(this.messages);
      }

      const durationMs = Date.now() - startTime;
      const totalToolCalls = result.steps.reduce(
        (sum, s) => sum + s.toolCalls.length,
        0
      );

      console.debug(
        JSON.stringify({
          event: "ai:request:end",
          boardId: this.name,
          model: modelName,
          promptVersion: PROMPT_VERSION,
          trigger: "reactive",
          persona: reactivePersona.name,
          steps: result.steps.length,
          toolCalls: totalToolCalls,
          durationMs,
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "reactive:error",
          boardId: this.name,
          persona: reactivePersona.name,
          autonomousExchangeCount: this._autonomousExchangeCount,
          error: String(err),
        })
      );
    } finally {
      // Toggle persona regardless of success/failure - prevents getting stuck
      this._activePersonaIndex = reactiveIndex;
      this._isGenerating = false;
      await boardStub.setAiPresence(false).catch((err: unknown) => {
        console.debug(JSON.stringify({ event: "ai:presence:cleanup-error", trigger: "reactive", error: String(err) }));
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
    const modelName = this._getModelName();
    const directorPersona = PERSONAS[this._activePersonaIndex];
    const directorIndex = this._activePersonaIndex;

    // Determine scene phase from user message count
    const userMessageCount = this.messages.filter(
      (m) => m.role === "user",
    ).length;
    const phase = computeScenePhase(userMessageCount);

    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger: "director",
        persona: directorPersona.name,
        messageCount: this.messages.length,
      })
    );

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId, this.env.AI);

    // Show AI presence while generating
    await boardStub.setAiPresence(true).catch((err: unknown) => {
      console.debug(JSON.stringify({ event: "ai:presence:start-error", trigger: "director", error: String(err) }));
    });

    try {
      // Director nudge uses the active persona's voice
      const directorSystem =
        buildPersonaSystemPrompt(directorIndex, SYSTEM_PROMPT) +
        `\n\n[DIRECTOR MODE] You are the scene director. The players have been quiet for a while. ` +
        `Current scene phase: ${phase.toUpperCase()}. ` +
        DIRECTOR_PROMPTS[phase] +
        `\n\nAct NOW - add something to the canvas to restart momentum. ` +
        `Keep your chat response to 1 sentence max, something provocative that invites players to react.`;

      const result = await generateText({
        model: this._getModel(),
        system: directorSystem,
        messages: await convertToModelMessages(sanitizeMessages(this.messages)),
        tools,
        stopWhen: stepCountIs(3),
      });

      // Build UIMessage from generateText result
      const parts: UIMessage["parts"] = [];

      // Add tool call parts from all steps
      for (const step of result.steps) {
        for (const tc of step.toolCalls) {
          const tr = step.toolResults.find(
            (r: { toolCallId: string }) => r.toolCallId === tc.toolCallId
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

      // Add text part with persona prefix
      const text = result.text
        ? (result.text.startsWith(`[${directorPersona.name}]`)
            ? result.text
            : `[${directorPersona.name}] ${result.text}`)
        : "";
      if (text) {
        parts.push({ type: "text" as const, text });
      }

      // Only persist if we actually generated something
      if (parts.length > 0) {
        const directorMessage: UIMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts,
        };
        this.messages.push(directorMessage);
        await this.persistMessages(this.messages);
      }

      const totalToolCalls = result.steps.reduce(
        (sum, s) => sum + s.toolCalls.length,
        0,
      );

      const durationMs = Date.now() - startTime;
      console.debug(
        JSON.stringify({
          event: "ai:request:end",
          boardId: this.name,
          model: modelName,
          promptVersion: PROMPT_VERSION,
          trigger: "director",
          persona: directorPersona.name,
          phase,
          steps: result.steps.length,
          toolCalls: totalToolCalls,
          durationMs,
        })
      );

      // Director nudge also triggers the other persona to react
      this._autonomousExchangeCount++;
      this.ctx.waitUntil(
        this._triggerReactivePersona(directorIndex).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "reactive:unhandled", boardId: this.name, error: String(err) }));
        })
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
        console.debug(JSON.stringify({ event: "ai:presence:cleanup-error", trigger: "director", error: String(err) }));
      });
    }
  }
}
