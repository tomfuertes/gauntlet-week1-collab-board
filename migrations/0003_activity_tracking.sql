-- Activity tracking for async notifications
-- board_activity: global counter per board (incremented on obj:create, obj:delete, chat message)
-- user_board_seen: per-user snapshot of how much activity they've seen

CREATE TABLE IF NOT EXISTS board_activity (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  activity_count INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_board_seen (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seen_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, board_id)
);
