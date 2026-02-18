import type { Board } from "./board";
import type { ChatAgent } from "./chat-agent";

/** Server environment - single source of truth for all Hono routes */
export type Bindings = {
  DB: D1Database;
  BOARD: DurableObjectNamespace<Board>;
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  AI: Ai;
  AUTH_SECRET: string;
  ANTHROPIC_API_KEY: string;
};

/** Result from Board DO mutations (mutate RPC) */
export type MutateResult = { ok: boolean; error?: string };

/** Increment activity counter for a board (obj:create, obj:delete, chat message) */
export function recordBoardActivity(db: D1Database, boardId: string): Promise<D1Response> {
  return db.prepare(
    "INSERT INTO board_activity (board_id, activity_count, last_activity_at) VALUES (?1, 1, datetime('now')) ON CONFLICT(board_id) DO UPDATE SET activity_count = activity_count + 1, last_activity_at = datetime('now')"
  ).bind(boardId).run();
}

/** Snapshot a user's seen_count to the board's current activity_count */
export function markBoardSeen(db: D1Database, userId: string, boardId: string): Promise<D1Response> {
  return db.prepare(
    "INSERT INTO user_board_seen (user_id, board_id, seen_count) VALUES (?1, ?2, COALESCE((SELECT activity_count FROM board_activity WHERE board_id = ?2), 0)) ON CONFLICT(user_id, board_id) DO UPDATE SET seen_count = COALESCE((SELECT activity_count FROM board_activity WHERE board_id = ?2), 0)"
  ).bind(userId, boardId).run();
}
