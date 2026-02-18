/* eslint-disable @typescript-eslint/no-explicit-any -- Workers AI types require casts */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getSessionUser } from "./auth";
import { runWithTools } from "@cloudflare/ai-utils";
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

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

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

      // Helper: wrap a tool function to emit progress before executing
      const traced = <T extends (...args: any[]) => Promise<string>>(
        name: string, label: string, fn: T,
      ): T => (async (...args: any[]) => {
        // Llama 3.3 sometimes omits arguments entirely - default to empty object
        if (!args[0]) args[0] = {};
        console.debug(`[ai] tool:${name}`, JSON.stringify(args[0]));
        emit({ type: "tool", name, label, args: args[0] });
        return fn(...args);
      }) as T;

      const tools: any[] = [
        // 1. createStickyNote
        {
          name: "createStickyNote",
          description: "Create a sticky note on the whiteboard with text content",
          parameters: {
            type: "object" as const,
            properties: {
              text: { type: "string" as const, description: "The text content of the sticky note" },
              x: { type: "number" as const, description: "X position on the canvas (default: random 100-800)" },
              y: { type: "number" as const, description: "Y position on the canvas (default: random 100-600)" },
              color: { type: "string" as const, description: "Hex color (default: #fbbf24 yellow). Options: #fbbf24, #f87171, #4ade80, #60a5fa, #c084fc, #fb923c" },
            },
            required: ["text"] as const,
          },
          function: traced("createStickyNote", "Creating sticky", async (args: { text?: string; x?: number; y?: number; color?: string }) => {
            const id = crypto.randomUUID();
            const obj = {
              id,
              type: "sticky" as const,
              x: Number(args.x) || 100 + Math.random() * 700,
              y: Math.max(60, Number(args.y) || 100 + Math.random() * 500),
              width: 200,
              height: 200,
              rotation: 0,
              props: { text: args.text || "New note", color: args.color || "#fbbf24" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.mutate({ type: "obj:create", obj });
            return JSON.stringify({ created: id, type: "sticky", text: args.text });
          }),
        },

        // 2. createShape (replaces create_rect + create_circle + create_line)
        {
          name: "createShape",
          description: "Create a shape on the whiteboard. Use shape='rect' for rectangle, 'circle' for circle, 'line' for line.",
          parameters: {
            type: "object" as const,
            properties: {
              shape: { type: "string" as const, description: "Shape type: 'rect', 'circle', or 'line'" },
              x: { type: "number" as const, description: "X position (default: random). For circle: center X. For line: start X." },
              y: { type: "number" as const, description: "Y position (default: random). For circle: center Y. For line: start Y." },
              width: { type: "number" as const, description: "Width (default: 150). For circle: diameter. For line: X delta to endpoint." },
              height: { type: "number" as const, description: "Height (default: 100). For circle: same as width. For line: Y delta to endpoint." },
              fill: { type: "string" as const, description: "Fill color hex (default: #3b82f6)" },
              stroke: { type: "string" as const, description: "Stroke color hex (default: #2563eb)" },
            },
            required: ["shape"] as const,
          },
          function: traced("createShape", "Creating shape", async (args: { shape?: string; x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string }) => {
            const shape = args.shape || "rect";
            const id = crypto.randomUUID();

            if (shape === "circle") {
              const diameter = args.width ?? 100;
              const cx = args.x ?? 100 + Math.random() * 700;
              const cy = Math.max(60, args.y ?? 100 + Math.random() * 500);
              const obj = {
                id,
                type: "circle" as const,
                x: cx - diameter / 2,
                y: cy - diameter / 2,
                width: diameter,
                height: diameter,
                rotation: 0,
                props: { fill: args.fill || "#3b82f6", stroke: args.stroke || "#2563eb" },
                createdBy: "ai-agent",
                updatedAt: Date.now(),
              };
              await stub.mutate({ type: "obj:create", obj });
              return JSON.stringify({ created: id, type: "circle", diameter });
            }

            if (shape === "line") {
              const obj = {
                id,
                type: "line" as const,
                x: args.x ?? 100 + Math.random() * 700,
                y: Math.max(60, args.y ?? 100 + Math.random() * 500),
                width: args.width ?? 200,
                height: args.height ?? 0,
                rotation: 0,
                props: { stroke: args.stroke || "#94a3b8" },
                createdBy: "ai-agent",
                updatedAt: Date.now(),
              };
              await stub.mutate({ type: "obj:create", obj });
              return JSON.stringify({ created: id, type: "line" });
            }

            // Default: rect
            const obj = {
              id,
              type: "rect" as const,
              x: args.x ?? 100 + Math.random() * 700,
              y: Math.max(60, args.y ?? 100 + Math.random() * 500),
              width: args.width ?? 150,
              height: args.height ?? 100,
              rotation: 0,
              props: { fill: args.fill || "#3b82f6", stroke: args.stroke || "#2563eb" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.mutate({ type: "obj:create", obj });
            return JSON.stringify({ created: id, type: "rect" });
          }),
        },

        // 3. createFrame
        {
          name: "createFrame",
          description: "Create a frame (labeled container/region) on the whiteboard to group or organize objects. Frames render behind other objects.",
          parameters: {
            type: "object" as const,
            properties: {
              title: { type: "string" as const, description: "The frame title/label" },
              x: { type: "number" as const, description: "X position (default: random 100-800)" },
              y: { type: "number" as const, description: "Y position (default: random 100-600)" },
              width: { type: "number" as const, description: "Width in pixels (default: 400)" },
              height: { type: "number" as const, description: "Height in pixels (default: 300)" },
            },
            required: ["title"] as const,
          },
          function: traced("createFrame", "Creating frame", async (args: { title: string; x?: number; y?: number; width?: number; height?: number }) => {
            const id = crypto.randomUUID();
            const obj = {
              id,
              type: "frame" as const,
              x: args.x ?? 100 + Math.random() * 700,
              y: Math.max(60, args.y ?? 100 + Math.random() * 500),
              width: args.width ?? 400,
              height: args.height ?? 300,
              rotation: 0,
              props: { text: typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Frame" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.mutate({ type: "obj:create", obj });
            return JSON.stringify({ created: id, type: "frame", title: obj.props.text });
          }),
        },

        // 4. createConnector (now uses object IDs, resolves centers server-side)
        {
          name: "createConnector",
          description: "Create a connector/arrow between two objects on the whiteboard. Pass the IDs of the objects to connect.",
          parameters: {
            type: "object" as const,
            properties: {
              fromId: { type: "string" as const, description: "ID of the source object" },
              toId: { type: "string" as const, description: "ID of the target object" },
              stroke: { type: "string" as const, description: "Stroke color hex (default: #94a3b8)" },
              arrow: { type: "string" as const, description: "Arrow style: 'end' (default), 'both', or 'none'" },
            },
            required: ["fromId", "toId"] as const,
          },
          function: traced("createConnector", "Connecting objects", async (args: { fromId: string; toId: string; stroke?: string; arrow?: string }) => {
            const fromObj = await stub.readObject(args.fromId) as BoardObject | null;
            const toObj = await stub.readObject(args.toId) as BoardObject | null;
            if (!fromObj) return JSON.stringify({ error: `Source object ${args.fromId} not found` });
            if (!toObj) return JSON.stringify({ error: `Target object ${args.toId} not found` });

            const x1 = fromObj.x + fromObj.width / 2;
            const y1 = fromObj.y + fromObj.height / 2;
            const x2 = toObj.x + toObj.width / 2;
            const y2 = toObj.y + toObj.height / 2;

            const width = x2 - x1;
            const height = y2 - y1;
            if (width === 0 && height === 0) {
              return JSON.stringify({ error: "Cannot create zero-length connector (objects overlap)" });
            }

            const arrowStyle = args.arrow === "both" ? "both" : args.arrow === "none" ? "none" : "end";
            const id = crypto.randomUUID();
            const obj = {
              id,
              type: "line" as const,
              x: x1,
              y: y1,
              width,
              height,
              rotation: 0,
              props: { stroke: args.stroke || "#94a3b8", arrow: arrowStyle as "end" | "both" | "none" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.mutate({ type: "obj:create", obj });
            return JSON.stringify({ created: id, type: "connector", from: args.fromId, to: args.toId });
          }),
        },

        // 5. moveObject
        {
          name: "moveObject",
          description: "Move an existing object to a new position on the whiteboard",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to move" },
              x: { type: "number" as const, description: "New X position" },
              y: { type: "number" as const, description: "New Y position" },
            },
            required: ["id", "x", "y"] as const,
          },
          function: traced("moveObject", "Moving object", async (args: { id: string; x: number; y: number }) => {
            const result = await stub.mutate({
              type: "obj:update",
              obj: { id: args.id, x: args.x, y: args.y, updatedAt: Date.now() },
            });
            if (!result.ok) return JSON.stringify({ error: result.error });
            return JSON.stringify({ moved: args.id, x: args.x, y: args.y });
          }),
        },

        // 6. resizeObject
        {
          name: "resizeObject",
          description: "Resize an existing object on the whiteboard",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to resize" },
              width: { type: "number" as const, description: "New width" },
              height: { type: "number" as const, description: "New height" },
            },
            required: ["id", "width", "height"] as const,
          },
          function: traced("resizeObject", "Resizing object", async (args: { id: string; width: number; height: number }) => {
            const result = await stub.mutate({
              type: "obj:update",
              obj: { id: args.id, width: args.width, height: args.height, updatedAt: Date.now() },
            });
            if (!result.ok) return JSON.stringify({ error: result.error });
            return JSON.stringify({ resized: args.id, width: args.width, height: args.height });
          }),
        },

        // 7. updateText
        {
          name: "updateText",
          description: "Update the text content of a sticky note, text object, or frame title",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to update" },
              text: { type: "string" as const, description: "New text content" },
            },
            required: ["id", "text"] as const,
          },
          function: traced("updateText", "Updating text", async (args: { id: string; text: string }) => {
            const result = await stub.mutate({
              type: "obj:update",
              obj: { id: args.id, props: { text: args.text }, updatedAt: Date.now() },
            });
            if (!result.ok) return JSON.stringify({ error: result.error });
            return JSON.stringify({ updated: args.id, text: args.text });
          }),
        },

        // 8. changeColor
        {
          name: "changeColor",
          description: "Change the color of an object. Maps to props.color for stickies, props.fill for shapes.",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to recolor" },
              color: { type: "string" as const, description: "New hex color" },
            },
            required: ["id", "color"] as const,
          },
          function: traced("changeColor", "Changing color", async (args: { id: string; color: string }) => {
            // Need to read object type to decide which prop to set
            const existing = await stub.readObject(args.id) as BoardObject | null;
            if (!existing) return JSON.stringify({ error: `Object ${args.id} not found` });

            const props: Record<string, string> = {};
            if (existing.type === "sticky" || existing.type === "text") {
              props.color = args.color;
            } else {
              props.fill = args.color;
            }
            const result = await stub.mutate({
              type: "obj:update",
              obj: { id: args.id, props, updatedAt: Date.now() },
            });
            if (!result.ok) return JSON.stringify({ error: result.error });
            return JSON.stringify({ recolored: args.id, color: args.color });
          }),
        },

        // 9. getBoardState (replaces read_board with filtering)
        {
          name: "getBoardState",
          description: "Read objects on the whiteboard. Optionally filter by type or specific IDs. For large boards (20+), returns a summary unless filtered.",
          parameters: {
            type: "object" as const,
            properties: {
              filter: { type: "string" as const, description: "Filter by object type: 'sticky', 'rect', 'circle', 'line', 'text', 'frame'" },
              ids: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "Array of specific object IDs to return",
              },
            },
            required: [] as const,
          },
          function: traced("getBoardState", "Reading board", async (args: { filter?: string; ids?: string[] }) => {
            const objects = await stub.readObjects() as BoardObject[];

            // If specific IDs requested, return only those
            if (args.ids && args.ids.length > 0) {
              const matched = objects.filter((o: BoardObject) => args.ids!.includes(o.id));
              return JSON.stringify(matched);
            }

            // If filter by type
            if (args.filter) {
              const matched = objects.filter((o: BoardObject) => o.type === args.filter);
              return JSON.stringify(matched);
            }

            // Large board summary mode
            if (objects.length >= 20) {
              const counts: Record<string, number> = {};
              for (const o of objects) counts[o.type] = (counts[o.type] || 0) + 1;
              return JSON.stringify({
                summary: true,
                total: objects.length,
                countsByType: counts,
                hint: "Use filter or ids parameter to get specific objects",
              });
            }

            return JSON.stringify(objects);
          }),
        },

        // 10. deleteObject
        {
          name: "deleteObject",
          description: "Delete an object from the whiteboard by its ID",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to delete" },
            },
            required: ["id"] as const,
          },
          function: traced("deleteObject", "Deleting object", async (args: { id: string }) => {
            const result = await stub.mutate({ type: "obj:delete", id: args.id });
            if (!result.ok) return JSON.stringify({ error: result.error });
            return JSON.stringify({ deleted: args.id });
          }),
        },
      ];

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
          for (const t of tools) toolFns[t.name] = (t as any).function;

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

            // Execute all tool calls in parallel (traced() emits SSE events)
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
          // --- Llama 3.3 70B via Workers AI (free tier fallback) ---
          console.warn("[ai] ANTHROPIC_API_KEY not set - using Llama 3.3 70B fallback");
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

          console.debug("[ai] llama final:", text.slice(0, 200));
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
