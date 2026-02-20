# Session: cap-chat-history

**Date:** 2026-02-20
**Branch:** feat/cap-chat-history

## What was done

Added `maxPersistedMessages = 100` as a class property override in `ChatAgent` (src/server/chat-agent.ts:121).

## How it works

`AIChatAgent` (from `@cloudflare/ai-chat`) exposes `maxPersistedMessages: number | undefined = undefined` as a class property. Default is `undefined` (unlimited). Setting it in the subclass overrides the base class value. The base class enforces it automatically in `persistMessages()` - deletes oldest messages from SQLite when count exceeds the cap.

## Why 100

Each scene turn produces ~3 messages (user + AI + reactive persona). `SCENE_TURN_BUDGET` caps the human turns. 100 messages covers multiple scenes on the same board with headroom, while bounding DO Storage growth. The cap trims history from the oldest end, so recent context is always preserved.

## Files changed

- `src/server/chat-agent.ts`: Added `maxPersistedMessages = 100` + KEY-DECISION comment
