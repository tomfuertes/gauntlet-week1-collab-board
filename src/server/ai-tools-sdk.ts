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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default random position within usable canvas area */
function randomPos(x?: number, y?: number) {
  return {
    x: x ?? 100 + Math.random() * 700,
    y: Math.max(60, y ?? 100 + Math.random() * 500),
  };
}

/** Create a BoardObject with standard defaults */
function makeObject(
  type: BoardObject["type"],
  pos: { x: number; y: number },
  width: number,
  height: number,
  props: BoardObject["props"],
): BoardObject {
  return {
    id: crypto.randomUUID(),
    type,
    ...pos,
    width,
    height,
    rotation: 0,
    props,
    createdBy: "ai-agent",
    updatedAt: Date.now(),
  };
}

/** Mutate (create) an object, log it, and return position info for LLM chaining */
async function createAndMutate(stub: BoardStub, obj: BoardObject) {
  let result: MutateResult;
  try {
    result = await stub.mutate({ type: "obj:create", obj });
  } catch (err) {
    console.error(
      JSON.stringify({ event: "ai:create:error", type: obj.type, id: obj.id, error: String(err) }),
    );
    return { error: `Failed to create ${obj.type}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!result.ok) {
    console.error(
      JSON.stringify({ event: "ai:create:rejected", type: obj.type, id: obj.id, error: result.error }),
    );
    return { error: result.error };
  }
  console.debug(
    JSON.stringify({
      event: "ai:create",
      type: obj.type,
      id: obj.id,
      x: obj.x,
      y: obj.y,
      w: obj.width,
      h: obj.height,
    }),
  );
  return {
    created: obj.id,
    type: obj.type,
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
  };
}

/** Mutate (update) an object's fields, returning a keyed result for LLM chaining */
async function updateAndMutate(
  stub: BoardStub,
  id: string,
  fields: Omit<Partial<BoardObject>, "id" | "updatedAt">,
  resultKey: string,
  extra?: Record<string, unknown>,
) {
  const result = await stub.mutate({
    type: "obj:update",
    obj: { id, ...fields, updatedAt: Date.now() },
  });
  if (!result.ok) return { error: result.error };
  return { [resultKey]: id, ...extra };
}

/** Check if two board objects overlap (axis-aligned bounding boxes) */
function rectsOverlap(a: BoardObject, b: BoardObject): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Count pairwise overlaps among objects (0 = perfect layout) */
function computeOverlapScore(objects: BoardObject[]): number {
  let overlaps = 0;
  for (let i = 0; i < objects.length; i++)
    for (let j = i + 1; j < objects.length; j++)
      if (rectsOverlap(objects[i], objects[j])) overlaps++;
  return overlaps;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/** Create the full AI SDK tool registry bound to a specific Board DO stub */
export function createSDKTools(stub: BoardStub) {
  return {
    // 1. createStickyNote
    createStickyNote: tool({
      description:
        "Create a sticky note on the whiteboard with text content",
      inputSchema: z.object({
        text: z.string().describe("The text content of the sticky note"),
        x: z
          .number()
          .optional()
          .describe("X position on the canvas (default: random 100-800)"),
        y: z
          .number()
          .optional()
          .describe("Y position on the canvas (default: random 100-600)"),
        color: z
          .string()
          .optional()
          .describe(
            "Hex color (default: #fbbf24 yellow). Options: #fbbf24, #f87171, #4ade80, #60a5fa, #c084fc, #fb923c",
          ),
      }),
      execute: async ({ text, x, y, color }) => {
        const obj = makeObject("sticky", randomPos(x, y), 200, 200, {
          text: text || "New note",
          color: color || "#fbbf24",
        });
        return createAndMutate(stub, obj);
      },
    }),

    // 2. createShape (rect, circle, line)
    createShape: tool({
      description:
        "Create a shape on the whiteboard. Use shape='rect' for rectangle, 'circle' for circle, 'line' for line.",
      inputSchema: z.object({
        shape: z
          .string()
          .describe("Shape type: 'rect', 'circle', or 'line'"),
        x: z
          .number()
          .optional()
          .describe(
            "X position (default: random). For circle: center X. For line: start X.",
          ),
        y: z
          .number()
          .optional()
          .describe(
            "Y position (default: random). For circle: center Y. For line: start Y.",
          ),
        width: z
          .number()
          .optional()
          .describe(
            "Width (default: 150). For circle: diameter. For line: X delta to endpoint.",
          ),
        height: z
          .number()
          .optional()
          .describe(
            "Height (default: 100). For circle: same as width. For line: Y delta to endpoint.",
          ),
        fill: z
          .string()
          .optional()
          .describe("Fill color hex (default: #3b82f6)"),
        stroke: z
          .string()
          .optional()
          .describe("Stroke color hex (default: #2563eb)"),
      }),
      execute: async ({
        shape: shapeArg,
        x,
        y,
        width,
        height,
        fill,
        stroke,
      }) => {
        const shape = shapeArg || "rect";

        if (shape === "circle") {
          const diameter = width ?? 100;
          const center = randomPos(x, y);
          const obj = makeObject(
            "circle",
            { x: center.x - diameter / 2, y: center.y - diameter / 2 },
            diameter,
            diameter,
            { fill: fill || "#3b82f6", stroke: stroke || "#2563eb" },
          );
          return createAndMutate(stub, obj);
        }

        if (shape === "line") {
          const obj = makeObject(
            "line",
            randomPos(x, y),
            width ?? 200,
            height ?? 0,
            { stroke: stroke || "#94a3b8" },
          );
          return createAndMutate(stub, obj);
        }

        // Default: rect
        const obj = makeObject(
          "rect",
          randomPos(x, y),
          width ?? 150,
          height ?? 100,
          { fill: fill || "#3b82f6", stroke: stroke || "#2563eb" },
        );
        return createAndMutate(stub, obj);
      },
    }),

    // 3. createFrame
    createFrame: tool({
      description:
        "Create a frame (labeled container/region) on the whiteboard to group or organize objects. Frames render behind other objects.",
      inputSchema: z.object({
        title: z.string().describe("The frame title/label"),
        x: z
          .number()
          .optional()
          .describe("X position (default: random 100-800)"),
        y: z
          .number()
          .optional()
          .describe("Y position (default: random 100-600)"),
        width: z
          .number()
          .optional()
          .describe("Width in pixels (default: 400)"),
        height: z
          .number()
          .optional()
          .describe("Height in pixels (default: 300)"),
      }),
      execute: async ({ title, x, y, width, height }) => {
        const obj = makeObject(
          "frame",
          randomPos(x, y),
          width ?? 400,
          height ?? 300,
          {
            text:
              typeof title === "string" && title.trim()
                ? title.trim()
                : "Frame",
          },
        );
        return createAndMutate(stub, obj);
      },
    }),

    // 4. createConnector (resolves object centers server-side)
    createConnector: tool({
      description:
        "Create a connector/arrow between two objects on the whiteboard. Pass the IDs of the objects to connect.",
      inputSchema: z.object({
        fromId: z.string().describe("ID of the source object"),
        toId: z.string().describe("ID of the target object"),
        stroke: z
          .string()
          .optional()
          .describe("Stroke color hex (default: #94a3b8)"),
        arrow: z
          .string()
          .optional()
          .describe("Arrow style: 'end' (default), 'both', or 'none'"),
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
          return {
            error: "Cannot create zero-length connector (objects overlap)",
          };
        }

        const arrowStyle =
          arrow === "both" ? "both" : arrow === "none" ? "none" : "end";
        const obj = makeObject("line", { x: x1, y: y1 }, w, h, {
          stroke: stroke || "#94a3b8",
          arrow: arrowStyle as "end" | "both" | "none",
        });
        const result = await createAndMutate(stub, obj);
        if ("error" in result) return result;
        return { ...result, from: fromId, to: toId };
      },
    }),

    // 5. moveObject
    moveObject: tool({
      description:
        "Move an existing object to a new position on the whiteboard",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to move"),
        x: z.number().describe("New X position"),
        y: z.number().describe("New Y position"),
      }),
      execute: async ({ id, x, y }) => {
        return updateAndMutate(stub, id, { x, y }, "moved", { x, y });
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
        return updateAndMutate(stub, id, { width, height }, "resized", { width, height });
      },
    }),

    // 7. updateText
    updateText: tool({
      description:
        "Update the text content of a sticky note, text object, or frame title",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to update"),
        text: z.string().describe("New text content"),
      }),
      execute: async ({ id, text }) => {
        return updateAndMutate(stub, id, { props: { text } }, "updated", { text });
      },
    }),

    // 8. changeColor
    changeColor: tool({
      description:
        "Change the color of an object. Maps to props.color for stickies, props.fill for shapes.",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to recolor"),
        color: z.string().describe("New hex color"),
      }),
      execute: async ({ id, color }) => {
        const existing = await stub.readObject(id);
        if (!existing) return { error: `Object ${id} not found` };

        const props: BoardObject["props"] =
          existing.type === "sticky" || existing.type === "text"
            ? { color }
            : { fill: color };
        return updateAndMutate(stub, id, { props }, "recolored", { color });
      },
    }),

    // 9. getBoardState (with filtering, summary mode, and overlap scoring)
    getBoardState: tool({
      description:
        "Read objects on the whiteboard. Optionally filter by type or specific IDs. For large boards (20+), returns a summary unless filtered.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe(
            "Filter by object type: 'sticky', 'rect', 'circle', 'line', 'text', 'frame'",
          ),
        ids: z
          .array(z.string())
          .optional()
          .describe("Array of specific object IDs to return"),
      }),
      execute: async ({ filter, ids }) => {
        const objects = await stub.readObjects();

        if (ids && ids.length > 0) {
          return objects.filter((o: BoardObject) => ids.includes(o.id));
        }

        if (filter) {
          return objects.filter((o: BoardObject) => o.type === filter);
        }

        // Compute and log overlap score for observability
        const overlapScore = computeOverlapScore(objects);
        if (overlapScore > 0) {
          console.debug(
            JSON.stringify({
              event: "ai:overlap",
              score: overlapScore,
              total: objects.length,
            }),
          );
        }

        if (objects.length >= 20) {
          const counts: Record<string, number> = {};
          for (const o of objects)
            counts[o.type] = (counts[o.type] || 0) + 1;
          return {
            summary: true,
            total: objects.length,
            countsByType: counts,
            overlapScore,
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

/** Tool name = each key in the registry returned by createSDKTools */
export type ToolName = keyof ReturnType<typeof createSDKTools>;
