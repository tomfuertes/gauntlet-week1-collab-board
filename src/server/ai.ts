/* eslint-disable @typescript-eslint/no-explicit-any -- Workers AI types require casts */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getSessionUser } from "./auth";
import { runWithTools } from "@cloudflare/ai-utils";
import type { ChatMessage } from "../shared/types";

type Bindings = {
  DB: D1Database;
  BOARD: DurableObjectNamespace;
  AI: Ai;
  AUTH_SECRET: string;
};

const SYSTEM_PROMPT = `You are a whiteboard assistant for CollabBoard. You help users by manipulating objects on a shared collaborative whiteboard.

IMPORTANT RULES:
- When the user asks to modify, move, recolor, or delete an EXISTING object, you MUST call read_board FIRST to get object IDs, then call update_object or delete_object with the correct ID. NEVER create a new object when the user wants to change an existing one.
- Call each tool ONLY ONCE per action. After a tool returns a result, that action is DONE. Do not repeat the same tool call.
- Be concise and action-oriented. Don't ask for confirmation - just do it.

When creating multiple objects, spread them out so they don't overlap. Use a grid layout with ~220px spacing.

Available shapes: sticky notes (text), standalone text, rectangles (fill+stroke), circles (fill+stroke), lines (stroke only), connectors/arrows (stroke + arrowheads), and frames (labeled containers for grouping).
Available colors for stickies: #fbbf24 (yellow, default), #f87171 (red), #4ade80 (green), #60a5fa (blue), #c084fc (purple), #fb923c (orange).
Available colors for text: any hex color (default: #ffffff white).
Available colors for rectangles and circles: fill any hex color, stroke should be a slightly darker variant.
Available colors for lines and connectors: stroke any hex color (no fill). Default: #94a3b8.
Available arrow styles for connectors: 'end' (default, arrow at endpoint), 'both' (arrows at both ends), 'none' (plain line).

When describing the board, be brief. List objects by type and key content.`;

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const aiRoutes = new Hono<{ Bindings: Bindings }>();

