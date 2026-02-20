# Session: prompt-v6 - Modular Prompt Architecture

**Date:** 2026-02-20
**Branch:** feat/prompt-v6
**Status:** Complete, UAT passed

## What Shipped

System prompt split from monolithic ~2000-word constant into modular architecture. SYSTEM_PROMPT trimmed ~72% (992 → 281 words). Three new conditional modules extracted:

- `SCENE_SETUP_PROMPT` (~130 words): injected only on first exchange (humanTurns <= 1)
- `INTENT_PROMPTS` (6 entries, ~50 words each): injected only when body.intent matches a chip label
- `MOMENTUM_PROMPT` (~30 words): injected after humanTurns >= 3 and budgetPhase === "normal"
- `PROMPT_VERSION` bumped to "v6"

DEFAULT_PERSONAS (SPARK/SAGE) traits trimmed from 5-line prose to 3-line behavioral rules.

## Files Changed

- `src/server/prompts.ts` - SYSTEM_PROMPT trimmed, 3 new exports, PROMPT_VERSION v6
- `src/server/chat-agent.ts` - 3 conditional injections in onChatMessage, type-safe intent lookup with unknown-intent logging
- `src/client/components/ChatPanel.tsx` - pendingIntent state + useEffect pattern for chip→intent→body flow, mode-gated chip routing
- `src/shared/types.ts` - DEFAULT_PERSONAS traits shortened

## Key Decisions

**Why state + useEffect for intent (not ref):** `useAgentChat` stores body in `bodyOptionRef.current = body` during render (not a layout effect). A ref write doesn't trigger a re-render, so `bodyRef.current` would still have `undefined` when `sendMessage` reads it. State triggers a re-render → bodyRef updates → effect fires → sendMessage reads updated body.

**sendMessage before setPendingIntent(undefined):** At the time our useEffect fires, `bodyOptionRef.current` holds the render's body value (intent set). Calling `sendMessage` first reads that ref. Clearing state after ensures the next render has `intent: undefined` for typed messages. Reversed order would be safe too since the `undefined` state update doesn't propagate mid-effect, but the current order is more semantically correct.

**Mode-gated chip routing:** Hat/yesand chips (`"Yes, and..."`, `"Escalate!"`, `"[NEXT-HAT-PROMPT]"`) have no INTENT_PROMPTS entries. These chips go through `sendMessage` directly when `gameMode === "hat" || "yesand"`. Freeform chips use `setPendingIntent`. Avoids silently sending `body.intent` values that the server has no handler for.

**Unknown intent logging:** Added `chat:unknown-intent` warn log for intents that pass type check but don't match INTENT_PROMPTS keys. Enables debugging client-server version mismatches where chip labels diverge from server keys.

## UAT Results (all pass)

1. ✅ First exchange creates scene setup (location frame + characters + props via batchExecute)
2. ✅ "Plot twist!" chip triggers getBoardState + updateText (subverts existing content, not new scene)
3. ✅ Mid-scene typed message creates 1-3 targeted objects, no scene restart
4. ✅ SPARK (theatrical/punchy) and SAGE (wry/thoughtful) maintain distinct voices with [NAME] prefixes

## PR Review Findings Fixed

- **Code reviewer:** Swapped setPendingIntent/sendMessage order (sendMessage first); added mode-gate for hat/yesand chip routing
- **Comment analyzer:** Fixed KEY-DECISION word count (992→281, ~72% not ~75%); clarified humanTurns<=1 semantics; changed "3+ exchanges" to "3+ human turns"
- **Silent failure hunter:** Added try/catch around sendMessage in useEffect; added runtime type narrowing for body.intent (typeof check before cast); added unknown-intent warn log on server

## Loose Ends Found

- **Persona load fallback UX (pre-existing):** When `/api/boards/:id/personas` returns 5xx, the app silently falls back to SPARK/SAGE defaults with no user-visible indicator. Not introduced by this PR but worth a future pass.
- **Reactive persona on first exchange:** UAT showed SAGE fires after the first SPARK response, so scene setup exchange already sees a SAGE reaction. This is fine behavior but means first exchange produces more objects than later exchanges (expected).
