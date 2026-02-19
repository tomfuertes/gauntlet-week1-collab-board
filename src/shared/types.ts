export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface BoardObject {
  id: string;
  type: "sticky" | "rect" | "circle" | "line" | "text" | "frame" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  props: {
    text?: string;
    color?: string;
    fill?: string;
    stroke?: string;
    arrow?: "none" | "end" | "both";
    src?: string;
    prompt?: string;
  };
  createdBy: string;
  updatedAt: number;
  batchId?: string;
}

export type WSClientMessage =
  | { type: "cursor"; x: number; y: number }
  | { type: "obj:create"; obj: BoardObject }
  | { type: "obj:update"; obj: Partial<BoardObject> & { id: string } }
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

export interface ReplayEvent {
  type: "obj:create" | "obj:update" | "obj:delete";
  ts: number;
  obj?: BoardObject; // present for create/update
  id?: string; // present for delete
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
