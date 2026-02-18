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
import { createSDKTools } from "./ai-tools-sdk";
import {
  SYSTEM_PROMPT,
  DIRECTOR_PROMPTS,
  PROMPT_VERSION,
  computeScenePhase,
} from "./prompts";
import type { Bindings } from "./env";
import { recordBoardActivity } from "./env";
import type { BoardObject } from "../shared/types";

export class ChatAgent extends AIChatAgent<Bindings> {
  /* eslint-disable @typescript-eslint/no-explicit-any */

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
    const startTime = Date.now();
    const modelName = this._getModelName();

    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger: "chat",
      })
    );

    // Record chat activity for async notifications (non-blocking)
    this.ctx.waitUntil(
      recordBoardActivity(this.env.DB, this.name).catch((err: unknown) => {
        console.error(JSON.stringify({ event: "activity:record", trigger: "chat", error: String(err) }));
      })
    );

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId);

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
        body.selectedIds.includes(o.id)
      );
      if (selected.length > 0) {
        const desc = selected
          .map(
            (o: BoardObject) =>
              `- ${o.type} (id: ${o.id}${o.props.text ? `, text: "${o.props.text}"` : ""})`
          )
          .join("\n");
        systemPrompt += `\n\nThe user has selected ${selected.length} object(s) on the board:\n${desc}\nWhen the user refers to "selected", "these", or "this", they mean the above objects. Use their IDs directly.`;
      }
    }

    const model = this._getModel();

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
      await clearPresence();

      // Request-level metrics from onFinish
      const durationMs = Date.now() - startTime;
      const finishArg = args[0] as { steps?: { toolCalls?: unknown[] }[] } | undefined;
      const steps = finishArg?.steps?.length ?? 0;
      const toolCalls = finishArg?.steps?.reduce(
        (sum: number, s: { toolCalls?: unknown[] }) => sum + (s.toolCalls?.length ?? 0),
        0
      ) ?? 0;

      console.debug(
        JSON.stringify({
          event: "ai:request:end",
          boardId: this.name,
          model: modelName,
          promptVersion: PROMPT_VERSION,
          trigger: "chat",
          steps,
          toolCalls,
          durationMs,
        })
      );

      return onFinish(...args);
    };

    // Clean up presence if client disconnects mid-stream
    options?.abortSignal?.addEventListener("abort", () => {
      clearPresence();
    }, { once: true });

    // Reset the director inactivity timer on every user message
    this._resetDirectorTimer();

    try {
      const result = streamText({
        model,
        system: systemPrompt,
        messages: await convertToModelMessages(this.messages),
        tools,
        onFinish: wrappedOnFinish,
        stopWhen: stepCountIs(5),
        abortSignal: options?.abortSignal,
      });

      return result.toUIMessageStreamResponse();
    } catch (err) {
      await clearPresence();
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // AI Director - proactive scene complications after inactivity
  // ---------------------------------------------------------------------------

  /** Cancel existing director schedule and set a new 60s timer */
  private _resetDirectorTimer() {
    // Fire-and-forget: schedule management should never block chat response
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
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "director:timer-error",
            error: String(err),
          })
        );
      }
    })();
  }

  /** Called by DO alarm after 60s of inactivity - generates a proactive scene complication */
  async onDirectorNudge(
    _payload: unknown,
    currentSchedule?: { id: string }
  ) {
    // Guard: skip if another timer was set after this one fired
    // Note: the SDK deletes the schedule row AFTER the callback returns,
    // so we must exclude the currently-executing schedule by ID
    const lastSchedules = this.getSchedules({ type: "delayed" });
    const hasPending = lastSchedules.some(
      (s) =>
        s.callback === "onDirectorNudge" && s.id !== currentSchedule?.id
    );
    if (hasPending) {
      return;
    }

    // Guard: skip if a stream is already in progress
    if (this._activeStreamId) {
      return;
    }

    // Guard: skip if no scene started
    if (this.messages.length === 0) {
      return;
    }

    const startTime = Date.now();
    const modelName = this._getModelName();

    console.debug(
      JSON.stringify({
        event: "ai:request:start",
        boardId: this.name,
        model: modelName,
        promptVersion: PROMPT_VERSION,
        trigger: "director",
        messageCount: this.messages.length,
      })
    );

    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const batchId = crypto.randomUUID();
    const tools = createSDKTools(boardStub, batchId);

    // Determine scene phase from user message count
    const userMessageCount = this.messages.filter(
      (m) => m.role === "user"
    ).length;
    const phase = computeScenePhase(userMessageCount);

    const model = this._getModel();

    // Show AI presence while generating
    await boardStub.setAiPresence(true).catch(() => {});

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
        messages: await convertToModelMessages(this.messages),
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
          if (tr) {
            parts.push({
              type: "dynamic-tool" as const,
              toolName: tc.toolName,
              toolCallId: tc.toolCallId,
              state: "output-available" as const,
              input: tc.input,
              output: tr.output,
            });
          } else {
            parts.push({
              type: "dynamic-tool" as const,
              toolName: tc.toolName,
              toolCallId: tc.toolCallId,
              state: "output-error" as const,
              input: tc.input,
              errorText: "Tool execution did not return a result",
            });
          }
        }
      }

      // Add text part if present
      if (result.text) {
        parts.push({ type: "text" as const, text: result.text });
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
          trigger: "director",
          phase,
          steps: result.steps.length,
          toolCalls: totalToolCalls,
          durationMs,
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "director:nudge-error",
          boardId: this.name,
          error: String(err),
        })
      );
    } finally {
      await boardStub.setAiPresence(false).catch(() => {});
    }
  }
}
