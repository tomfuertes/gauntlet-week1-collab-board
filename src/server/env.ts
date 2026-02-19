import type { Board } from "./board";
import type { ChatAgent } from "./chat-agent";

/**
 * Server environment - extends auto-generated Env (from wrangler types).
 * Wrangler vars (DAILY_AI_BUDGET_USD, WORKERS_AI_MODEL, ENABLE_ANTHROPIC_API)
 * come from worker-configuration.d.ts with literal types. Secrets (AUTH_SECRET,
 * ANTHROPIC_API_KEY) aren't in wrangler.toml so we declare them here.
 */
export type Bindings = Env & {
  BOARD: DurableObjectNamespace<Board>;
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>;
  AUTH_SECRET: string;
  ANTHROPIC_API_KEY: string;
};

/** Increment activity counter for a board (obj:create, obj:delete, chat message) */
export function recordBoardActivity(db: D1Database, boardId: string): Promise<D1Response> {
  return db
    .prepare(
      "INSERT INTO board_activity (board_id, activity_count, last_activity_at) VALUES (?1, 1, datetime('now')) ON CONFLICT(board_id) DO UPDATE SET activity_count = activity_count + 1, last_activity_at = datetime('now')",
    )
    .bind(boardId)
    .run();
}

/** Snapshot a user's seen_count to the board's current activity_count */
export function markBoardSeen(db: D1Database, userId: string, boardId: string): Promise<D1Response> {
  return db
    .prepare(
      "INSERT INTO user_board_seen (user_id, board_id, seen_count) VALUES (?1, ?2, COALESCE((SELECT activity_count FROM board_activity WHERE board_id = ?2), 0)) ON CONFLICT(user_id, board_id) DO UPDATE SET seen_count = COALESCE((SELECT activity_count FROM board_activity WHERE board_id = ?2), 0)",
    )
    .bind(userId, boardId)
    .run();
}
