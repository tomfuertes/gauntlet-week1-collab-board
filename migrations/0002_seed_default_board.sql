-- Seed the default board so existing data is accessible from the board list
-- Create a system user to satisfy FK constraint on boards.created_by
INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at)
VALUES ('system', 'system', 'n/a', 'System', datetime('now'));

INSERT OR IGNORE INTO boards (id, name, created_by, created_at, updated_at)
VALUES ('default', 'Default Board', 'system', datetime('now'), datetime('now'));
