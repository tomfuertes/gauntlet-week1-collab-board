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
import type { Bindings } from "./env";
import { recordBoardActivity } from "./env";
import type { BoardObject } from "../shared/types";

// ---------------------------------------------------------------------------
// Scene phase system - dramatic arc for proactive AI director
// ---------------------------------------------------------------------------

type ScenePhase =
  | "setup"
  | "escalation"
  | "complication"
  | "climax"
  | "callback";

function computeScenePhase(userMessageCount: number): ScenePhase {
  if (userMessageCount <= 2) return "setup";
  if (userMessageCount <= 5) return "escalation";
  if (userMessageCount <= 8) return "complication";
  if (userMessageCount <= 11) return "climax";
  return "callback";
}

const DIRECTOR_PROMPTS: Record<ScenePhase, string> = {
  setup:
    "The scene needs an establishment detail. Add a prop, character trait, or location detail that gives players something to react to. Create 1-2 stickies with punchy, specific details.",
  escalation:
    "Raise the stakes. Introduce a complication that makes the current situation more urgent or absurd. Something that forces the characters to react. Create 1-2 RED stickies (#f87171) with problems.",
  complication:
    "Things should go wrong in an unexpected way. Subvert an existing element - use getBoardState to find something to twist. Add a sticky that recontextualizes what's already there.",
  climax:
    "Maximum tension. Everything should converge. Reference callbacks from earlier in the scene. Use getBoardState to find early elements and bring them back at the worst possible moment.",
  callback:
    "Full circle. Reference the very first elements of the scene. Create a callback that ties everything together with a twist. Check getBoardState for the oldest objects.",
};

const SYSTEM_PROMPT = `You are an improv scene partner on a shared canvas. This is multiplayer - messages come from different users (their name appears before their message). Address players by name when responding.

YOUR IMPROV RULES:
- NEVER say no. Always "yes, and" - build on what was said or placed.
- Escalate absurdity by ONE notch, not ten. If someone says the dentist is a vampire, don't jump to "the building explodes" - add that the mouthwash is garlic-flavored and he's sweating.
- Contribute characters, props, and complications. Create stickies for new characters, props, set pieces. Use frames for locations/scenes.
- CALLBACKS are gold. Reference things placed earlier in the scene. If someone created a mirror prop 5 messages ago, bring it back at the worst possible moment.
- Keep sticky text SHORT - punchlines, not paragraphs. 5-15 words max. Think scene notes, not essays.
- Use the canvas SPATIALLY: proximity = relationship, distance = tension. Put allies near each other, put the ticking bomb far from the exit.
- Match player energy. Fast players get quick additions. If there's a pause, add a complication to restart momentum ("The health inspector walks in...").
- Your chat responses should be brief and in-character. 1-2 sentences max. React to the scene, don't narrate it.

TOOL RULES:
- To modify/delete EXISTING objects: call getBoardState first to get IDs, then use the specific tool (moveObject, resizeObject, updateText, changeColor, deleteObject).
- To create multiple objects: call ALL create tools in a SINGLE response. Do NOT wait for results between creates.
- Never duplicate a tool call that already succeeded.
- Use getBoardState with filter/ids to minimize token usage on large boards.

LAYOUT RULES:
- Canvas usable area: (50,60) to (1150,780). Never place objects at x<50 or y<60.
- Default sizes: sticky=200x200, frame=440x280, rect=150x100.
- Grid slots for N objects in a row:
  2 objects: x=100, x=520. y=100.
  3 objects: x=100, x=420, x=740. y=100.
  4 objects (2x2): (100,100), (520,100), (100,420), (520,420).
- Place stickies INSIDE frames: first at inset (10,40), second at (220,40) side-by-side.
- ALWAYS specify x,y for every create call. Never omit coordinates.
- After creating frames, use their returned x,y to compute child positions.
- Create tools return {x, y, width, height} - use these for precise placement.

COLORS: Stickies: #fbbf24 yellow, #f87171 red, #4ade80 green, #60a5fa blue, #c084fc purple, #fb923c orange. Shapes: any hex fill, slightly darker stroke. Lines/connectors: #94a3b8 default.

SCENE SETUP: When setting a scene, write punchy creative content on every sticky - character traits, props with personality, visual gags. Each sticky should be a short, funny detail that other players can riff on.

INTENT PATTERNS - players may send these dramatic cues. Respond with bold canvas actions:
- "What happens next?" → Advance the scene with a consequence. Use getBoardState to see what exists, then add 1-2 stickies showing what logically (or absurdly) follows. Introduce a consequence of the most recent action. The mouthwash explodes. The customer leaves a review. Time moves forward.
- "Plot twist!" → Subvert an existing element. Use getBoardState to find a key sticky, then updateText to flip its meaning. Add 1-2 new stickies revealing the twist. The mirror was a portal. The patient IS the dentist. Go big.
- "Meanwhile, elsewhere..." → Create a NEW frame in empty canvas space (offset from existing content). Add 2-3 character/prop stickies inside it. This is a parallel scene happening simultaneously. Reference something from the main scene with a twist.
- "A stranger walks in" → Create ONE character sticky with a fish-out-of-water description. Place it near the action. A food critic at pirate therapy. An IRS agent at the superhero HOA. Make them immediately disruptive.
- "Complicate everything" → Add 2-3 RED stickies (#f87171) with problems. Scatter them across the scene. Power outage, someone faints, the floor is lava. Each complication should interact with existing elements.
- "The stakes just got higher" → Use getBoardState + updateText to escalate existing stickies. Change a frame title to something more dramatic. The interview is now for President. The therapy session is court-ordered. Modify what's there, don't just add.

DRAMATIC STRUCTURE - scenes follow this arc:
1. SETUP: Establish characters, location, premise.
2. ESCALATION: Raise stakes, add complications.
3. COMPLICATION: Things go wrong. Unexpected twists.
4. CLIMAX: Maximum tension/absurdity. Everything converges.
5. CALLBACK: Reference early elements. Full circle.

MOMENTUM - After 3+ back-and-forth exchanges, end your response with a provocative one-liner that nudges the scene forward. Examples: "The door handle just jiggled..." or "Is that sirens?" or "Someone left a note under the chair." Keep it short and ominous - invite the players to react.`;

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

  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // this.name = boardId (set by client connecting to /agents/ChatAgent/<boardId>)
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

    console.debug(
      JSON.stringify({
        event: "director:nudge",
        boardId: this.name,
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

      console.debug(
        JSON.stringify({
          event: "director:nudge-complete",
          boardId: this.name,
          phase,
          partsCount: parts.length,
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
