# Session: phantom-do-fix (2026-02-20)

## What was done

Fixed phantom Durable Object creation on arbitrary boardIds. Three routes were creating DOs without first verifying the boardId exists in D1:

- `/agents/*` - ChatAgent DO (the main vector; boardId parsed from `path.split("/")[3]`)
- `/ws/board/:boardId` - Board DO (authenticated WebSocket upgrade)
- `/ws/watch/:boardId` - Board DO (public spectator WebSocket)

Added `SELECT 1 FROM boards WHERE id = ? LIMIT 1` guard before each DO access. Returns 404 if board not found.

## Key decisions

- **SELECT 1 LIMIT 1 pattern** - Minimal query, no row data needed at guard layer. Consistent with how `checkBoardOwnership` fetches only what it needs.
- **agents path parsing** - `c.req.path.split("/")[3]` extracts boardId from `/agents/ChatAgent/<boardId>`. Guarded with `if (boardId)` to handle non-board agent paths gracefully.
- **spectator WS included** - Public route but still creates a real DO instance; 404 guard is appropriate.

## Files changed

- `src/server/index.ts` - +14 lines, 3 guard blocks
