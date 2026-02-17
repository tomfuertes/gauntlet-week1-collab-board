# Roadmap

*Trade-offs, scope cuts, and fast-follow items*

## Shipped

- [x] Pre-Search architecture discovery
- [x] Stack decision (CF Workers + DOs + React + react-konva)
- [x] Auth decision (custom > Better Auth due to CF Workers bugs)

## MVP

- [x] Scaffold (Vite + Worker + Hono + D1)
- [x] Auth (signup/login/logout)
- [x] Infinite canvas (pan/zoom)
- [x] Cursor sync (WebSocket + DO)
- [x] Presence (online users)
- [x] Sticky notes + sync (create, drag, inline text edit, 2-browser verified)
- [x] Rectangle shape + sync
- [x] Move/resize/edit (drag-to-move + Konva Transformer resize)
- [x] LWW conflict handling
- [ ] Deploy + smoke test (prod 2-browser)

## Post-MVP: Core Features (Wed-Thu)

- [x] Delete objects (keyboard Del/Backspace + click-to-select)
- [x] AI agent (Workers AI + function calling) - **high priority for Gauntlet AI demo**
- [x] Chat panel UI (sidebar for AI interaction)
- [x] Multi-board support (CRUD, hash routing, board list page)
- [x] Circles, lines, connectors/arrows
- [ ] Standalone text
- [x] Multi-select, copy/paste, duplicate
- [x] Undo/redo (local)
- [ ] Frames/groups

## Post-MVP: UX Polish (Thu-Fri)

- [x] Selection outline (blue stroke on click - MVP version, no Transformer)
- [x] Color picker for stickies + rects
- [x] Better toolbar (SVG icons, vertical left sidebar, select/sticky/rect/circle/line/delete/AI)
- [x] Empty state hint ("Double-click to create")
- [x] Connection toasts ("Connected", "Reconnecting...")
- [ ] Fit-to-content / zoom-to-all button
- [x] Object resize (Konva Transformer handles)
- [x] Loading skeleton while WebSocket connects

## Post-MVP: Pizzazz (Fri)

- [ ] Cursor smoothing (lerp between positions for buttery animation)
- [ ] Object entrance animations (scale-in on create, fade-out on delete)
- [ ] Confetti burst on first object created (onboarding delight)
- [ ] Ambient grid parallax (subtle depth on pan)
- [ ] Gradient or noise background instead of flat color
- [ ] Presence cursor trails (fading ghost trail behind cursors)
- [ ] Board minimap (small overview in corner)
- [ ] Keyboard shortcut cheat sheet (? key to toggle overlay)

## Polish (Sat-Sun)

- [ ] Demo video
- [ ] AI dev log (finalize)
- [ ] AI cost analysis (fill in actuals)
- [ ] Privacy policy page
- [ ] Data deletion endpoint
- [ ] Social post
- [ ] README polish with GIF/screenshot of real-time sync

## Fast-Follow (post-submission)

- OAuth (GitHub/Google) via manual flow or Better Auth if bugs resolved
- Board permissions (owner/editor/viewer roles)
- Data residency pinning for enterprise
- Export (PDF/PNG)
- Mobile-responsive UI
