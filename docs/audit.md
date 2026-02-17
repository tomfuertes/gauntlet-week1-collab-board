# Codebase Audit - Feb 16, 2026

*7 parallel Sonnet agents analyzed spec compliance, git history, React/Konva performance, DO architecture, security, React patterns, and strategic roadmap.*

---

## Spec Compliance

### Board Features (all DONE)
- [x] Infinite canvas + pan/zoom
- [x] Sticky notes (create, edit, colors)
- [x] Shapes (rect, circle, line)
- [x] Connectors/arrows (coordinate-based, NOT object-to-object per spec `fromId/toId`)
- [x] Standalone text
- [x] Frames
- [x] Move/resize/rotate (resize missing for circles and lines - tech debt)
- [x] Single + multi-select (shift-click, marquee)
- [x] Delete, duplicate, copy/paste

### Real-Time (all DONE)
- [x] Multiplayer cursors with names + lerp smoothing
- [x] Object sync (optimistic + broadcast)
- [x] Presence (online user avatars)
- [x] LWW conflict handling
- [x] Disconnect/reconnect (exponential backoff + jitter)
- [x] Board state persistence (DO Storage + init message)

### AI Agent
- [x] 10 tools (exceeds 6 minimum): create_sticky, create_text, create_rect, create_circle, create_line, create_connector, create_frame, read_board, update_object, delete_object
- [x] Shared AI state (all users see results in real-time)
- [x] Multiple users can issue commands simultaneously
- [x] **`resizeObject(objectId, width, height)`** - FIXED. `update_object` now accepts width/height params.
- [ ] **`createConnector(fromId, toId, style)`** - PARTIAL. Uses coordinates (x1,y1,x2,y2) not object IDs.
- [ ] **SWOT analysis command** - Llama 3.3 unreliable. Haiku path merged (PR #16) but needs ANTHROPIC_API_KEY on prod.
- [ ] **"Arrange in a grid" command** - Multi-step spatial reasoning. Model quality issue.
- [ ] **<2s response for single-step** - Llama 3.3 is slow. Haiku would meet this.

### Performance Targets (all UNVERIFIED on prod)
- 60fps during pan/zoom - claimed, local only, audit found critical rendering issues
- Object sync <100ms - architecture supports it, never measured
- Cursor sync <50ms - never measured
- 500+ objects - tested locally (501 objects), not prod
- 5+ concurrent users - never actually tested

### Deliverables
- [x] GitHub repo with setup guide + architecture overview
- [x] Pre-search document (complete)
- [x] Deployed application (live on CF Workers)
- [ ] **Demo video (3-5 min)** - NOT STARTED
- [ ] **AI dev log** - template exists, all content sections are TODOs
- [ ] **AI cost analysis** - projections done, dev spend actuals missing
- [ ] **Social post** - NOT STARTED
- [x] **Privacy policy page** - DONE (`#privacy` route)
- [x] **Data deletion endpoint** - DONE (`DELETE /api/user`)
- [ ] **Prod smoke test (2-browser)** - NOT DONE

---

## Git History: CLEAN

No lost work. All 9 PRs squash-merged correctly. Every feature in commit messages confirmed present in code.

One incident: notes.md binary rebase conflict during frames PR, caught and fixed in 5 minutes (PR #13). Code was unaffected.

10 stale remote branches should be cleaned up.

---

## React/Konva Performance

### CRITICAL (ALL FIXED - Tier 2)
1. ~~**Grid renders 2000+ `<Rect>` nodes per frame**~~ - FIXED: single `<Shape>` with canvas 2D `sceneFunc`.
2. ~~**All 500 objects re-render on any single object change.**~~ - FIXED: `React.memo` on `BoardObjectRenderer`.
3. ~~**3000 event handler swaps per render at 500 objects.**~~ - FIXED: ref-mirror pattern stabilizes all callbacks.

### HIGH (FIXED/MITIGATED - Tier 2)
4. ~~**`handleWheel` + `handleMouseMove` recreated at 60fps**~~ - FIXED: ref-mirror for `stagePos`/`scale`.
5. ~~**`handleStageMouseMove` recreated during frame drag.**~~ - FIXED: ref-mirror for `frameDraft`.
6. ~~**Cursor updates trigger full Board re-render.**~~ - MITIGATED: `React.memo` prevents child re-renders. Split `useWebSocket` skipped.

### GOOD (no action needed)
- Cursor lerp (Cursors.tsx): imperative rAF with Konva refs, correct pattern
- Bulk drag: imperative node positioning during drag, state update only on dragEnd
- `listening={false}` on marquee, frame preview, grid dots
- `objectsRef` pattern for stable callback access
- Undo/redo: pure ref-based stack

---

## Senior React Patterns

### Memory Leaks (ALL FIXED - Tier 3)
- ~~**Konva Tweens never destroyed**~~ - FIXED: `onFinish: () => tween.destroy()`.
- ~~**SSE stream reader not cancelled on unmount**~~ - FIXED: AbortController ref + useEffect cleanup in `useAIChat`.
- ~~**AuthForm/BoardList fetch no AbortController**~~ - FIXED: AbortController on BoardList fetch, guard state updates.

### Stale Closures
- `handleStageMouseMove` depends on `frameDraft` state (should use ref) - handler recreated every mouse-move
- `handleWheel` depends on `scale, stagePos` (should use refs) - handler recreated every zoom
- `useAIChat.sendMessage` depends on `messages` - recreated after every exchange

### Component Structure
- **Board.tsx is 1177 lines** - god component. Extract: `<ToolbarPanel>`, `<ObjectLayer>`, `<EditingOverlay>` with `React.memo`.
- `ToolIconBtn` not memoized - 8 instances re-render on every cursor update
- `useEffect` with no dep array (line 61) syncs `initialized` to ref - should be plain assignment during render

### StrictMode Violations
- Confetti trigger mutates ref during render body (line 180-182)
- Cursors.tsx mutates position refs during render (should be `useLayoutEffect`)

---

## Durable Object Architecture

### GOOD
- Hibernatable WebSocket API used correctly
- Deterministic DO IDs (`idFromName`)
- No `blockConcurrencyWhile` misuse
- One DO per board (no global singleton)

### NEEDS_WORK
- ~~**Uncaught JSON.parse in WS handler**~~ - FIXED (Tier 1): try/catch added
- ~~**Board delete doesn't close live WS connections**~~ - FIXED (Tier 4): broadcasts `board:deleted` + closes connections
- **No rate limiting on login + AI endpoints** (medium, small - CF config)
- ~~**DO internal endpoints unauthenticated**~~ - RESOLVED: RPC refactor removed HTTP endpoints, only `fetch()` remains for WS upgrade
- **KV storage on SQLite-backed DO** (low - functional, not leveraging SQL)
- ~~**fetch-based DO communication**~~ - FIXED: refactored to typed RPC methods (`readObjects`, `mutate`, `clearBoard`, `deleteBoard`)
- **Session rows never cleaned up** (low at current scale)
- **Auth middleware inline, not Hono middleware** (medium - structural risk for new routes)

---

## Security

### CRITICAL
1. ~~**`/api/board/:boardId/clear` no ownership check**~~ - FIXED (Tier 1): ownership check added.
2. **Board mutation via WS has no board-level auth** - intentional design choice ("any auth'd user can access any board") but means any user can destructively mutate any board. Document explicitly.

### HIGH
3. ~~**Password min length = 4**~~ - FIXED (Tier 1): raised to 8.
4. ~~**No WS message validation**~~ - PARTIALLY FIXED (Tier 1): JSON.parse try/catch added. Size limit + field validation still open.
5. **No rate limiting** on auth + AI endpoints
6. **AI route accepts arbitrary boardId** - no D1 existence check, can create phantom DOs
7. **No upper bound on AI chat history** - client sends full history, no server-side truncation
8. **verifyPassword uses string equality** - timing attack (mitigated by PBKDF2 dominance but textbook anti-pattern)
9. **Username enumeration via signup 409** - signup returns "Username already taken"

### GOOD
- SQL fully parameterized (no injection)
- Cookie flags correct (HttpOnly, Secure, SameSite=Lax)
- PBKDF2 properly implemented (100k iterations, 16-byte salt, SHA-256)
- No XSS via canvas rendering (Konva doesn't interpret HTML)
- Session cookie validation on WS upgrade

---

## Prioritized Fix Plan

### Tier 1: Fix Today (DONE)
- [x] `/clear` ownership check
- [x] JSON.parse try/catch in DO WS handler
- [x] Password min length -> 8
- [x] `getMeta` inlined into `getPresenceList` (was used, not dead)
- [x] Redundant `ws.close()` removed in webSocketClose

### Tier 2: Performance (DONE, 3 of 4)
- [x] Grid: custom Konva `sceneFunc` (single `<Shape>`)
- [x] Extract memoized shape components (`React.memo`)
- [x] Ref-mirror for `stagePos`/`scale`/`selectedIds` (stabilize handlers)
- [ ] ~~Split `useWebSocket`~~ - skipped, memoization mitigates cursor re-render cost

### Tier 3: Memory Leaks (DONE)
- [x] Cancel SSE stream reader on unmount (`useAIChat`)
- [x] Destroy Konva Tweens on completion
- [x] AbortController on BoardList fetch

### Tier 4: Spec Gaps (DONE)
- [x] Add `width`/`height` to `update_object` AI tool
- [x] Privacy policy page (`#privacy` route)
- [x] Data deletion endpoint (`DELETE /api/user`)
- [x] Board delete broadcasts `board:deleted` + closes WS connections

### Tier 5: Deliverables (Thu-Fri) ~6hr
- [ ] AI dev log (fill all TODO sections)
- [ ] AI cost analysis (fill dev spend actuals)
- [ ] Demo video (3-5 min)
- [ ] Social post
- [ ] README polish + screenshot
- [ ] Prod smoke test (2-browser)

### Won't Fix (acceptable for Week 1)
- KV-on-SQLite storage pattern
- ~~DO RPC vs fetch~~ - FIXED: refactored to typed RPC
- Rate limiting (config-only but not blocking)
- CORS wildcard (masked by same-origin)
- Session row accumulation
- Connectors not object-to-object (coordinate-based is functional)
- `Board.tsx` god component split (desirable but high-effort mid-sprint)

---

## Key Findings

**Freehand/pen drawing:** NOT in spec. Not required. Miro has it but spec explicitly lists shapes as rect/circle/line.

**Biggest demo risk:** SWOT analysis eval criterion. Llama 3.3 will fail it. Haiku path is merged (PR #16) but needs `ANTHROPIC_API_KEY` set as Worker secret on prod.

**Biggest technical risk:** ~~The grid rendering issue~~ FIXED - single `<Shape>` sceneFunc. Remaining risk is Board.tsx complexity (1177 lines).

**No lost work:** Git history is clean across all 9 worktree PRs. The rapid parallel development process worked.
