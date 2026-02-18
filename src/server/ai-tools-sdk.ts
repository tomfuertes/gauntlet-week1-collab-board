import { tool } from "ai";
import { z } from "zod";
import type { BoardObject } from "../shared/types";
import type { MutateResult } from "./env";

/** Mutation messages the tool registry can send (excludes cursor) */
type BoardMutation =
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: Partial<BoardObject> & { id: string } }
  | { type: "obj:delete"; id: string };

/** Minimal interface for the Board DO stub methods used by tools */
interface BoardStub {
  readObjects(): Promise<BoardObject[]>;
  readObject(id: string): Promise<BoardObject | null>;
  mutate(msg: BoardMutation): Promise<MutateResult>;
}

/** Create the full AI SDK tool registry bound to a specific Board DO stub */
export function createSDKTools(stub: BoardStub) {
  return {
    // 1. createStickyNote
    createStickyNote: tool({
      description: "Create a sticky note on the whiteboard with text content",
      inputSchema: z.object({
        text: z.string().describe("The text content of the sticky note"),
        x: z.number().optional().describe("X position on the canvas (default: random 100-800)"),
        y: z.number().optional().describe("Y position on the canvas (default: random 100-600)"),
        color: z.string().optional().describe("Hex color (default: #fbbf24 yellow). Options: #fbbf24, #f87171, #4ade80, #60a5fa, #c084fc, #fb923c"),
      }),
      execute: async ({ text, x, y, color }) => {
        const id = crypto.randomUUID();
        const obj = {
          id,
          type: "sticky" as const,
          x: x ?? 100 + Math.random() * 700,
          y: Math.max(60, y ?? 100 + Math.random() * 500),
          width: 200,
          height: 200,
          rotation: 0,
          props: { text: text || "New note", color: color || "#fbbf24" },
          createdBy: "ai-agent",
          updatedAt: Date.now(),
        };
        const result = await stub.mutate({ type: "obj:create", obj });
        if (!result.ok) return { error: result.error };
        return { created: id, type: "sticky", text };
      },
    }),

    // 2. createShape (rect, circle, line)
    createShape: tool({
      description: "Create a shape on the whiteboard. Use shape='rect' for rectangle, 'circle' for circle, 'line' for line.",
      inputSchema: z.object({
        shape: z.string().describe("Shape type: 'rect', 'circle', or 'line'"),
        x: z.number().optional().describe("X position (default: random). For circle: center X. For line: start X."),
        y: z.number().optional().describe("Y position (default: random). For circle: center Y. For line: start Y."),
        width: z.number().optional().describe("Width (default: 150). For circle: diameter. For line: X delta to endpoint."),
        height: z.number().optional().describe("Height (default: 100). For circle: same as width. For line: Y delta to endpoint."),
        fill: z.string().optional().describe("Fill color hex (default: #3b82f6)"),
        stroke: z.string().optional().describe("Stroke color hex (default: #2563eb)"),
      }),
      execute: async ({ shape: shapeArg, x, y, width, height, fill, stroke }) => {
        const shape = shapeArg || "rect";
        const id = crypto.randomUUID();

        if (shape === "circle") {
          const diameter = width ?? 100;
          const cx = x ?? 100 + Math.random() * 700;
          const cy = Math.max(60, y ?? 100 + Math.random() * 500);
          const obj = {
            id,
            type: "circle" as const,
            x: cx - diameter / 2,
            y: cy - diameter / 2,
            width: diameter,
            height: diameter,
            rotation: 0,
            props: { fill: fill || "#3b82f6", stroke: stroke || "#2563eb" },
            createdBy: "ai-agent",
            updatedAt: Date.now(),
          };
          const result = await stub.mutate({ type: "obj:create", obj });
          if (!result.ok) return { error: result.error };
          return { created: id, type: "circle", diameter };
        }

        if (shape === "line") {
          const obj = {
            id,
            type: "line" as const,
            x: x ?? 100 + Math.random() * 700,
            y: Math.max(60, y ?? 100 + Math.random() * 500),
            width: width ?? 200,
            height: height ?? 0,
            rotation: 0,
            props: { stroke: stroke || "#94a3b8" },
            createdBy: "ai-agent",
            updatedAt: Date.now(),
          };
          const result = await stub.mutate({ type: "obj:create", obj });
          if (!result.ok) return { error: result.error };
          return { created: id, type: "line" };
        }

        // Default: rect
        const obj = {
          id,
          type: "rect" as const,
          x: x ?? 100 + Math.random() * 700,
          y: Math.max(60, y ?? 100 + Math.random() * 500),
          width: width ?? 150,
          height: height ?? 100,
          rotation: 0,
          props: { fill: fill || "#3b82f6", stroke: stroke || "#2563eb" },
          createdBy: "ai-agent",
          updatedAt: Date.now(),
        };
        const result = await stub.mutate({ type: "obj:create", obj });
        if (!result.ok) return { error: result.error };
        return { created: id, type: "rect" };
      },
    }),

    // 3. createFrame
    createFrame: tool({
      description: "Create a frame (labeled container/region) on the whiteboard to group or organize objects. Frames render behind other objects.",
      inputSchema: z.object({
        title: z.string().describe("The frame title/label"),
        x: z.number().optional().describe("X position (default: random 100-800)"),
        y: z.number().optional().describe("Y position (default: random 100-600)"),
        width: z.number().optional().describe("Width in pixels (default: 400)"),
        height: z.number().optional().describe("Height in pixels (default: 300)"),
      }),
      execute: async ({ title, x, y, width, height }) => {
        const id = crypto.randomUUID();
        const obj = {
          id,
          type: "frame" as const,
          x: x ?? 100 + Math.random() * 700,
          y: Math.max(60, y ?? 100 + Math.random() * 500),
          width: width ?? 400,
          height: height ?? 300,
          rotation: 0,
          props: { text: typeof title === "string" && title.trim() ? title.trim() : "Frame" },
          createdBy: "ai-agent",
          updatedAt: Date.now(),
        };
        const result = await stub.mutate({ type: "obj:create", obj });
        if (!result.ok) return { error: result.error };
        return { created: id, type: "frame", title: obj.props.text };
      },
    }),

    // 4. createConnector (resolves object centers server-side)
    createConnector: tool({
      description: "Create a connector/arrow between two objects on the whiteboard. Pass the IDs of the objects to connect.",
      inputSchema: z.object({
        fromId: z.string().describe("ID of the source object"),
        toId: z.string().describe("ID of the target object"),
        stroke: z.string().optional().describe("Stroke color hex (default: #94a3b8)"),
        arrow: z.string().optional().describe("Arrow style: 'end' (default), 'both', or 'none'"),
      }),
      execute: async ({ fromId, toId, stroke, arrow }) => {
        const fromObj = await stub.readObject(fromId);
        const toObj = await stub.readObject(toId);
        if (!fromObj) return { error: `Source object ${fromId} not found` };
        if (!toObj) return { error: `Target object ${toId} not found` };

        const x1 = fromObj.x + fromObj.width / 2;
        const y1 = fromObj.y + fromObj.height / 2;
        const x2 = toObj.x + toObj.width / 2;
        const y2 = toObj.y + toObj.height / 2;

        const w = x2 - x1;
        const h = y2 - y1;
        if (w === 0 && h === 0) {
          return { error: "Cannot create zero-length connector (objects overlap)" };
        }

        const arrowStyle = arrow === "both" ? "both" : arrow === "none" ? "none" : "end";
        const id = crypto.randomUUID();
        const obj = {
          id,
          type: "line" as const,
          x: x1,
          y: y1,
          width: w,
          height: h,
          rotation: 0,
          props: { stroke: stroke || "#94a3b8", arrow: arrowStyle as "end" | "both" | "none" },
          createdBy: "ai-agent",
          updatedAt: Date.now(),
        };
        const result = await stub.mutate({ type: "obj:create", obj });
        if (!result.ok) return { error: result.error };
        return { created: id, type: "connector", from: fromId, to: toId };
      },
    }),

    // 5. moveObject
    moveObject: tool({
      description: "Move an existing object to a new position on the whiteboard",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to move"),
        x: z.number().describe("New X position"),
        y: z.number().describe("New Y position"),
      }),
      execute: async ({ id, x, y }) => {
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id, x, y, updatedAt: Date.now() },
        });
        if (!result.ok) return { error: result.error };
        return { moved: id, x, y };
      },
    }),

    // 6. resizeObject
    resizeObject: tool({
      description: "Resize an existing object on the whiteboard",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to resize"),
        width: z.number().describe("New width"),
        height: z.number().describe("New height"),
      }),
      execute: async ({ id, width, height }) => {
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id, width, height, updatedAt: Date.now() },
        });
        if (!result.ok) return { error: result.error };
        return { resized: id, width, height };
      },
    }),

    // 7. updateText
    updateText: tool({
      description: "Update the text content of a sticky note, text object, or frame title",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to update"),
        text: z.string().describe("New text content"),
      }),
      execute: async ({ id, text }) => {
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id, props: { text }, updatedAt: Date.now() },
        });
        if (!result.ok) return { error: result.error };
        return { updated: id, text };
      },
    }),

    // 8. changeColor
    changeColor: tool({
      description: "Change the color of an object. Maps to props.color for stickies, props.fill for shapes.",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to recolor"),
        color: z.string().describe("New hex color"),
      }),
      execute: async ({ id, color }) => {
        const existing = await stub.readObject(id);
        if (!existing) return { error: `Object ${id} not found` };

        const props: Record<string, string> = {};
        if (existing.type === "sticky" || existing.type === "text") {
          props.color = color;
        } else {
          props.fill = color;
        }
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id, props, updatedAt: Date.now() },
        });
        if (!result.ok) return { error: result.error };
        return { recolored: id, color };
      },
    }),

    // 9. getBoardState (with filtering and summary mode)
    getBoardState: tool({
      description: "Read objects on the whiteboard. Optionally filter by type or specific IDs. For large boards (20+), returns a summary unless filtered.",
      inputSchema: z.object({
        filter: z.string().optional().describe("Filter by object type: 'sticky', 'rect', 'circle', 'line', 'text', 'frame'"),
        ids: z.array(z.string()).optional().describe("Array of specific object IDs to return"),
      }),
      execute: async ({ filter, ids }) => {
        const objects = await stub.readObjects();

        if (ids && ids.length > 0) {
          const matched = objects.filter((o: BoardObject) => ids.includes(o.id));
          return matched;
        }

        if (filter) {
          const matched = objects.filter((o: BoardObject) => o.type === filter);
          return matched;
        }

        if (objects.length >= 20) {
          const counts: Record<string, number> = {};
          for (const o of objects) counts[o.type] = (counts[o.type] || 0) + 1;
          return {
            summary: true,
            total: objects.length,
            countsByType: counts,
            hint: "Use filter or ids parameter to get specific objects",
          };
        }

        return objects;
      },
    }),

    // 10. deleteObject
    deleteObject: tool({
      description: "Delete an object from the whiteboard by its ID",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to delete"),
      }),
      execute: async ({ id }) => {
        const result = await stub.mutate({ type: "obj:delete", id });
        if (!result.ok) return { error: result.error };
        return { deleted: id };
      },
    }),
  };
}
