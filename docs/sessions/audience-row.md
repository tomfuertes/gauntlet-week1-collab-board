# Session: audience-row (2026-02-20)

## What was built
AudienceRow component - spectator silhouettes at bottom of Konva Stage.

## Files changed
- `src/client/components/AudienceRow.tsx` (new): Konva Layer with head+shoulder Ellipses
- `src/client/components/Board.tsx`: import + `<AudienceRow>` inside Stage, updated reaction rendering
- `src/client/styles/animations.css`: `cb-audience-float` + `.cb-audience-reaction`

## Key decisions
- **GAP=36 is center-to-center stride** (not whitespace gap). 28 figures × 36px = 1000px total, fits within 1100px canvas.
- **Reaction positioning**: when spectatorCount > 0, emoji floats from random audience figure (deterministic index via `parseInt(r.id.substring(0, 2), 16) % xs.length`, NaN-safe fallback to 0).
- **Separate Layer**: `listening={false}` + `opacity={0.75}` so clicks pass through; audience sits above cursor layer in z-order but below HTML overlays.

## UAT results
- 1 spectator → 1 centered silhouette at world (600, 740) ✅
- 2 spectators → 2 silhouettes side-by-side ✅
- Header "N watching" counter updates in real-time ✅
- Zero-case: early return guard (`if (spectatorCount === 0) return null`) verified in code; wrangler dev WS close detection delay made live verification impractical (known gotcha)

## PR review findings fixed
- silent-failure-hunter: added `Number.isNaN(raw) ? 0 : raw` guard for UUID format assumption
- code-reviewer: no issues found
