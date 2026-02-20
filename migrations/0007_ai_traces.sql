-- AI request traces for prompt debugging and quality analysis.
-- Captures system prompt (persona + game mode + budget phase), token usage,
-- and tool calls made per request. Written by tracing-middleware.ts.
CREATE TABLE ai_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- Unix ms timestamp
  trigger TEXT,                 -- 'chat' | 'reactive' | 'director'
  persona TEXT,                 -- active persona name
  model TEXT,                   -- model short name (e.g. 'glm-4.7-flash')
  prompt_version TEXT,          -- PROMPT_VERSION constant for prompt evolution tracking
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  system_prompt TEXT,           -- full assembled system prompt (persona+gamemode+phase)
  message_count INTEGER,        -- number of messages in context (excl. system)
  tool_calls_json TEXT,         -- JSON array of {name, args} for each tool call
  finish_reason TEXT,           -- 'stop' | 'tool-calls' | 'length' | 'error'
  error TEXT                    -- non-null if the LLM call threw
);
CREATE INDEX idx_ai_traces_board_ts ON ai_traces(board_id, ts DESC);
