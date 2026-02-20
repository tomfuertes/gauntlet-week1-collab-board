# Session: merge-gallery

## What was done
- Merged SceneGallery component into BoardList - absorbed SceneCard + thumbnailGradient inline (single-use, no shared module needed)
- Moved "Create New Board" from embedded grid card to prominent full-width button above the grid
- Added "Community Scenes" section below personal boards, fetching /api/boards/public
- Removed #gallery hash route, Gallery nav link, showGallery state from App.tsx
- Deleted SceneGallery.tsx
- Server: excluded system boards from both GET /api/boards and GET /api/boards/public queries
- Removed created_by !== 'system' guard on Delete button (server-side ownership check is the real protection)

## Review fixes applied
- Restored scenesError state (was in SceneGallery but not ported - regression caught by review)
- Swapped raw `<button>` for `Button variant="primary"` for consistency with codebase conventions

## Key decisions
- KEY-DECISION 2026-02-20: Absorb SceneCard inline rather than extract to shared module - it's used in one place only, premature abstraction not warranted
- System board exclusion is via WHERE clause (server), not client-side filtering - cleaner data boundary

## UAT results
- Board list renders with correct layout (challenge banner, create button, your boards, community scenes)
- Create New Board navigates to new board correctly
- Board appears in both Your Boards and Community Scenes (correct - dual-view of same data)
- No Gallery link in header confirmed

## Commit
- `00ecc0f` feat: merge Scene Gallery into Board List, remove default board surfacing
