import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createSDKTools } from "./ai-tools-sdk";
import type { Bindings } from "./env";
import type { BoardObject } from "../shared/types";

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

SCENE SETUP: When setting a scene, write punchy creative content on every sticky - character traits, props with personality, visual gags. Each sticky should be a short, funny detail that other players can riff on.`;

export class ChatAgent extends AIChatAgent<Bindings> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // this.name = boardId (set by client connecting to /agents/ChatAgent/<boardId>)
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

    // Choose model: Haiku if ANTHROPIC_API_KEY set, else GLM free tier
    const model = this.env.ANTHROPIC_API_KEY
      ? createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY })(
          "claude-haiku-4-5-20251001"
        )
      : (createWorkersAI({ binding: this.env.AI }) as any)(
          "@cf/zai-org/glm-4.7-flash"
        );

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
}
