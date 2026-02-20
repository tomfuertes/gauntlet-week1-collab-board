# Session: mobile-ux

**Date:** 2026-02-20
**Branch:** feat/mobile-ux
**Issues:** #35, #32, #28, #37-M1 (scene budget badge visibility)

## What Was Done

### Issue #35: OnboardModal on mobile (HIGH)
- Added `showMobileOnboard` flag in mobile layout path of `Board.tsx`
- OnboardModal renders on top of mobile layout when board is empty and scene hasn't started
- Uses same `boardGenStarted` flag as desktop to track dismissed state
- KEY-DECISION: Modal renders above ChatPanel in the flex column - z-index via Modal component handles stacking

### Issue #32: Default model to Claude Haiku 4.5 (CRITICAL)
- `OnboardModal.tsx` already had `claude-haiku-4.5` as default (was previously fixed or never changed)
- Changed `Board.tsx:159` `aiModel` state from `"gpt-4o-mini"` to `"claude-haiku-4.5"`
- This is the state that controls which model is actually sent per-message

### Issue #28: Chat sidebar height constraint (already done)
- `ChatPanel.tsx` desktop container already had `top: 64` and `maxHeight: "min(600px, 50vh)"`
- No changes needed - was already implemented

### Issue #37-M1: Mobile touch targets (44px minimum)
Already implemented in ChatPanel.tsx:
- Back button in mobile header: `minHeight: 44, minWidth: 44`
- Back button in expanded canvas header: `minHeight: 44, minWidth: 44`
- "Anyone" persona pill (ChatPanel inline picker): `minHeight: 44, minWidth: 44`
- Per-persona pills (ChatPanel inline picker): `minHeight: 44, minWidth: 44`
- Send button: `minHeight: 44, minWidth: 44`
- Tool disclosure button: `minHeight: 44, minWidth: 44`

### Scene Budget Badge Visibility
Already implemented in ChatPanel.tsx:
- Font size: 0.625rem -> 0.75rem
- Font weight: 700 -> 800
- Background opacity: 18 -> 28
- Border: 1px solid ${color}44 -> 1.5px solid ${color}88
- Padding: 1px 8px -> 2px 10px
- Added letterSpacing: 0.02em

## UAT Results

All 5 test scenarios passed:
1. OnboardModal appears on mobile (375x812) with game mode + model + persona selection ✓
2. Touch targets >= 44px: Back button (44px), Anyone pill in ChatPanel (44px), Send button (44px) ✓
3. Default model shows "claude-haiku-4.5" ✓
4. Chat sidebar doesn't overlap header (starts at y=64) ✓
5. Chat sidebar height respects max constraint (450px at 900px viewport, matching min(600px,50vh)) ✓

## Key Decisions

- `showMobileOnboard` is scoped inside the mobile layout block - avoids polluting Board's main state
- Mobile OnboardModal uses identical props as desktop - no separate component needed
- Board.tsx `aiModel` default must match OnboardModal default (claude-haiku-4.5) for consistency when user dismisses modal without selecting

## Notes

- The OnboardModal persona pills in the modal itself don't have 44px touch targets - these were not in scope for #37-M1 (the modal is used on desktop too and has appropriate desktop sizing)
- The inline persona claim pills in ChatPanel (the secondary picker for Player B) do have 44px targets
