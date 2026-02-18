/* eslint-disable @typescript-eslint/no-explicit-any -- Workers AI types require casts */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getSessionUser } from "./auth";
import { runWithTools } from "@cloudflare/ai-utils";
import { createTools } from "./ai-tools";
import type { ChatMessage, BoardObject } from "../shared/types";
import type { Bindings } from "./env";

const SYSTEM_PROMPT = `You are a whiteboard assistant. Be concise and action-oriented. Never ask for confirmation - just do it.

RULES:
- To modify/delete EXISTING objects: call getBoardState first to get IDs, then use the specific tool (moveObject, resizeObject, updateText, changeColor, deleteObject).
- To create multiple objects: call ALL create tools in a SINGLE response. Do NOT wait for results between creates.
- Never duplicate a tool call that already succeeded.
- Use getBoardState with filter/ids to minimize token usage on large boards.

LAYOUT: Space objects ~220px apart in a grid so they don't overlap. Canvas is roughly 1200x800.

COLORS: Stickies: #fbbf24 yellow, #f87171 red, #4ade80 green, #60a5fa blue, #c084fc purple, #fb923c orange. Shapes: any hex fill, slightly darker stroke. Lines/connectors: #94a3b8 default.

Keep responses under 2 sentences.`;

const MODEL = "@cf/zai-org/glm-4.7-flash";

export const aiRoutes = new Hono<{ Bindings: Bindings }>();

