// Flat union (backward compat for partial updates)
export interface BoardObjectProps {
  text?: string;
  color?: string;
  fill?: string;
  stroke?: string;
  arrow?: "none" | "end" | "both";
  src?: string;
  prompt?: string;
}

// Per-type narrowed props
type StickyProps = Pick<BoardObjectProps, "text" | "color">;
type RectProps = Pick<BoardObjectProps, "fill" | "stroke">;
type CircleProps = Pick<BoardObjectProps, "fill" | "stroke">;
type LineProps = Pick<BoardObjectProps, "stroke" | "arrow">;
type TextObjectProps = Pick<BoardObjectProps, "text" | "color">;
type FrameProps = Pick<BoardObjectProps, "text">;
type ImageObjectProps = Pick<BoardObjectProps, "src" | "prompt">;

type BoardObjectVariant =
  | { type: "sticky"; props: StickyProps }
  | { type: "rect"; props: RectProps }
  | { type: "circle"; props: CircleProps }
  | { type: "line"; props: LineProps }
  | { type: "text"; props: TextObjectProps }
  | { type: "frame"; props: FrameProps }
  | { type: "image"; props: ImageObjectProps };

interface BoardObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdBy: string;
  updatedAt: number;
  batchId?: string;
}

export type BoardObject = BoardObjectBase & BoardObjectVariant;

// For partial updates - flat props, no discriminant enforcement
export type BoardObjectUpdate = Partial<Omit<BoardObjectBase, "id">> & {
  id: string;
  type?: BoardObject["type"];
  props?: BoardObjectProps;
};

/** Mutation messages the Board DO can receive (excludes cursor) */
export type BoardMutation =
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: BoardObjectUpdate }
  | { type: "obj:delete"; id: string };

export type WSClientMessage =
  | { type: "cursor"; x: number; y: number }
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: BoardObjectUpdate }
  | { type: "obj:delete"; id: string }
  | { type: "text:cursor"; objectId: string; position: number }
  | { type: "text:blur"; objectId: string }
  | { type: "batch:undo"; batchId: string }
  | { type: "reaction"; emoji: string; x: number; y: number };

export type WSServerMessage =
  | { type: "cursor"; userId: string; username: string; x: number; y: number }
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: BoardObject }
  | { type: "obj:delete"; id: string }
  | { type: "presence"; users: { id: string; username: string }[]; spectatorCount: number }
  | { type: "init"; objects: BoardObject[] }
  | { type: "board:deleted" }
  | { type: "text:cursor"; userId: string; username: string; objectId: string; position: number }
  | { type: "text:blur"; userId: string; objectId: string }
  | { type: "reaction"; userId: string; emoji: string; x: number; y: number };

export const AI_USER_ID = "ai-agent" as const;
export const AI_USERNAME = "AI Assistant" as const;

/** Shared persona display data - single source of truth for client + server */
export const PERSONA_META = [
  { name: "SPARK", color: "#fb923c" },
  { name: "SAGE", color: "#4ade80" },
] as const;

/** Persona name -> display color for ChatPanel sender labels (derived from PERSONA_META) */
export const PERSONA_COLORS: Record<string, string> =
  Object.fromEntries(PERSONA_META.map((p) => [p.name, p.color]));

/** Max human turns per scene before AI wraps up */
export const SCENE_TURN_BUDGET = 20;

export interface ReplayEvent {
  type: "obj:create" | "obj:update" | "obj:delete";
  ts: number;
  obj?: BoardObject; // present for create/update
  id?: string; // present for delete
}

/** Result from Board DO mutations (mutate RPC) */
export type MutateResult = { ok: boolean; error?: string };

/**
 * Minimal interface for the Board DO stub methods used by AI tools.
 * mutate() intentionally narrows to BoardMutation (vs WSClientMessage in Board DO)
 * for AI tool safety - prevents tools from sending cursor/reaction messages.
 */
export interface BoardStub {
  readObjects(): Promise<BoardObject[]>;
  readObject(id: string): Promise<BoardObject | null>;
  mutate(msg: BoardMutation): Promise<MutateResult>;
  injectCursor(x: number, y: number): Promise<void>;
}
