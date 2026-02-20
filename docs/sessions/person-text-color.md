# Session: person-text-color

**Branch:** feat/person-text-color
**Date:** 2026-02-20

## Change

`BoardObjectRenderer.tsx` line 216: person name label `fill` changed from `{color}` (figure body color) to `"#ffffff"` (white).

## Why white vs. body color

The label floats *above* the figure (y: `-(nameFontSize + 4)`), so it renders against the canvas background - not the figure. `getUserColor()` produces saturated mid-tone colors (readable on white/light surfaces, but marginal on dark canvas). Hard-coding white gives guaranteed contrast on the dark canvas regardless of which player color is assigned.
