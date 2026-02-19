-- Add game mode column to boards (freeform is default for existing boards)
ALTER TABLE boards ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'freeform';
