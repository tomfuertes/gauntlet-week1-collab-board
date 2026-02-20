-- Migration number: 0013 	 Created 2026-02-20T22:30:00.000Z
CREATE TABLE scene_ratings (
  id INTEGER PRIMARY KEY,
  board_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(board_id, user_id)
);
