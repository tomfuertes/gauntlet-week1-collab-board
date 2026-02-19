---
name: observability
description: Debug CollabBoard prod issues. Use when boards aren't showing, AI isn't responding, gallery is empty, sessions are broken, or any prod behavior needs investigation. Provides wrangler tail commands, D1 queries, and diagnostic workflows.
---

# CollabBoard Observability Runbook

**Worker:** `collabboard` | **D1:** `collabboard-db` (`746bc930-1ec4-4424-9209-29ca4f185f43`)

## 1. Live Log Streaming

All server code uses structured JSON `console.log/debug/warn/error`. Stream with wrangler tail.

```bash
npx wrangler tail collabboard                              # all logs
npx wrangler tail collabboard --status error               # errors only
npx wrangler tail collabboard | grep '"event":"ai:request'  # AI pipeline
npx wrangler tail collabboard | grep '"ok":false'           # tool failures
npx wrangler tail collabboard | grep '"event":"director'    # director nudges
```

DO logs (Board, ChatAgent) appear in the same stream. Filter on `boardId` field.

### Log Event Catalog

**AI pipeline (chat-agent.ts):**

| Event | Level | Fields |
|---|---|---|
| `ai:request:start` | debug | boardId, model, promptVersion, trigger (chat/director) |
| `ai:request:end` | debug | steps, toolCalls, durationMs |
| `ai:sanitize:input` | warn | LLM emitted malformed tool input |
| `director:skip` | debug | reason: newer-timer, generating, no-messages |
| `director:nudge-error` | error | generateText threw |

**AI tools (ai-tools-sdk.ts):**

| Event | Level | Fields |
|---|---|---|
| `ai:tool` | debug | tool, durationMs, ok, error |
| `ai:tool:invalid-input` | error | LLM passed non-object args |
| `ai:create` | debug | type, id, x, y, w, h |
| `ai:create:error` / `ai:create:rejected` | error | stub.mutate() failed or returned ok:false |
| `ai:overlap` | debug | Board layout overlap score, includes total object count |
| `ai:image:*` | error | Image generation failures |

**Board DO (board.ts):** `activity:markSeen`, `activity:record`, `activity:getBoardId:error` (all error level)

## 2. D1 Queries

Board objects live in DO Storage (not D1). D1 has users, sessions, board metadata, activity.

```bash
# Query remote D1
npx wrangler d1 execute collabboard-db --remote --command "SELECT ..."
```

### "Boards not showing" diagnosis

```sql
-- All boards with owner
SELECT b.id, b.name, u.username, b.created_at, b.updated_at
FROM boards b JOIN users u ON u.id = b.created_by
ORDER BY b.updated_at DESC LIMIT 50

-- Specific user's boards + activity
SELECT b.id, b.name, COALESCE(a.activity_count, 0) AS activity,
  COALESCE(a.last_activity_at, 'never') AS last_active
FROM boards b
LEFT JOIN board_activity a ON a.board_id = b.id
WHERE b.created_by = 'USER_ID'
ORDER BY b.updated_at DESC

-- Check user_board_seen records
SELECT * FROM user_board_seen WHERE user_id = 'USER_ID'

-- Unseen badge counts
SELECT u.username, b.name, a.activity_count, s.seen_count,
  MAX(0, COALESCE(a.activity_count, 0) - COALESCE(s.seen_count, 0)) AS unseen
FROM boards b
JOIN users u ON u.id = b.created_by
LEFT JOIN board_activity a ON a.board_id = b.id
LEFT JOIN user_board_seen s ON s.board_id = b.id AND s.user_id = u.id
ORDER BY b.updated_at DESC
```

### Auth/session diagnosis

```sql
-- Active users + session count
SELECT u.id, u.username, u.display_name,
  COUNT(s.id) AS active_sessions
FROM users u LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > datetime('now')
GROUP BY u.id

-- Validate a session cookie
SELECT s.id, s.expires_at, u.username
FROM sessions s JOIN users u ON u.id = s.user_id
WHERE s.id = 'SESSION_ID_HERE'

-- Expired session count
SELECT COUNT(*) AS expired FROM sessions WHERE expires_at <= datetime('now')
```

### Gallery diagnosis

```sql
-- Most active boards (what gallery shows)
SELECT b.name, a.activity_count, a.last_activity_at, u.username AS owner
FROM board_activity a JOIN boards b ON b.id = a.board_id
JOIN users u ON u.id = b.created_by
ORDER BY a.activity_count DESC LIMIT 20
```

## 3. DO State Inspection

**No remote shell for DO Storage.** Available windows:

- **Replay endpoint** (public, no auth): `GET /api/boards/:id/replay` returns all `evt:*` keys (full mutation history)
- **Board state via WS**: Connect to the board; `init` message contains all objects
- **ai:overlap log**: Contains `total` object count when AI reads board
- **ChatAgent history**: Persisted in DO SQLite (not D1, not queryable remotely). Connect to chat to see conversation context.

```bash
# Check replay data for a board
curl https://collabboard.thomas-fuertes.workers.dev/api/boards/BOARD_ID/replay

# Gallery endpoint
curl https://collabboard.thomas-fuertes.workers.dev/api/boards/public

# Authenticated board list (use session cookie)
curl -H "Cookie: session=SESSION_ID" \
  https://collabboard.thomas-fuertes.workers.dev/api/boards
```

## 4. Diagnostic Workflows

### "AI not responding"

1. `npx wrangler tail collabboard | grep '"event":"ai:request'` - requests reaching worker?
2. Check model: grep `"model"` - should show `claude-haiku-4-5` or `glm-4.7-flash`
3. Check tool failures: grep `'"ok":false'`
4. Check sanitization: grep `'"event":"ai:sanitize:input"'` (free-tier LLM quirk)
5. Check mutex: grep `'"_isGenerating"'` - director blocking chat?
6. Verify key: `npx wrangler secret list` - should show ANTHROPIC_API_KEY

### "Boards not showing"

1. Confirm board exists in D1 (query above)
2. Validate session cookie (query above)
3. Check user_board_seen records exist
4. Hit API directly with curl + cookie to see raw response
5. Check for D1 read replication lag (board appears after refresh = consistency issue)

## 5. CF Dashboard

- **Workers metrics:** `dash.cloudflare.com/.../workers/services/view/collabboard` (request volume, error rate, latency)
- **D1 console:** `dash.cloudflare.com/.../d1/database/746bc930-...` (SQL console in browser)
- **DO tab:** Instance count, request count, storage usage per class. No per-instance inspection.

## Caveats

- `console.debug` visible in wrangler tail but may be hidden in CF dashboard Logs tab (check level filter)
- Use `--remote` flag for prod D1 (`--local` hits dev miniflare SQLite)
- Chat history is in DO SQLite (AIChatAgent internal), not D1, not remotely queryable
- DO Storage not remotely inspectable without admin endpoints
- `npx wrangler secret list` shows names only, not values
