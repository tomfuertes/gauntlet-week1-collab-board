-- Add AI critic review fields to boards table.
-- Populated when a scene reaches curtain phase (5+ human turns).
-- critic_model tracks which model generated the review for quality analysis.
ALTER TABLE boards ADD COLUMN critic_review TEXT;
ALTER TABLE boards ADD COLUMN critic_score INTEGER; -- 1-5 stars
ALTER TABLE boards ADD COLUMN critic_model TEXT;
