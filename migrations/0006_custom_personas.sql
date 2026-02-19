-- Custom AI personas per board (name, trait, color)
-- Default SPARK/SAGE are returned when no rows exist for a board
CREATE TABLE board_personas (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trait TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);
CREATE INDEX idx_board_personas_board_id ON board_personas(board_id);
