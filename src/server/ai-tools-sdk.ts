import { tool } from "ai";
import { z } from "zod";
import { AI_USER_ID } from "../shared/types";
import type {
  BoardObject,
  BoardObjectProps,
  BoardObjectUpdate,
  MutateResult,
  BoardStub,
  CharacterRelationship,
} from "../shared/types";
import { computeConnectedLineGeometry, getEdgePoint, type ObjectBounds } from "../shared/connection-geometry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Visually distinct colors for AI-created objects on the dark canvas background.
 *  Mirrors CURSOR_COLORS in theme.ts - kept separate to avoid client/server coupling.
 *  KEY-DECISION 2026-02-20: Per-createSDKTools-call rotation ensures multi-entity scenes
 *  have distinct colors without requiring the LLM to specify them each time. */
const AI_PALETTE = [
  "#f87171", // red
  "#60a5fa", // blue
  "#4ade80", // green
  "#fbbf24", // yellow
  "#a78bfa", // violet
  "#f472b6", // pink
  "#34d399", // emerald
  "#fb923c", // orange
] as const;

/** Magic number defaults for tool dimensions and colors */
const TOOL_DEFAULTS = {
  sticky: { width: 200, height: 200, color: "#fbbf24" },
  rect: { width: 150, height: 100, fill: "#3b82f6", stroke: "#2563eb" },
  circle: { diameter: 100, fill: "#3b82f6", stroke: "#2563eb" },
  line: { width: 200, height: 0, stroke: "#94a3b8" },
  frame: { width: 400, height: 300 },
  image: { width: 512, height: 512 },
  connector: { stroke: "#94a3b8" },
  person: { width: 80, height: 120, color: "#6366f1" }, // indigo; SPARK=#fb923c, SAGE=#4ade80
} as const;

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
  props: BoardObjectProps,
  batchId?: string,
): BoardObject {
  // Cast: TS can't narrow type+props combo from separate args
  return {
    id: crypto.randomUUID(),
    type,
    ...pos,
    width,
    height,
    rotation: 0,
    props,
    createdBy: AI_USER_ID,
    updatedAt: Date.now(),
    ...(batchId ? { batchId } : {}),
  } as BoardObject;
}