aiRoutes.post("/chat", async (c) => {
  // Auth check
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { message, boardId, history } = await c.req.json<{
    message: string;
    boardId: string;
    history: ChatMessage[];
  }>();

  console.debug(`[ai] chat request from=${user.displayName} board=${boardId} msg="${message.slice(0, 80)}" history=${history.length}`);

  // Get Board DO stub for tool callbacks
  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);

  // Build messages array from history
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
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
        console.debug(`[ai] tool:${name}`, JSON.stringify(args[0]));
        emit({ type: "tool", name, label, args: args[0] });
        return fn(...args);
      }) as T;

      const tools: any[] = [
        {
          name: "create_sticky",
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
          function: traced("create_sticky", "Creating sticky", async (args: { text: string; x?: number; y?: number; color?: string }) => {
            const id = crypto.randomUUID();
            const obj = {
              id,
              type: "sticky" as const,
              x: args.x ?? 100 + Math.random() * 700,
              y: Math.max(60, args.y ?? 100 + Math.random() * 500),
              width: 200,
              height: 200,
              rotation: 0,
              props: { text: args.text, color: args.color || "#fbbf24" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ created: id, type: "sticky", text: args.text });
          }),
        },
        {
          name: "create_text",
          description: "Create standalone text on the whiteboard (no background, just text)",
          parameters: {
            type: "object" as const,
            properties: {
              text: { type: "string" as const, description: "The text content" },
              x: { type: "number" as const, description: "X position on the canvas (default: random 100-800)" },
              y: { type: "number" as const, description: "Y position on the canvas (default: random 100-600)" },
              color: { type: "string" as const, description: "Text color hex (default: #ffffff white)" },
            },
            required: ["text"] as const,
          },
          function: traced("create_text", "Creating text", async (args: { text: string; x?: number; y?: number; color?: string }) => {
            const id = crypto.randomUUID();
            const obj = {
              id,
              type: "text" as const,
              x: args.x ?? 100 + Math.random() * 700,
              y: Math.max(60, args.y ?? 100 + Math.random() * 500),
              width: 200,
              height: 40,
              rotation: 0,
              props: { text: args.text, color: args.color || "#ffffff" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ created: id, type: "text", text: args.text });
          }),
        },
        {
          name: "create_rect",
          description: "Create a rectangle shape on the whiteboard",
          parameters: {
            type: "object" as const,
            properties: {
              x: { type: "number" as const, description: "X position (default: random 100-800)" },
              y: { type: "number" as const, description: "Y position (default: random 100-600)" },
              width: { type: "number" as const, description: "Width in pixels (default: 150)" },
              height: { type: "number" as const, description: "Height in pixels (default: 100)" },
              fill: { type: "string" as const, description: "Fill color hex (default: #3b82f6)" },
              stroke: { type: "string" as const, description: "Stroke color hex (default: #2563eb)" },
            },
            required: [] as const,
          },
          function: traced("create_rect", "Creating rectangle", async (args: { x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string }) => {
            const id = crypto.randomUUID();
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
            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ created: id, type: "rect" });
          }),
        },
        {
          name: "create_circle",
          description: "Create a circle shape on the whiteboard",
          parameters: {
            type: "object" as const,
            properties: {
              x: { type: "number" as const, description: "Center X position (default: random 100-800)" },
              y: { type: "number" as const, description: "Center Y position (default: random 100-600)" },
              radius: { type: "number" as const, description: "Radius in pixels (default: 50)" },
              fill: { type: "string" as const, description: "Fill color hex (default: #3b82f6)" },
              stroke: { type: "string" as const, description: "Stroke color hex (default: #2563eb)" },
            },
            required: [] as const,
          },
          function: traced("create_circle", "Creating circle", async (args: { x?: number; y?: number; radius?: number; fill?: string; stroke?: string }) => {
            const id = crypto.randomUUID();
            const r = args.radius ?? 50;
            const cx = args.x ?? 100 + Math.random() * 700;
            const cy = Math.max(60, args.y ?? 100 + Math.random() * 500);
            const obj = {
              id,
              type: "circle" as const,
              x: cx - r,
              y: cy - r,
              width: r * 2,
              height: r * 2,
              rotation: 0,
              props: { fill: args.fill || "#3b82f6", stroke: args.stroke || "#2563eb" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ created: id, type: "circle", radius: r });
          }),
        },
        {
          name: "create_line",
          description: "Create a line on the whiteboard from point A to point B",
          parameters: {
            type: "object" as const,
            properties: {
              x1: { type: "number" as const, description: "Start X position" },
              y1: { type: "number" as const, description: "Start Y position" },
              x2: { type: "number" as const, description: "End X position" },
              y2: { type: "number" as const, description: "End Y position" },
              stroke: { type: "string" as const, description: "Stroke color hex (default: #94a3b8)" },
            },
            required: ["x1", "y1", "x2", "y2"] as const,
          },
          function: traced("create_line", "Creating line", async (args: { x1: number; y1: number; x2: number; y2: number; stroke?: string }) => {
            const id = crypto.randomUUID();
            const obj = {
              id,
              type: "line" as const,
              x: args.x1,
              y: args.y1,
              width: args.x2 - args.x1,
              height: args.y2 - args.y1,
              rotation: 0,
              props: { stroke: args.stroke || "#94a3b8" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ created: id, type: "line" });
          }),
        },
        {
          name: "create_connector",
          description: "Create a connector/arrow on the whiteboard from point A to point B with arrowhead(s)",
          parameters: {
            type: "object" as const,
            properties: {
              x1: { type: "number" as const, description: "Start X position" },
              y1: { type: "number" as const, description: "Start Y position" },
              x2: { type: "number" as const, description: "End X position (arrow points here)" },
              y2: { type: "number" as const, description: "End Y position (arrow points here)" },
              stroke: { type: "string" as const, description: "Stroke color hex (default: #94a3b8)" },
              arrow: { type: "string" as const, description: "Arrow style: 'end' (default, arrow at endpoint), 'both' (arrows at both ends), 'none' (plain line)" },
            },
            required: ["x1", "y1", "x2", "y2"] as const,
          },
          function: traced("create_connector", "Creating connector", async (args: { x1: number; y1: number; x2: number; y2: number; stroke?: string; arrow?: string }) => {
            const id = crypto.randomUUID();
            const width = args.x2 - args.x1;
            const height = args.y2 - args.y1;
            if (width === 0 && height === 0) {
              return JSON.stringify({ error: "Cannot create zero-length connector (start and end are the same point)" });
            }
            if (args.arrow !== undefined && args.arrow !== "end" && args.arrow !== "both" && args.arrow !== "none") {
              console.warn(`[ai] create_connector: unrecognized arrow style "${args.arrow}", defaulting to "end"`);
            }
            const arrowStyle = args.arrow === "both" ? "both" : args.arrow === "none" ? "none" : "end";
            const obj = {
              id,
              type: "line" as const,
              x: args.x1,
              y: args.y1,
              width,
              height,
              rotation: 0,
              props: { stroke: args.stroke || "#94a3b8", arrow: arrowStyle as "end" | "both" | "none" },
              createdBy: "ai-agent",
              updatedAt: Date.now(),
            };
            const res = await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            if (!res.ok) throw new Error(`DO mutate failed: ${res.status}`);
            return JSON.stringify({ created: id, type: "connector", arrow: arrowStyle });
          }),
        },
        {
          name: "create_frame",
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
          function: traced("create_frame", "Creating frame", async (args: { title: string; x?: number; y?: number; width?: number; height?: number }) => {
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
            const res = await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:create", obj }),
              headers: { "Content-Type": "application/json" },
            }));
            if (!res.ok) throw new Error(`Board mutation failed (${res.status})`);
            return JSON.stringify({ created: id, type: "frame", title: obj.props.text });
          }),
        },
        {
          name: "read_board",
          description: "Read all objects currently on the whiteboard. Returns a list of objects with their id, type, text, position, and color.",
          parameters: {
            type: "object" as const,
            properties: {},
            required: [] as const,
          },
          function: traced("read_board", "Reading board", async () => {
            const res = await stub.fetch(new Request("http://do/read"));
            const objects = await res.json();
            return JSON.stringify(objects);
          }),
        },
        {
          name: "update_object",
          description: "Update an existing object on the whiteboard. Can change text, position, or color.",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to update" },
              text: { type: "string" as const, description: "New text content (for stickies and frame titles)" },
              x: { type: "number" as const, description: "New X position" },
              y: { type: "number" as const, description: "New Y position" },
              color: { type: "string" as const, description: "New color (for stickies)" },
              fill: { type: "string" as const, description: "New fill color (for rects)" },
            },
            required: ["id"] as const,
          },
          function: traced("update_object", "Updating object", async (args: { id: string; text?: string; x?: number; y?: number; color?: string; fill?: string }) => {
            const partial: Record<string, unknown> = { id: args.id };
            if (args.x !== undefined) partial.x = args.x;
            if (args.y !== undefined) partial.y = args.y;
            const props: Record<string, string> = {};
            if (args.text !== undefined) props.text = args.text;
            if (args.color !== undefined) props.color = args.color;
            if (args.fill !== undefined) props.fill = args.fill;
            if (Object.keys(props).length > 0) partial.props = props;
            partial.updatedAt = Date.now();

            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:update", obj: partial }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ updated: args.id });
          }),
        },
        {
          name: "delete_object",
          description: "Delete an object from the whiteboard by its ID",
          parameters: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "The ID of the object to delete" },
            },
            required: ["id"] as const,
          },
          function: traced("delete_object", "Deleting object", async (args: { id: string }) => {
            await stub.fetch(new Request("http://do/mutate", {
              method: "POST",
              body: JSON.stringify({ type: "obj:delete", id: args.id }),
              headers: { "Content-Type": "application/json" },
            }));
            return JSON.stringify({ deleted: args.id });
          }),
        },
      ];

      try {
        emit({ type: "status", label: "Thinking..." });

        const response = await runWithTools(
          c.env.AI as any,
          MODEL as Parameters<typeof runWithTools>[1],
          { messages, tools },
          { maxRecursiveToolRuns: 3, verbose: true },
        );

        const text = typeof response === "string"
          ? response
          : (response as { response?: string }).response ?? "I performed the requested actions on the board.";

        console.debug("[ai] final response:", text.slice(0, 200));
        emit({ type: "done", response: text });
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
