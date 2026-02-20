# Session: prompt-fixes (2026-02-19)

## What Was Done

Fixed 5 prompt and game mode issues (Issues #36, #37-M2 through #37-M5).

### Changes

**src/server/prompts.ts** (PROMPT_VERSION v6 -> v7):
- `SYSTEM_PROMPT`: Added `PERSONA COLORS` rule (SPARK=red, SAGE=green) and `DISPERSION RULE` (stickies without frames spread 200px apart). Both placed in the always-present base prompt so all models see them.
- `INTENT_PROMPTS["Meanwhile, elsewhere..."]`: Replaced vague "find empty space" with explicit coordinates (x=650 y=100 w=480 h=400) and batchExecute instruction. Removes getBoardState prerequisite that caused models to skip canvas ops.
- `buildGameModePromptBlock` (hat mode): Added `spatialBlock` that injects new frame coordinates when `hatExchangeCount === 1` AND `hatPromptOffset > 50` (2nd+ prompt only - guards against SCENE_SETUP_PROMPT conflict on first exchange).
- `GameModeState` interface: Added `hatPromptOffset?: number` field.

**src/server/chat-agent.ts**:
- `_hatPromptCount` class property: Tracks how many hat prompts have been shown (increments on NEXT-HAT-PROMPT, initialized to 0 on first prompt).
- Hat lifecycle block: Sets `_hatPromptCount` on prompt transitions; computes `hatXOffset = min(50 + count*600, 650)` passed as `hatPromptOffset` to all three GameModeState builders (chat, reactive, director).
- `_enforceGameModeRules(personaName)`: New post-processing function (mirrors `_ensurePersonaPrefix` pattern). For yesand mode, prepends "Yes, and " after `[NAME]` prefix if the response doesn't already start with it. Called in `wrappedOnFinish` after `_ensurePersonaPrefix`.

## Key Decisions

- `isNewPrompt = exchangeCount === 1 && offset > 50`: Guards spatial block from firing on the first hat prompt, where `SCENE_SETUP_PROMPT` is already injected (conflicting instructions).
- `Meanwhile` coord choice: x=650 (not x=1200 per issue spec) - x=1200 would exceed canvas bounds (50-1150). x=650 + w=480 = x=1130, just within bounds.
- Persona colors in `SYSTEM_PROMPT` (always present) not in conditional blocks - smaller models only reliably follow rules they see every request.

## What's Next

- UAT skipped (computer sleep killed dev server). The orchestrator can verify behaviors in prod after merge.
- All 5 issues addressed; types pass; branch is clean-committed.
