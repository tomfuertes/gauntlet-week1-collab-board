# Session: person-toolbar

**Date:** 2026-02-20
**Branch:** feat/person-toolbar
**Task:** #24 - Person toolbar: click-to-place with name prompt

## What was done

Wired the person toolbar button click-to-place flow in Board.tsx.

**Change:** Added `else if (ds.toolMode === "person")` branch in `handleStageMouseUp` click case (~line 949).

- `window.prompt("Character name:")` for name entry - synchronous, no extra state, Cancel aborts creation
- Creates `type: "person"` object centered on click with 60x120px dimensions
- `props.color = getUserColor(user.id)` for user-colored figure
- Resets `toolMode` to `"select"` after creation
- Empty name fallback to `"Character"`

**KEY-DECISION 2026-02-20:** Used `window.prompt` instead of inline input overlay - synchronous, no React state needed, Cancel clearly aborts. Person placement is one-at-a-time (unlike stickies), so rapid multi-place isn't a use case.

## UAT result

- Stick figure "Alice" rendered on canvas at click position in user's orange color
- toolMode reverted to select after creation
- Objects count went 0→1, Nodes 4→5 as expected
- Cancel (null) correctly aborts - no object created

## Files changed

- `src/client/components/Board.tsx` (+20 lines, click branch only)
