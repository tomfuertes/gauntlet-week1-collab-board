#!/bin/bash
# Query ai_traces D1 table - token-respectful presets for Claude Code sessions.
# Never SELECTs system_prompt in list queries (large column, only fetch when needed).
#
# Usage:
#   npm run traces                          # last 10 traces (default)
#   npm run traces -- recent 20             # last N traces
#   npm run traces -- errors                # traces with errors
#   npm run traces -- board <board_id>      # traces for one board
#   npm run traces -- prompt <trace_id>     # system prompt for a trace (large output)
#   npm run traces -- tools                 # tool call frequency
#   npm run traces -- usage                 # token usage by trigger+model
#
#   # Remote (prod):
#   npm run traces:remote
#   npm run traces:remote -- board <id>

ENV="${TRACES_ENV:-local}"
LIMIT="${2:-10}"

DB="wrangler d1 execute collabboard-db --${ENV} --json --command"

case "${1:-recent}" in
  recent)
    $DB "SELECT id, board_id, ts, trigger, persona, model, duration_ms, input_tokens, output_tokens, message_count, finish_reason FROM ai_traces ORDER BY ts DESC LIMIT ${LIMIT}"
    ;;

  errors)
    $DB "SELECT id, board_id, ts, trigger, persona, model, error FROM ai_traces WHERE error IS NOT NULL ORDER BY ts DESC LIMIT ${LIMIT}"
    ;;

  board)
    if [ -z "$2" ]; then echo "Usage: npm run traces -- board <board_id>"; exit 1; fi
    $DB "SELECT id, ts, trigger, persona, model, duration_ms, input_tokens, output_tokens, tool_calls_json, finish_reason FROM ai_traces WHERE board_id = '$2' ORDER BY ts DESC LIMIT 20"
    ;;

  prompt)
    # Fetch system_prompt for a specific trace row (expensive - use only when debugging)
    if [ -z "$2" ]; then echo "Usage: npm run traces -- prompt <trace_id>"; exit 1; fi
    $DB "SELECT id, ts, trigger, persona, model, system_prompt FROM ai_traces WHERE id = $2"
    ;;

  tools)
    # Tool call frequency across all traces
    $DB "SELECT json_extract(value, '$.name') as tool, count(*) as calls FROM ai_traces, json_each(tool_calls_json) WHERE tool_calls_json != '[]' GROUP BY tool ORDER BY calls DESC LIMIT 20"
    ;;

  usage)
    # Token usage aggregated by trigger + model
    $DB "SELECT trigger, model, count(*) as requests, sum(input_tokens) as total_input, sum(output_tokens) as total_output, avg(duration_ms) as avg_ms FROM ai_traces GROUP BY trigger, model ORDER BY requests DESC"
    ;;

  boards)
    # Which boards have the most AI activity
    $DB "SELECT board_id, count(*) as requests, sum(input_tokens+output_tokens) as total_tokens, max(ts) as last_active FROM ai_traces GROUP BY board_id ORDER BY requests DESC LIMIT 10"
    ;;

  *)
    echo "Unknown command: $1"
    echo "Commands: recent [N] | errors | board <id> | prompt <id> | tools | usage | boards"
    exit 1
    ;;
esac
