-- Remove D1-based AI traces. Langfuse is now the sole observability layer
-- for AI request tracing (full I/O capture, token usage, tool calls).
-- The ai_traces table was metadata-only and redundant with Langfuse's richer UI.
DROP INDEX IF EXISTS idx_ai_traces_board_ts;
DROP TABLE IF EXISTS ai_traces;