aiRoutes.post("/chat", async (c) => {
  // Auth check
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { message, boardId, history, selectedIds } = await c.req.json<{
    message: string;
    boardId: string;
    history: ChatMessage[];
    selectedIds?: string[];
  }>();

  console.debug(`[ai] chat request from=${user.displayName} board=${boardId} msg="${message.slice(0, 80)}" history=${history.length} selected=${selectedIds?.length ?? 0}`);

  // Get Board DO stub for tool callbacks
  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);

  // Build system prompt with optional selection context
  let systemPrompt = SYSTEM_PROMPT;
  if (selectedIds && selectedIds.length > 0) {
    const objects = await stub.readObjects();
    const selected = (objects as BoardObject[]).filter((o: BoardObject) => selectedIds.includes(o.id));
    if (selected.length > 0) {
      const desc = selected.map((o: BoardObject) => `- ${o.type} (id: ${o.id}${o.props.text ? `, text: "${o.props.text}"` : ""})`).join("\n");
      systemPrompt += `\n\nThe user has selected ${selected.length} object(s) on the board:\n${desc}\nWhen the user refers to "selected", "these", or "this", they mean the above objects. Use their IDs directly.`;
    }
  }

  // Build messages array from history
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: "user", content: message });

  // SSE stream for real-time tool progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: { type: string; [k: string]: unknown }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Build tools from registry, wrapping each with SSE tracing
      const toolDefs = createTools(stub);
      const tools: any[] = toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        function: async (args: any) => {
          if (!args) args = {};
          console.debug(`[ai] tool:${t.name}`, JSON.stringify(args));
          emit({ type: "tool", name: t.name, label: t.label, args });
          try {
            return await t.execute(args);
          } catch (err) {
            console.error(`[ai] tool ${t.name} failed:`, err);
            return JSON.stringify({ error: `Tool ${t.name} failed: ${String(err)}` });
          }
        },
      }));

      try {
        emit({ type: "status", label: "Thinking..." });

        if (c.env.ANTHROPIC_API_KEY) {
          // --- Claude Haiku 4.5 via direct Anthropic API ---
          const anthropicTools = tools.map((t: any) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          }));
          const toolFns: Record<string, (args: any) => Promise<string>> = {};
          for (const t of tools) toolFns[t.name] = t.function;

          // Anthropic uses system as top-level param, not a message
          const anthropicMessages: { role: string; content: any }[] = messages
            .filter(m => m.role !== "system")
            .map(m => ({ role: m.role, content: m.content }));

          const MAX_TOOL_ROUNDS = 3;
          let toolRound = 0;
          let finalText = "";

          while (true) {
            const ac = new AbortController();
            const timeout = setTimeout(() => ac.abort(), 25_000);
            let apiRes: Response;
            try {
              apiRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                signal: ac.signal,
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": c.env.ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: "claude-haiku-4-5-20251001",
                  max_tokens: 4096,
                  system: SYSTEM_PROMPT,
                  messages: anthropicMessages,
                  tools: anthropicTools,
                }),
              });
            } finally {
              clearTimeout(timeout);
            }

            if (!apiRes.ok) {
              const errBody = await apiRes.text();
              throw new Error(`Anthropic API ${apiRes.status}: ${errBody}`);
            }

            const data: any = await apiRes.json();
            if (!data || !Array.isArray(data.content)) {
              console.error("[ai] unexpected Anthropic response shape:", JSON.stringify(data).slice(0, 500));
              throw new Error(`Anthropic returned unexpected response (stop_reason=${data?.stop_reason})`);
            }
            console.debug(`[ai] haiku round=${toolRound} stop=${data.stop_reason} blocks=${data.content.length}`);

            // Collect text from this response (append across rounds)
            const textBlocks = data.content.filter((b: any) => b.type === "text");
            if (textBlocks.length > 0) {
              const roundText = textBlocks.map((b: any) => b.text).join("\n");
              finalText = finalText ? finalText + "\n" + roundText : roundText;
            }

            const toolUses = data.content.filter((b: any) => b.type === "tool_use");

            // No tool use or exhausted rounds -> done
            if (data.stop_reason !== "tool_use" || toolUses.length === 0 || toolRound >= MAX_TOOL_ROUNDS) {
              if (toolRound >= MAX_TOOL_ROUNDS && data.stop_reason === "tool_use") {
                console.warn(`[ai] haiku hit MAX_TOOL_ROUNDS (${MAX_TOOL_ROUNDS}) - model still requesting tools`);
              }
              console.debug("[ai] haiku final:", finalText.slice(0, 200));
              emit({ type: "done", response: finalText || "I performed the requested actions on the board." });
              break;
            }

            toolRound++;

            // Append assistant message to conversation
            anthropicMessages.push({ role: "assistant", content: data.content });

            // Execute all tool calls in parallel (traced wrapper emits SSE events)
            const toolResults = await Promise.all(
              toolUses.map(async (block: any) => {
                const fn = toolFns[block.name];
                if (!fn) {
                  console.error(`[ai] model called unknown tool: "${block.name}"`);
                  return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ error: `Unknown tool: ${block.name}` }) };
                }
                try {
                  const result = await fn(block.input);
                  return { type: "tool_result" as const, tool_use_id: block.id, content: result };
                } catch (err) {
                  console.error(`[ai] tool ${block.name} failed:`, err);
                  return { type: "tool_result" as const, tool_use_id: block.id, content: JSON.stringify({ error: String(err) }), is_error: true };
                }
              }),
            );

            // Append tool results as user message
            anthropicMessages.push({ role: "user", content: toolResults });
          }
        } else {
          // --- GLM-4.7-Flash via Workers AI (free tier fallback) ---
          console.warn("[ai] ANTHROPIC_API_KEY not set - using GLM-4.7-Flash fallback");
          const response = await runWithTools(
            c.env.AI as any,
            MODEL as Parameters<typeof runWithTools>[1],
            { messages, tools },
            { maxRecursiveToolRuns: 3, verbose: true },
          );

          const raw = typeof response === "string"
            ? response
            : (response as { response?: unknown }).response;
          const text = typeof raw === "string" ? raw : "I performed the requested actions on the board.";

          console.debug("[ai] glm final:", text.slice(0, 200));
          emit({ type: "done", response: text });
        }
      } catch (err) {
        console.error("[ai] error:", err);
        emit({ type: "error", message: `AI request failed: ${String(err)}` });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
