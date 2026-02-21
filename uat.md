# UAT Checklist - Prod Smoke Test

**Target:** https://yesaind.com
**Covers:** Tasks #111 (full UAT) + #123 (new model verification)

---

## Auth & Landing

- [ ] Visit root URL unauthenticated - see branded YesAInd landing page
- [ ] "Watch the Gallery" link works - navigates to #gallery
- [ ] Gallery shows public scenes with replay links
- [ ] Click a replay - scene replays (no auth required)
- [ ] Privacy policy link works from landing page
- [ ] Sign up with passkey (or password fallback)
- [ ] Sign in - redirects to board list

## Board List

- [ ] Board cards show thumbnail previews (gradient bg + mini shapes)
- [ ] Hover on card - see edit/delete menu
- [ ] Sort dropdown uses custom Select component (not native)
- [ ] Create new board - opens OnboardModal

## OnboardModal & Scene Start

- [ ] Game mode pills work (Freeform / Hat Game / Yes And)
- [ ] Persona picker works (Anyone + SAGE/LUMA/RIFF/ECHO)
- [ ] Model dropdown shows all models including new ones
- [ ] Template chips load correctly
- [ ] Type prompt + Go - scene creates, chat opens

## New Model Verification (#123)

- [ ] Select **GPT-5.1 Mini** in model dropdown
- [ ] Send a chat message - AI responds (no provider error)
- [ ] Select **Claude Sonnet 4.6** in model dropdown
- [ ] Send a chat message - AI responds (no provider error)
- [ ] Try at least one other model (e.g. Claude Haiku 4.5) as baseline

## Canvas & Objects

- [ ] Double-click to create sticky note
- [ ] Drag objects - smooth movement
- [ ] Resize object - works correctly
- [ ] Connector tool: draw line between two boxes - snaps to both ends
- [ ] Connector snap works when one box is INSIDE a larger box (dfcf536 fix)
- [ ] Board header shows scene name (not just "Board")
- [ ] Custom Select for model switcher in header works

## Button States

- [ ] Toolbar buttons show hover state (background change)
- [ ] Toolbar buttons show active/pressed state
- [ ] Header buttons (settings, etc.) have hover states

## Animations

- [ ] AI moves an object - smooth tween animation (not teleport)
- [ ] AI resizes an object - smooth animation
- [ ] AI creates effect (sparkle/poof/explosion/highlight) - renders + auto-removes
- [ ] Choreograph sequence: AI does enter/exit/punch - objects animate in sequence

## Mood Lighting

- [ ] AI sets mood - canvas background shows gradient animation
- [ ] Gradient transitions smoothly (no flash/jump)
- [ ] Mood persists if you refresh the page

## Curtain Call

- [ ] Scene ends - curtain call overlay appears
- [ ] Confetti burst animation plays
- [ ] Star rating UI shows - can rate the scene
- [ ] Rating submits successfully

## Two-Browser Sync

- [ ] Open same board in two browser windows
- [ ] Create object in window A - appears in window B
- [ ] Move object in window A - moves in window B
- [ ] Delete object - removed in both windows
- [ ] Cursor movement visible in other window
- [ ] AI response appears in both windows' chat

## Spectator (if /watch route exists)

- [ ] Open #watch/{boardId} - read-only view loads
- [ ] Can see objects but NOT edit them
- [ ] Reaction bar works - emoji reactions appear
- [ ] Heckle unlocks after 5 reactions

---

## Feedback Format

When reporting issues, just tell me:
- **Feature area** (e.g. "Model verification")
- **What happened** vs **what you expected**
- **Severity**: blocker / bug / polish

I'll triage into the task queue or fix in-flight.
