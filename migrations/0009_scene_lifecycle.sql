-- Add is_public column for scene auto-archive (curtain lifecycle phase)
-- archiveScene() in board.ts sets this to 1 when AI declares curtain with >= 5 human turns.
ALTER TABLE boards ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_boards_is_public ON boards(is_public);
