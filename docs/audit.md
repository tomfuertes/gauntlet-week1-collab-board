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
- [ ] **`resizeObject(objectId, width, height)`** - MISSING. `update_object` does not accept width/height params.
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
- [ ] **Privacy policy page** - NOT STARTED
- [ ] **Data deletion endpoint** - NOT STARTED
- [ ] **Prod smoke test (2-browser)** - NOT DONE

---

## Git History: CLEAN

No lost work. All 9 PRs squash-merged correctly. Every feature in commit messages confirmed present in code.

One incident: notes.md binary rebase conflict during frames PR, caught and fixed in 5 minutes (PR #13). Code was unaffected.

10 stale remote branches should be cleaned up.

---

## React/Konva Performance

### CRITICAL
1. **Grid renders 2000+ `<Rect>` nodes per frame** during pan/zoom. Called inline in JSX, regenerated on every render including cursor updates. Fix: `useMemo` or custom Konva `sceneFunc`.
2. **All 500 objects re-render on any single object change.** Array spread + filter on every render, no memoized child components. Fix: extract memoized shape components with `React.memo`.
3. **3000 event handler swaps per render at 500 objects.** Inline arrow functions in JSX create new refs every render, forcing Konva to unbind/rebind all listeners. Fix: stable callbacks in memoized children.

### HIGH
4. **`handleWheel` + `handleMouseMove` recreated at 60fps** during zoom/pan. `stagePos` and `scale` in deps. Fix: ref-mirror pattern (already used for `objectsRef`).
5. **`handleStageMouseMove` recreated during frame drag.** Reads `frameDraft` state instead of `frameDraftRef.current`. Fix: use ref, remove from deps.
6. **Cursor updates trigger full Board re-render.** `useWebSocket` returns both objects and cursors; cursor changes re-render everything. Fix: split into `useObjects` + `useCursors`.

### GOOD (no action needed)
- Cursor lerp (Cursors.tsx): imperative rAF with Konva refs, correct pattern
- Bulk drag: imperative node positioning during drag, state update only on dragEnd
- `listening={false}` on marquee, frame preview, grid dots
- `objectsRef` pattern for stable callback access
- Undo/redo: pure ref-based stack

---

## Senior React Patterns

### Memory Leaks
- **Konva Tweens never destroyed** - created on every object ref attach, never stored or cleaned up. Fix: Map ref + destroy on unmount.
- **SSE stream reader not cancelled on unmount** - `useAIChat` while(true) loop continues after ChatPanel closes. Fix: check `controller.signal.aborted` in loop.
- **AuthForm/BoardList fetch no AbortController** - state set on unmounted component. Low real-world impact.

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
- **Uncaught JSON.parse in WS handler** (medium, trivial fix) - bad message crashes connection
- **Board delete doesn't close live WS connections** (medium, small fix) - cleared board keeps serving
- **No rate limiting on login + AI endpoints** (medium, small - CF config)
- **DO internal endpoints unauthenticated** (low - only Worker can reach them)
- **KV storage on SQLite-backed DO** (low - functional, not leveraging SQL)
- **fetch-based DO communication** (low - RPC is the modern pattern)
- **Session rows never cleaned up** (low at current scale)
- **Auth middleware inline, not Hono middleware** (medium - structural risk for new routes)

---

## Security

### CRITICAL
1. **`/api/board/:boardId/clear` no ownership check** - any auth'd user can wipe any board. DELETE route has the check, clear doesn't. One-line fix.
2. **Board mutation via WS has no board-level auth** - intentional design choice ("any auth'd user can access any board") but means any user can destructively mutate any board. Document explicitly.

### HIGH
3. **Password min length = 4** - raise to 8+
4. **No WS message validation** - no JSON.parse try/catch, no field validation, no size limit
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

### Tier 1: Fix Today (trivial, high impact) ~30min
- [ ] `/clear` ownership check (1 line)
- [ ] JSON.parse try/catch in DO WS handler (5 lines)
- [ ] Password min length -> 8 (1 line)
- [ ] Remove dead `getMeta` method (3 lines)
- [ ] Remove redundant `ws.close()` in webSocketClose (2 lines)

### Tier 2: Performance (Mon-Tue) ~5hr
- [ ] Grid: `useMemo` or custom Konva `sceneFunc`
- [ ] Extract memoized shape components (`React.memo`)
- [ ] Ref-mirror for `stagePos`/`scale` (stabilize handlers)
- [ ] `frameDraftRef.current` instead of `frameDraft` in handleStageMouseMove
- [ ] Split `useWebSocket` -> `useObjects` + `useCursors`

### Tier 3: Memory Leaks (Tue) ~1hr
- [ ] Cancel SSE stream reader on unmount (`useAIChat`)
- [ ] Destroy Konva Tweens on unmount/removal
- [ ] AbortController on AuthForm/BoardList fetches

### Tier 4: Spec Gaps (Tue-Wed) ~2hr
- [ ] Add `width`/`height` to `update_object` AI tool (fix `resizeObject`)
- [ ] Privacy policy page
- [ ] Data deletion endpoint (`DELETE /api/user`)
- [ ] Board delete broadcasts `board:deleted` + closes WS connections

### Tier 5: Deliverables (Thu-Fri) ~6hr
- [ ] AI dev log (fill all TODO sections)
- [ ] AI cost analysis (fill dev spend actuals)
- [ ] Demo video (3-5 min)
- [ ] Social post
- [ ] README polish + screenshot
- [ ] Prod smoke test (2-browser)

### Won't Fix (acceptable for Week 1)
- KV-on-SQLite storage pattern
- DO RPC vs fetch
- Rate limiting (config-only but not blocking)
- CORS wildcard (masked by same-origin)
- Session row accumulation
- Connectors not object-to-object (coordinate-based is functional)
- `Board.tsx` god component split (desirable but high-effort mid-sprint)

---

## Key Findings

**Freehand/pen drawing:** NOT in spec. Not required. Miro has it but spec explicitly lists shapes as rect/circle/line.

**Biggest demo risk:** SWOT analysis eval criterion. Llama 3.3 will fail it. Haiku path is merged (PR #16) but needs `ANTHROPIC_API_KEY` set as Worker secret on prod.

**Biggest technical risk:** The grid rendering issue (#1 above) is generating 2000+ React elements on every frame. During a live demo with pan/zoom, this will visibly stutter.

**No lost work:** Git history is clean across all 9 worktree PRs. The rapid parallel development process worked.
