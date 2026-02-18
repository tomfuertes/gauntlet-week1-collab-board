/* eslint-disable @typescript-eslint/no-explicit-any -- tool args are loosely typed by design */
import type { BoardObject, WSClientMessage } from "../shared/types";
import type { MutateResult } from "./env";
import type { ToolName } from "../shared/ai-tool-meta";
import { TOOL_LABELS } from "../shared/ai-tool-meta";

/** Minimal interface for the Board DO stub methods used by tools */
export interface BoardStub {
  readObjects(): Promise<BoardObject[]>;
  readObject(id: string): Promise<BoardObject | null>;
  mutate(msg: WSClientMessage): Promise<MutateResult>;
}

export interface ToolDef {
  name: ToolName;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required: readonly string[] };
  label: string;
  execute: (args: any) => Promise<string>;
}

/** Create the full tool registry bound to a specific Board DO stub */
export function createTools(stub: BoardStub): ToolDef[] {
  return [
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
      label: TOOL_LABELS.createStickyNote,
      async execute(args: { text?: string; x?: number; y?: number; color?: string }) {
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
      },
    },

    // 2. createShape (rect, circle, line)
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
      label: TOOL_LABELS.createShape,
      async execute(args: { shape?: string; x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string }) {
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
      },
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
      label: TOOL_LABELS.createFrame,
      async execute(args: { title: string; x?: number; y?: number; width?: number; height?: number }) {
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
      },
    },

    // 4. createConnector (resolves object centers server-side)
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
      label: TOOL_LABELS.createConnector,
      async execute(args: { fromId: string; toId: string; stroke?: string; arrow?: string }) {
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
      },
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
      label: TOOL_LABELS.moveObject,
      async execute(args: { id: string; x: number; y: number }) {
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id: args.id, x: args.x, y: args.y, updatedAt: Date.now() },
        });
        if (!result.ok) return JSON.stringify({ error: result.error });
        return JSON.stringify({ moved: args.id, x: args.x, y: args.y });
      },
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
      label: TOOL_LABELS.resizeObject,
      async execute(args: { id: string; width: number; height: number }) {
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id: args.id, width: args.width, height: args.height, updatedAt: Date.now() },
        });
        if (!result.ok) return JSON.stringify({ error: result.error });
        return JSON.stringify({ resized: args.id, width: args.width, height: args.height });
      },
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
      label: TOOL_LABELS.updateText,
      async execute(args: { id: string; text: string }) {
        const result = await stub.mutate({
          type: "obj:update",
          obj: { id: args.id, props: { text: args.text }, updatedAt: Date.now() },
        });
        if (!result.ok) return JSON.stringify({ error: result.error });
        return JSON.stringify({ updated: args.id, text: args.text });
      },
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
      label: TOOL_LABELS.changeColor,
      async execute(args: { id: string; color: string }) {
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
      },
    },

    // 9. getBoardState (with filtering and summary mode)
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
      label: TOOL_LABELS.getBoardState,
      async execute(args: { filter?: string; ids?: string[] }) {
        const objects = await stub.readObjects() as BoardObject[];

        if (args.ids && args.ids.length > 0) {
          const matched = objects.filter((o: BoardObject) => args.ids!.includes(o.id));
          return JSON.stringify(matched);
        }

        if (args.filter) {
          const matched = objects.filter((o: BoardObject) => o.type === args.filter);
          return JSON.stringify(matched);
        }

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
      },
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
      label: TOOL_LABELS.deleteObject,
      async execute(args: { id: string }) {
        const result = await stub.mutate({ type: "obj:delete", id: args.id });
        if (!result.ok) return JSON.stringify({ error: result.error });
        return JSON.stringify({ deleted: args.id });
      },
    },
  ];
}
