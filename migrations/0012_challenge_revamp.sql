-- Challenge revamp: template seeding, game mode per-challenge, user streaks, board-challenge link.
-- KEY-DECISION 2026-02-20: Leaderboard now sorts by critic_score (already populated at curtain phase)
-- rather than reaction_count (which was never incremented). No new AI calls needed.

ALTER TABLE daily_challenges ADD COLUMN template_id TEXT;
ALTER TABLE daily_challenges ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'freeform';

ALTER TABLE users ADD COLUMN challenge_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN challenge_best_score INTEGER;
ALTER TABLE users ADD COLUMN challenge_last_date TEXT;

ALTER TABLE boards ADD COLUMN challenge_id INTEGER REFERENCES daily_challenges(id);