/** Mutate (create) an object, log it, and return position info for LLM chaining */
async function createAndMutate(stub: BoardStub, obj: BoardObject) {
  let result: MutateResult;
  try {
    result = await stub.mutate({ type: "obj:create", obj });
  } catch (err) {
    console.error(JSON.stringify({ event: "ai:create:error", type: obj.type, id: obj.id, error: String(err) }));
    return { error: `Failed to create ${obj.type}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!result.ok) {
    console.error(JSON.stringify({ event: "ai:create:rejected", type: obj.type, id: obj.id, error: result.error }));
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
  cursorToCenter(stub, obj);
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
  fields: Omit<BoardObjectUpdate, "id">,
  resultKey: string,
  extra?: Record<string, unknown>,
  anim?: { duration: number },
) {
  let result: MutateResult;
  try {
    result = await stub.mutate({
      type: "obj:update",
      obj: { id, ...fields, updatedAt: Date.now() },
      ...(anim ? { anim } : {}),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "ai:update:error", id, error: String(err) }));
    return { error: `Failed to update ${id}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!result.ok) return { error: result.error ?? "Unknown mutation error" };
  return { [resultKey]: id, ...extra };
}

/** Cascade: recalculate geometry for all lines connected to a changed object */
async function cascadeConnectedLines(stub: BoardStub, changedId: string, changedObj: ObjectBounds) {
  const allObjects = await stub.readObjects();
  for (const obj of allObjects) {
    if (obj.type !== "line") continue;
    if (obj.startObjectId !== changedId && obj.endObjectId !== changedId) continue;
    const startObj =
      obj.startObjectId === changedId
        ? changedObj
        : obj.startObjectId
          ? allObjects.find((o) => o.id === obj.startObjectId)
          : null;
    const endObj =
      obj.endObjectId === changedId
        ? changedObj
        : obj.endObjectId
          ? allObjects.find((o) => o.id === obj.endObjectId)
          : null;
    if (!startObj && !endObj) continue;
    let geo: { x: number; y: number; width: number; height: number };
    if (startObj && endObj) {
      geo = computeConnectedLineGeometry(startObj, endObj);
    } else if (startObj) {
      const endX = obj.x + obj.width;
      const endY = obj.y + obj.height;
      const edge = getEdgePoint(startObj, endX, endY);
      geo = { x: edge.x, y: edge.y, width: endX - edge.x, height: endY - edge.y };
    } else {
      const edge = getEdgePoint(endObj!, obj.x, obj.y);
      geo = { x: obj.x, y: obj.y, width: edge.x - obj.x, height: edge.y - obj.y };
    }
    await updateAndMutate(stub, obj.id, geo, "lineUpdated");
  }
}

/** Fire-and-forget: move AI cursor to object center. Never blocks tool execution. */
function cursorToCenter(stub: BoardStub, obj: { x: number; y: number; width: number; height: number }) {
  stub.injectCursor(obj.x + obj.width / 2, obj.y + obj.height / 2).catch((err: unknown) => {
    console.debug(JSON.stringify({ event: "ai:cursor:error", error: String(err) }));
  });
}

/**
 * Read an object by ID and move the AI cursor to its center.
 * Returns the object (or null). Used by move/resize/text/color tools
 * that need the existing object before mutating.
 */
async function readAndCenter(stub: BoardStub, id: string): Promise<BoardObject | null> {
  const obj = await stub.readObject(id);
  if (obj) cursorToCenter(stub, obj);
  return obj;
}

/** Check if two board objects overlap (axis-aligned bounding boxes) */
export function rectsOverlap(a: BoardObject, b: BoardObject): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Count pairwise overlaps among objects (0 = perfect layout) */
export function computeOverlapScore(objects: BoardObject[]): number {
  let overlaps = 0;
  for (let i = 0; i < objects.length; i++)
    for (let j = i + 1; j < objects.length; j++) if (rectsOverlap(objects[i], objects[j])) overlaps++;
  return overlaps;
}

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

/** Type guard: is value a non-null, non-array object (i.e. a valid JSON dict)? */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wrap a tool execute function with timing and structured logging */
function instrumentExecute<TArgs, TResult>(
  toolName: string,
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    // Guard: reject non-object inputs from malformed LLM tool calls.
    // Free-tier models (GLM-4.7-Flash) sometimes emit strings or nulls.
    if (!isPlainObject(args)) {
      const inputType = args === null ? "null" : Array.isArray(args) ? "array" : typeof args;
      console.error(
        JSON.stringify({
          event: "ai:tool:invalid-input",
          tool: toolName,
          inputType,
          input: String(args).slice(0, 200),
        }),
      );
      return {
        error: `Invalid input for ${toolName}: expected object, got ${inputType}`,
      } as unknown as TResult;
    }

    const start = Date.now();
    try {
      const result = await fn(args);
      const durationMs = Date.now() - start;
      const ok = !(result && typeof result === "object" && "error" in result);
      console.debug(
        JSON.stringify({
          event: "ai:tool",
          tool: toolName,
          durationMs,
          ok,
          ...(ok ? {} : { error: (result as Record<string, unknown>).error }),
        }),
      );
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      console.error(
        JSON.stringify({
          event: "ai:tool",
          tool: toolName,
          durationMs,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      // KEY-DECISION 2026-02-20: Return error as a result object instead of rethrowing.
      // Tools that throw (e.g. stub.readObject() DO RPC failure) would otherwise bubble to the
      // AI SDK where error visibility to the LLM depends on SDK internals. Returning { error }
      // is the consistent pattern used by createAndMutate/updateAndMutate - the LLM always sees
      // a tool result it can act on (retry, inform user) rather than an opaque exception.
      return { error: `${toolName} failed: ${err instanceof Error ? err.message : String(err)}` } as unknown as TResult;
    }
  };
}

/** Board object with LLM-irrelevant fields stripped for token savings */
type LLMBoardObject = Omit<BoardObject, "updatedAt" | "createdBy" | "batchId" | "rotation" | "isBackground"> & {
  rotation?: number;
};

/** Strip LLM-irrelevant fields from board objects to reduce token usage.
 *  Background objects should be filtered before calling this (see getBoardState). */
function stripForLLM(obj: BoardObject): LLMBoardObject {
  const { updatedAt: _updatedAt, createdBy: _createdBy, batchId: _batchId, isBackground: _bg, rotation, ...rest } = obj;
  // Strip base64 src from images (massive, useless for LLM) - keep prompt for context
  if (rest.type === "image" && rest.props.src) {
    rest.props = { ...rest.props, src: "[base64 image]" };
  }
  // Only include rotation when non-zero (meaningful)
  if (rotation) return { ...rest, rotation };
  return rest;
}

// ---------------------------------------------------------------------------
// Image generation helper (shared by generateImage tool + stage backgrounds)
// ---------------------------------------------------------------------------

/** Generate an image via CF Workers AI SDXL and return a data URL.
 *  Throws on failure - callers must handle errors. */
export async function generateImageDataUrl(ai: Ai, prompt: string): Promise<string> {
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB raw - keeps base64 under DO SQLite 2MB value limit

  const response = await ai.run(
    "@cf/stabilityai/stable-diffusion-xl-base-1.0" as Parameters<Ai["run"]>[0],
    { prompt, width: 512, height: 512 } as Record<string, unknown>,
  );

  if (!response || typeof (response as ReadableStream).getReader !== "function") {
    const responseType = response === null ? "null" : typeof response;
    throw new Error(`Image generation returned unexpected response type: ${responseType}`);
  }

  const stream = response as ReadableStream<Uint8Array>;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.byteLength;
  }

  if (totalLen === 0) {
    throw new Error("Image generation returned empty response (0 bytes)");
  }
  if (totalLen > MAX_IMAGE_BYTES) {
    throw new Error(`Generated image too large (${(totalLen / 1024).toFixed(0)}KB)`);
  }

  const imageBytes = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    imageBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // btoa works on latin1 strings; build from byte array
  let binary = "";
  for (let i = 0; i < imageBytes.length; i++) {
    binary += String.fromCharCode(imageBytes[i]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/** Create the full AI SDK tool registry bound to a specific Board DO stub */
export function createSDKTools(stub: BoardStub, batchId?: string, ai?: Ai, storage?: DurableObjectStorage) {
  // Rotate through AI_PALETTE per streamText call so multi-entity scenes get distinct colors.
  // Only used as fallback when the LLM doesn't specify an explicit color.
  let paletteIndex = 0;
  const nextPaletteColor = () => AI_PALETTE[paletteIndex++ % AI_PALETTE.length];

  const baseTools = {
    // 1. createStickyNote
    createStickyNote: tool({
      description:
        "Create a sticky note (colored card) on the whiteboard. Use ONLY for action words, exclamations, " +
        "or status callouts that benefit from the colored card background (e.g. 'BANG!', 'DUCK!', 'DANGER!'). " +
        "For dialogue, narration, labels, and descriptions, use createText instead (it's the default for text content).",
      inputSchema: z.object({
        text: z.string().describe("The text content of the sticky note"),
        x: z.number().optional().describe("X position on the canvas (default: random 100-800)"),
        y: z.number().optional().describe("Y position on the canvas (default: random 100-600)"),
        color: z
          .string()
          .optional()
          .describe(
            "Hex color (default: #fbbf24 yellow). Options: #fbbf24, #f87171, #4ade80, #60a5fa, #c084fc, #fb923c",
          ),
      }),
      execute: instrumentExecute("createStickyNote", async ({ text, x, y, color }) => {
        const obj = makeObject(
          "sticky",
          randomPos(x, y),
          TOOL_DEFAULTS.sticky.width,
          TOOL_DEFAULTS.sticky.height,
          {
            text: text || "New note",
            color: color || nextPaletteColor(),
          },
          batchId,
        );
        return createAndMutate(stub, obj);
      }),
    }),

    // 2. createPerson
    createPerson: tool({
      description:
        "Place a character (stick figure) on the canvas with a name label above their head. " +
        "Use for scene characters, players, NPCs, and crowd members. " +
        "Use persona colors for AI characters: SPARK=#fb923c, SAGE=#4ade80. " +
        "Prefer createPerson over drawScene for human characters.",
      inputSchema: z.object({
        name: z.string().describe("Character name shown above the figure (e.g. 'Dr. Fang', 'The Patient', 'Nurse')"),
        x: z.number().optional().describe("X position on canvas (default: random 100-800)"),
        y: z.number().optional().describe("Y position on canvas (default: random 100-600)"),
        color: z
          .string()
          .optional()
          .describe(
            "Figure color hex (default: #6366f1 indigo). SPARK=#fb923c, SAGE=#4ade80. Use player color to represent a specific user.",
          ),
      }),
      execute: instrumentExecute("createPerson", async ({ name, x, y, color }) => {
        const obj = makeObject(
          "person",
          randomPos(x, y),
          TOOL_DEFAULTS.person.width,
          TOOL_DEFAULTS.person.height,
          {
            text: typeof name === "string" && name.trim() ? name.trim() : "Character",
            color: color || nextPaletteColor(),
          },
          batchId,
        );
        return createAndMutate(stub, obj);
      }),
    }),

    // 3. createShape (rect, circle, line)
    createShape: tool({
      description:
        "Create a shape on the whiteboard. Use shape='rect' for rectangle, 'circle' for circle, 'line' for line.",
      inputSchema: z.object({
        shape: z.string().describe("Shape type: 'rect', 'circle', or 'line'"),
        x: z.number().optional().describe("X position (default: random). For circle: center X. For line: start X."),
        y: z.number().optional().describe("Y position (default: random). For circle: center Y. For line: start Y."),
        width: z
          .number()
          .optional()
          .describe("Width (default: 150). For circle: diameter. For line: X delta to endpoint."),
        height: z
          .number()
          .optional()
          .describe("Height (default: 100). For circle: same as width. For line: Y delta to endpoint."),
        fill: z.string().optional().describe("Fill color hex (default: #3b82f6)"),
        stroke: z.string().optional().describe("Stroke color hex (default: #2563eb)"),
      }),
      execute: instrumentExecute("createShape", async ({ shape: shapeArg, x, y, width, height, fill, stroke }) => {
        const shape = shapeArg || "rect";

        if (shape === "circle") {
          const diameter = width ?? TOOL_DEFAULTS.circle.diameter;
          const center = randomPos(x, y);
          const palFill = fill || nextPaletteColor();
          const obj = makeObject(
            "circle",
            { x: center.x - diameter / 2, y: center.y - diameter / 2 },
            diameter,
            diameter,
            { fill: palFill, stroke: stroke || palFill },
            batchId,
          );
          return createAndMutate(stub, obj);
        }

        if (shape === "line") {
          const obj = makeObject(
            "line",
            randomPos(x, y),
            width ?? TOOL_DEFAULTS.line.width,
            height ?? TOOL_DEFAULTS.line.height,
            { stroke: stroke || TOOL_DEFAULTS.line.stroke },
            batchId,
          );
          return createAndMutate(stub, obj);
        }

        // Default: rect
        const palFill = fill || nextPaletteColor();
        const obj = makeObject(
          "rect",
          randomPos(x, y),
          width ?? TOOL_DEFAULTS.rect.width,
          height ?? TOOL_DEFAULTS.rect.height,
          { fill: palFill, stroke: stroke || palFill },
          batchId,
        );
        return createAndMutate(stub, obj);
      }),
    }),

    // 3. createFrame
    createFrame: tool({
      description:
        "Create a frame (labeled container/region) on the whiteboard to group or organize objects. Frames render behind other objects.",
      inputSchema: z.object({
        title: z.string().describe("The frame title/label"),
        x: z.number().optional().describe("X position (default: random 100-800)"),
        y: z.number().optional().describe("Y position (default: random 100-600)"),
        width: z.number().optional().describe("Width in pixels (default: 400)"),
        height: z.number().optional().describe("Height in pixels (default: 300)"),
      }),
      execute: instrumentExecute("createFrame", async ({ title, x, y, width, height }) => {
        const obj = makeObject(
          "frame",
          randomPos(x, y),
          width ?? TOOL_DEFAULTS.frame.width,
          height ?? TOOL_DEFAULTS.frame.height,
          {
            text: typeof title === "string" && title.trim() ? title.trim() : "Frame",
          },
          batchId,
        );
        return createAndMutate(stub, obj);
      }),
    }),

    // 4. createConnector (resolves object centers server-side)
    createConnector: tool({
      description:
        "Create a connector/arrow between two objects on the whiteboard. Pass the IDs of the objects to connect.",
      inputSchema: z.object({
        fromId: z.string().describe("ID of the source object"),
        toId: z.string().describe("ID of the target object"),
        stroke: z.string().optional().describe("Stroke color hex (default: #94a3b8)"),
        arrow: z.string().optional().describe("Arrow style: 'end' (default), 'both', or 'none'"),
      }),
      execute: instrumentExecute("createConnector", async ({ fromId, toId, stroke, arrow }) => {
        const fromObj = await stub.readObject(fromId);
        const toObj = await stub.readObject(toId);
        if (!fromObj) return { error: `Source object ${fromId} not found` };
        if (!toObj) return { error: `Target object ${toId} not found` };

        // Edge-snapped geometry instead of center-to-center
        const geo = computeConnectedLineGeometry(fromObj, toObj);
        if (geo.width === 0 && geo.height === 0) {
          return { error: "Cannot create zero-length connector (objects overlap)" };
        }

        const arrowStyle = arrow === "both" ? "both" : arrow === "none" ? "none" : "end";
        const obj = makeObject(
          "line",
          { x: geo.x, y: geo.y },
          geo.width,
          geo.height,
          {
            stroke: stroke || TOOL_DEFAULTS.connector.stroke,
            arrow: arrowStyle as "end" | "both" | "none",
          },
          batchId,
        );
        // Store connection bindings so lines follow when objects move
        obj.startObjectId = fromId;
        obj.endObjectId = toId;
        const result = await createAndMutate(stub, obj);
        if ("error" in result) return result;
        return { ...result, from: fromId, to: toId };
      }),
    }),

    // 5. moveObject
    moveObject: tool({
      description: "Move an existing object to a new position on the whiteboard",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to move"),
        x: z.number().describe("New X position"),
        y: z.number().describe("New Y position"),
        duration: z.number().optional().describe("Animation duration in ms, default 500"),
      }),
      execute: instrumentExecute("moveObject", async ({ id, x, y, duration }) => {
        const existing = await readAndCenter(stub, id);
        if (existing) cursorToCenter(stub, { x, y, width: existing.width, height: existing.height });
        const result = await updateAndMutate(stub, id, { x, y }, "moved", { x, y }, { duration: duration ?? 500 });
        if ("error" in result) return result;

        // Cascade: update connected lines
        if (existing) await cascadeConnectedLines(stub, id, { ...existing, x, y });
        return result;
      }),
    }),

    // 6. resizeObject
    resizeObject: tool({
      description: "Resize an existing object on the whiteboard",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to resize"),
        width: z.number().describe("New width"),
        height: z.number().describe("New height"),
      }),
      execute: instrumentExecute("resizeObject", async ({ id, width, height }) => {
        const existing = await readAndCenter(stub, id);
        if (existing) cursorToCenter(stub, { x: existing.x, y: existing.y, width, height });
        const result = await updateAndMutate(stub, id, { width, height }, "resized", { width, height });
        if ("error" in result) return result;

        // Cascade: update connected lines
        if (existing) await cascadeConnectedLines(stub, id, { ...existing, width, height });
        return result;
      }),
    }),

    // 7. updateText
    updateText: tool({
      description: "Update the text content of a sticky note, text object, or frame title",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to update"),
        text: z.string().describe("New text content"),
      }),
      execute: instrumentExecute("updateText", async ({ id, text }) => {
        await readAndCenter(stub, id);
        return updateAndMutate(stub, id, { props: { text } }, "updated", { text });
      }),
    }),

    // 8. changeColor
    changeColor: tool({
      description: "Change the color of an object. Maps to props.color for stickies, props.fill for shapes.",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to recolor"),
        color: z.string().describe("New hex color"),
      }),
      execute: instrumentExecute("changeColor", async ({ id, color }) => {
        const existing = await readAndCenter(stub, id);
        if (!existing) return { error: `Object ${id} not found` };
        const props: BoardObjectProps =
          existing.type === "sticky" || existing.type === "text"
            ? { color }
            : existing.type === "line"
              ? { stroke: color }
              : { fill: color };
        return updateAndMutate(stub, id, { props }, "recolored", { color });
      }),
    }),

    // 9. getBoardState (with filtering, summary mode, and overlap scoring)
    getBoardState: tool({
      description:
        "Read objects on the whiteboard. Optionally filter by type or specific IDs. For large boards (20+), returns a summary unless filtered.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter by object type: 'sticky', 'rect', 'circle', 'line', 'text', 'frame', 'image', 'person'"),
        ids: z.array(z.string()).optional().describe("Array of specific object IDs to return"),
      }),
      execute: instrumentExecute("getBoardState", async ({ filter, ids }) => {
        const allObjects = await stub.readObjects();
        // Exclude background images from AI context (decorative, huge base64)
        const objects = allObjects.filter((o: BoardObject) => !o.isBackground);

        if (ids && ids.length > 0) {
          return objects.filter((o: BoardObject) => ids.includes(o.id)).map(stripForLLM);
        }

        if (filter) {
          return objects.filter((o: BoardObject) => o.type === filter).map(stripForLLM);
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
          for (const o of objects) counts[o.type] = (counts[o.type] || 0) + 1;
          return {
            summary: true,
            total: objects.length,
            countsByType: counts,
            overlapScore,
            hint: "Use filter or ids parameter to get specific objects",
          };
        }

        return objects.map(stripForLLM);
      }),
    }),

    // 10. deleteObject
    deleteObject: tool({
      description: "Delete an object from the whiteboard by its ID",
      inputSchema: z.object({
        id: z.string().describe("The ID of the object to delete"),
      }),
      execute: instrumentExecute("deleteObject", async ({ id }) => {
        let result: MutateResult;
        try {
          result = await stub.mutate({ type: "obj:delete", id });
        } catch (err) {
          console.error(JSON.stringify({ event: "ai:delete:error", id, error: String(err) }));
          return { error: `Failed to delete ${id}: ${err instanceof Error ? err.message : String(err)}` };
        }
        if (!result.ok) return { error: result.error };
        return { deleted: id };
      }),
    }),

    // 11. generateImage
    generateImage: tool({
      description:
        "Generate an AI image from a text prompt and place it on the whiteboard. Uses Stable Diffusion XL. Great for illustrations, scene backdrops, character portraits, props, etc.",
      inputSchema: z.object({
        prompt: z.string().describe("Text description of the image to generate (be specific and descriptive)"),
        x: z.number().optional().describe("X position on the canvas (default: random 100-800)"),
        y: z.number().optional().describe("Y position on the canvas (default: random 100-600)"),
        width: z.number().optional().describe("Display width on the board in pixels (default: 512)"),
        height: z.number().optional().describe("Display height on the board in pixels (default: 512)"),
      }),
      execute: instrumentExecute("generateImage", async ({ prompt, x, y, width, height }) => {
        if (!ai) {
          return { error: "Image generation unavailable (AI binding not configured)" };
        }

        let src: string;
        try {
          src = await generateImageDataUrl(ai, prompt);
        } catch (err) {
          console.error(
            JSON.stringify({ event: "ai:image:generate-error", prompt: prompt.slice(0, 100), error: String(err) }),
          );
          return { error: `Image generation failed: ${err instanceof Error ? err.message : String(err)}` };
        }

        const displayW = width ?? TOOL_DEFAULTS.image.width;
        const displayH = height ?? TOOL_DEFAULTS.image.height;
        const obj = makeObject("image", randomPos(x, y), displayW, displayH, { src, prompt }, batchId);
        return createAndMutate(stub, obj);
      }),
    }),

    // 12. createText
    createText: tool({
      description:
        "Create a text label on the whiteboard. DEFAULT for dialogue, narration, labels, descriptions, captions, " +
        "character speech, scene text, and names. Prefer this over createStickyNote for virtually all text content. " +
        "Only use createStickyNote when the colored card background adds visual meaning (action words, exclamations).",
      inputSchema: z.object({
        text: z.string().describe("The text content"),
        x: z.number().describe("X position on the canvas"),
        y: z.number().describe("Y position on the canvas"),
        color: z.string().optional().describe("Text color hex (default: #1a1a2e)"),
      }),
      execute: instrumentExecute("createText", async ({ text, x, y, color }) => {
        const charWidth = 8; // ~8px per char at default 16px font
        const width = Math.max(40, text.length * charWidth + 16);
        const height = 24;
        const obj = makeObject("text", { x, y }, width, height, { text, color: color || "#1a1a2e" }, batchId);
        return createAndMutate(stub, obj);
      }),
    }),

    // 13. highlightObject
    highlightObject: tool({
      description:
        "Apply a transient visual effect to an existing object for dramatic emphasis. " +
        "pulse: brief scale-up bounce. shake: rapid side-to-side jitter. flash: opacity blink.",
      inputSchema: z.object({
        id: z.string().describe("ID of the object to highlight"),
        effect: z.enum(["pulse", "shake", "flash"]).describe("Effect type: 'pulse', 'shake', or 'flash'"),
      }),
      execute: instrumentExecute("highlightObject", async ({ id, effect }) => {
        await readAndCenter(stub, id);
        const result = await stub.mutate({ type: "obj:effect", id, effect });
        if (!result.ok) return { error: result.error };
        return { highlighted: id, effect };
      }),
    }),

    // 14. setRelationship
    setRelationship: tool({
      description:
        "Record or update a relationship between two characters or entities in the scene. " +
        "Call when characters first meaningfully interact or when a relationship changes. " +
        "Max 1 setRelationship call per exchange. Use character names as they appear on canvas.",
      inputSchema: z.object({
        entityA: z.string().describe("First character/entity name"),
        entityB: z.string().describe("Second character/entity name"),
        descriptor: z
          .string()
          .describe("Relationship descriptor (e.g. 'rivals', 'reluctant allies', 'secretly siblings')"),
      }),
      execute: instrumentExecute("setRelationship", async ({ entityA, entityB, descriptor }) => {
        if (!storage) return { error: "Narrative storage unavailable" };

        const existing = (await storage.get<CharacterRelationship[]>("narrative:relationships")) ?? [];

        // Upsert: match on pair in either order
        const idx = existing.findIndex(
          (r) => (r.entityA === entityA && r.entityB === entityB) || (r.entityA === entityB && r.entityB === entityA),
        );

        const updated: CharacterRelationship = { entityA, entityB, descriptor, updatedAt: Date.now() };
        let next: CharacterRelationship[];
        if (idx !== -1) {
          next = [...existing];
          next[idx] = updated;
        } else {
          // Cap at 12 relationships (keep most recent)
          next = [...existing.slice(-11), updated];
        }

        await storage.put("narrative:relationships", next);
        return { relationship: `${entityA} & ${entityB}: ${descriptor}` };
      }),
    }),

    // 15. advanceScenePhase
    advanceScenePhase: tool({
      description:
        "Advance the scene to the next lifecycle phase. Call when the scene naturally transitions. " +
        "Phases in order: establish -> build -> peak -> resolve -> curtain. " +
        "Only call at genuine phase transitions - do not skip phases or regress.",
      inputSchema: z.object({
        phase: z
          .enum(["establish", "build", "peak", "resolve", "curtain"])
          .describe("Target phase to advance to (must be later than current phase)"),
        reason: z.string().describe("Brief reason for advancing (e.g. 'All characters introduced, complications set')"),
      }),
      execute: instrumentExecute("advanceScenePhase", async ({ phase, reason }) => {
        if (!storage) return { error: "Lifecycle storage unavailable" };
        await storage.put("scene:lifecyclePhase", phase);
        console.debug(JSON.stringify({ event: "lifecycle:advance", phase, reason }));
        return { advanced: phase, reason };
      }),
    }),

    // 16. choreograph
    choreograph: tool({
      description:
        "Play a sequenced animation across multiple objects. Steps execute at their specified delay from sequence start. " +
        "Use for dramatic scene moments: characters walking in, objects falling, reveal sequences. " +
        "action='move' animates the object to (x,y). action='effect' applies a transient visual effect. " +
        "delayMs is cumulative from sequence start (e.g. 0, 500, 1000 for a 3-beat sequence). Max 20 steps.",
      inputSchema: z.object({
        steps: z
          .array(
            z.object({
              objectId: z.string().describe("ID of the object to animate"),
              action: z.enum(["move", "effect"]).describe("'move' to animate position, 'effect' for visual effect"),
              x: z.number().optional().describe("Target X position (required for move, canvas 50-1150)"),
              y: z.number().optional().describe("Target Y position (required for move, canvas 60-780)"),
              effect: z
                .enum(["pulse", "shake", "flash"])
                .optional()
                .describe("Effect type (required for effect action)"),
              delayMs: z.number().describe("Delay from sequence start in ms (0 = immediate, 500, 1000, ...)"),
            }),
          )
          .min(2)
          .max(20)
          .describe("Ordered animation steps with timing"),
      }),
      execute: instrumentExecute("choreograph", async ({ steps }) => {
        const result = await stub.mutate({ type: "obj:sequence", steps });
        if (!result.ok) return { error: result.error };
        console.debug(JSON.stringify({ event: "ai:choreograph", stepCount: steps.length }));
        return { sequenced: steps.length };
      }),
    }),

    // 17. spotlight
    spotlight: tool({
      description:
        "Dim the entire canvas and shine a spotlight on a specific object or canvas position. " +
        "Use for dramatic reveals - it draws focus to one element by darkening everything else. " +
        "Use sparingly for maximum theatrical impact. Auto-clears after 5 seconds.",
      inputSchema: z.object({
        objectId: z.string().optional().describe("ID of object to spotlight (centers the light on it)"),
        x: z.number().optional().describe("X coordinate to spotlight (used if no objectId)"),
        y: z.number().optional().describe("Y coordinate to spotlight (used if no objectId)"),
      }),
      execute: instrumentExecute("spotlight", async ({ objectId, x, y }) => {
        let spotX = x;
        let spotY = y;
        if (objectId) {
          const obj = await stub.readObject(objectId);
          if (obj) {
            spotX = obj.x + obj.width / 2;
            spotY = obj.y + obj.height / 2;
            cursorToCenter(stub, obj);
          }
        }
        const result = await stub.mutate({ type: "spotlight", objectId, x: spotX, y: spotY });
        if (!result.ok) return { error: result.error };
        return { spotlight: objectId ?? "position", x: spotX, y: spotY };
      }),
    }),

    // 18. blackout
    blackout: tool({
      description:
        "Fade the entire canvas to black for a dramatic scene transition. " +
        "Use between major scene shifts - the blackout holds for 1.5 seconds then fades out. " +
        "Use sparingly (once per scene transition maximum) for maximum theatrical impact.",
      inputSchema: z.object({}),
      execute: instrumentExecute("blackout", async () => {
        const result = await stub.mutate({ type: "blackout" });
        if (!result.ok) return { error: result.error };
        return { blackout: true };
      }),
    }),

    // 19. drawScene
    drawScene: tool({
      description:
        "Compose a visual character or object from 2-10 shapes in a bounding box. Uses proportional " +
        "coordinates (0-1) so you think in relative positions, not pixels. Auto-creates a text label. " +
        "Example snowman at (300,200) 150x250: " +
        'parts:[{shape:"circle",relX:0.5,relY:0.75,relW:0.9,relH:0.35,fill:"#fff"},' +
        '{shape:"circle",relX:0.5,relY:0.4,relW:0.6,relH:0.25,fill:"#fff"},' +
        '{shape:"circle",relX:0.5,relY:0.15,relW:0.3,relH:0.12,fill:"#333"},' +
        '{shape:"rect",relX:0.5,relY:0.08,relW:0.45,relH:0.04,fill:"#333"}]',
      inputSchema: z.object({
        label: z.string().describe("What this represents (auto-creates a text label below)"),
        x: z.number().describe("X position of composition top-left on canvas"),
        y: z.number().describe("Y position of composition top-left on canvas"),
        width: z.number().optional().describe("Bounding box width in pixels (default: 200)"),
        height: z.number().optional().describe("Bounding box height in pixels (default: 300)"),
        parts: z
          .array(
            z.object({
              shape: z.enum(["rect", "circle", "line"]).describe("Shape type"),
              relX: z.number().describe("Center X as 0-1 fraction of bounding box"),
              relY: z.number().describe("Center Y as 0-1 fraction of bounding box"),
              relW: z.number().describe("Width as 0-1 fraction of bounding box"),
              relH: z.number().optional().describe("Height as 0-1 fraction (default: same as relW)"),
              fill: z.string().optional().describe("Fill color hex"),
              stroke: z.string().optional().describe("Stroke color hex"),
            }),
          )
          .min(2)
          .max(10)
          .describe("Shape parts with proportional coordinates"),
      }),
      execute: instrumentExecute("drawScene", async ({ label, x, y, width, height, parts }) => {
        const w = width ?? 200;
        const h = height ?? 300;
        const compositionBatchId = crypto.randomUUID();
        const clamp = (v: number) => Math.max(0, Math.min(1, v));

        const partIds: string[] = [];
        let failed = 0;

        for (const part of parts) {
          const rx = clamp(part.relX);
          const ry = clamp(part.relY);
          const rw = clamp(part.relW);
          const rh = clamp(part.relH ?? part.relW);

          const absW = rw * w;
          const absH = rh * h;
          const absX = x + rx * w - absW / 2;
          const absY = y + ry * h - absH / 2;

          const shapeType = part.shape === "circle" ? "circle" : part.shape === "line" ? "line" : "rect";
          const props: BoardObjectProps =
            shapeType === "line"
              ? { stroke: part.stroke || part.fill || "#94a3b8" }
              : { fill: part.fill || "#3b82f6", stroke: part.stroke };

          const obj = makeObject(shapeType, { x: absX, y: absY }, absW, absH, props, compositionBatchId);
          const result = await createAndMutate(stub, obj);
          if ("error" in result) {
            failed++;
          } else {
            partIds.push(result.created as string);
          }
        }

        // Text label below the composition
        const labelWidth = Math.max(40, label.length * 8 + 16);
        const labelObj = makeObject(
          "text",
          { x: x + w / 2 - labelWidth / 2, y: y + h + 8 },
          labelWidth,
          24,
          { text: label, color: "#1a1a2e" },
          compositionBatchId,
        );
        const labelResult = await createAndMutate(stub, labelObj);
        if (!("error" in labelResult)) partIds.push(labelResult.created as string);

        return {
          created: partIds.length,
          label,
          bounds: { x, y, width: w, height: h },
          batchId: compositionBatchId,
          partIds,
          ...(failed > 0 && { error: `${failed}/${parts.length} parts failed` }),
        };
      }),
    }),
  };

  // Registry of execute functions from tools 1-13, keyed by name.
  // Excludes batchExecute itself to prevent recursive batching.
  // Double-cast through unknown: each tool's execute has Zod-narrowed args, but at runtime
  // all accept Record<string,unknown> (instrumentExecute guards malformed inputs).
  type AnyExec = (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown>;
  const toolRegistry: Record<string, AnyExec> = Object.fromEntries(
    Object.entries(baseTools).map(([name, t]) => [name, (t as unknown as { execute: AnyExec }).execute]),
  );

  return {
    ...baseTools,

    // KEY-DECISION 2026-02-20: @cloudflare/codemode (LLM code-execution for tool orchestration)
    // evaluated and rejected. Our budget models (GLM, GPT-4o Mini) can't reliably generate
    // TypeScript, batchExecute + choreograph cover multi-step needs declaratively, and CodeMode
    // would regress per-tool Langfuse observability. Revisit if: tool count >40 with cross-deps,
    // default model upgrades to frontier tier, AND Worker Loader API exits beta.
    // Full analysis: docs/cloudflare-codemod-exploration.md

    // 12. batchExecute
    batchExecute: tool({
      description:
        "Execute multiple canvas operations in a single call. Use when creating related objects " +
        "together (e.g. a frame with stickies inside it, or a row of characters). Operations run " +
        "in order; failures are recorded but do not stop the batch. Max 10 operations per call. " +
        "Prefer individual tools when you need to act on results between steps (e.g. getBoardState " +
        "then decide what to create) - batch args are pre-computed and cannot chain across ops.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              tool: z
                .enum([
                  "createStickyNote",
                  "createPerson",
                  "createShape",
                  "createFrame",
                  "createConnector",
                  "moveObject",
                  "resizeObject",
                  "updateText",
                  "changeColor",
                  "getBoardState",
                  "deleteObject",
                  "generateImage",
                  "createText",
                  "highlightObject",
                  "advanceScenePhase",
                  "choreograph",
                  "spotlight",
                  "blackout",
                  "drawScene",
                ])
                .describe("Tool name to execute"),
              args: z.record(z.string(), z.unknown()).describe("Arguments for the tool (same as calling it directly)"),
            }),
          )
          .max(10)
          .describe("Ordered list of operations to execute sequentially"),
      }),
      execute: instrumentExecute("batchExecute", async ({ operations }) => {
        const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

        const results: unknown[] = [];
        let failed = 0;
        const toolNames = operations.map((op) => op.tool);
        console.debug(JSON.stringify({ event: "batch:start", count: operations.length, tools: toolNames }));

        for (const op of operations) {
          const executeFn = toolRegistry[op.tool];
          if (!executeFn) {
            // Programming error: Zod enum should prevent unknown tool names - log for diagnosis
            console.error(JSON.stringify({ event: "batch:unknown-tool", tool: op.tool }));
            results.push({ error: `Unknown tool: ${op.tool}` });
            failed++;
            continue;
          }
          try {
            const result = await executeFn(op.args);
            results.push(result);
            if (isPlainObject(result) && "error" in result) failed++;
          } catch (err) {
            // Unexpected throw not caught by instrumentExecute (which rethrows) - log for diagnosis
            console.error(JSON.stringify({ event: "batch:op:error", tool: op.tool, error: errMsg(err) }));
            results.push({ error: `${op.tool} failed: ${errMsg(err)}` });
            failed++;
          }
        }

        if (failed > 0) {
          console.error(
            JSON.stringify({
              event: "batch:partial-failure",
              completed: operations.length - failed,
              failed,
              tools: toolNames,
            }),
          );
        }

        const completed = operations.length - failed;
        return {
          completed,
          failed,
          results,
          // Surface partial failures to instrumentExecute's ok check (which looks for "error" key)
          ...(failed > 0 && { error: `${failed}/${operations.length} operations failed` }),
        };
      }),
    }),
  };
}

/** Tool name = each key in the registry returned by createSDKTools */
export type ToolName = keyof ReturnType<typeof createSDKTools>;
