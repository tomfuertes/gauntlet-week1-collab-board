import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createSDKTools } from "./ai-tools-sdk";
import type { Bindings } from "./env";
import type { BoardObject } from "../shared/types";

const SYSTEM_PROMPT = `You are a whiteboard assistant. Be concise and action-oriented. Never ask for confirmation - just do it.

RULES:
- To modify/delete EXISTING objects: call getBoardState first to get IDs, then use the specific tool (moveObject, resizeObject, updateText, changeColor, deleteObject).
- To create multiple objects: call ALL create tools in a SINGLE response. Do NOT wait for results between creates.
- Never duplicate a tool call that already succeeded.
- Use getBoardState with filter/ids to minimize token usage on large boards.

LAYOUT: Space objects ~220px apart in a grid so they don't overlap. Canvas is roughly 1200x800.

COLORS: Stickies: #fbbf24 yellow, #f87171 red, #4ade80 green, #60a5fa blue, #c084fc purple, #fb923c orange. Shapes: any hex fill, slightly darker stroke. Lines/connectors: #94a3b8 default.

Keep responses under 2 sentences.`;

export class ChatAgent extends AIChatAgent<Bindings> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async onChatMessage(onFinish: any, options?: { abortSignal?: AbortSignal }) {
    // this.name = boardId (set by client connecting to /agents/ChatAgent/<boardId>)
    const doId = this.env.BOARD.idFromName(this.name);
    const boardStub = this.env.BOARD.get(doId);
    const tools = createSDKTools(boardStub);

    // Build system prompt with optional selection context
    let systemPrompt = SYSTEM_PROMPT;
    const body =
      options && "body" in options ? (options as any).body : undefined;
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

    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(this.messages),
      tools,
      onFinish,
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
    });

    return result.toUIMessageStreamResponse();
  }
}
