-- Daily scene challenges + leaderboard
-- One row per day; hat_prompt_index ties to HAT_PROMPTS array in hat-prompts.ts
CREATE TABLE daily_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL,
  prompt TEXT NOT NULL,
  hat_prompt_index INTEGER NOT NULL
);

-- One entry per user per challenge; reaction_count incremented by Board DO on each spectator reaction
CREATE TABLE challenge_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL REFERENCES daily_challenges(id),
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reaction_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(challenge_id, user_id)
);

CREATE INDEX idx_challenge_entries_leaderboard ON challenge_entries(challenge_id, reaction_count DESC);
