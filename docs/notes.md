# Notes

*Internal project management scratch. Not a deliverable.*

## Tuesday MVP Gate Strategy (Feb 17 check-in)

**Priority: stable locked link. Do NOT push unfinished features before check-in.**

MVP status: **9/9 requirements done** (infinite board, stickies, rect, create/move/edit, real-time sync, cursors, presence, auth, deployed). Plus bonus: AI agent, delete, chat panel, multi-board.

**Pre-check-in checklist:**
- [ ] Push to main, smoke test prod URL with 2 browsers
- [ ] Verify: simultaneous editing, refresh mid-edit (state persistence), rapid create/move
- [x] Check WebSocket reconnect behavior (implemented: exponential backoff + jitter + UI banner)
- [x] Quick sanity check: 500+ objects rendering performance - PASS (501 objects, renders at 16% zoom, zoom controls responsive)
- [x] Verify textarea overlay behavior on refresh - PASS (app reloads cleanly, in-progress text lost but no crash)

**QA test matrix:**
1. 2 users editing simultaneously in different browsers
2. Refresh mid-edit (state persistence via DO Storage `init` message)
3. Rapid creation and movement (sync performance)
4. Network throttling and disconnection recovery (implemented: backoff + jitter + banner)
5. 5+ concurrent users

**Performance targets (part of gate):**
- 60fps during pan/zoom/manipulation
- Object sync <100ms, cursor sync <50ms
- 500+ objects without degradation, 5+ concurrent users

**Known risks:**
- WS reconnect implemented but no max retry or auth-aware close codes (see Tech Debt)
- 500+ objects tested locally, not tested on prod
- AI tool-use quality is shaky (Llama 3.3, mitigated with prompt + maxRecursiveToolRuns:3)

---

## AI Model Pricing & Upgrade Path (Feb 2026)

**Full model comparison (per 1M tokens):**

| Model | Input | Output | Tool-use | Notes |
|-------|-------|--------|----------|-------|
| **Free tier** | | | | |
| Llama 3.3 70B (Workers AI) | $0.29 | $2.25 | Poor | Free 10k neurons/day (~185 reqs). Duplicate calls, skips read-before-update. |
| Gemini 2.5 Flash Lite (Google) | $0.10 | $0.40 | Good | Free tier available (rate-limited). 1M context. |
| **Budget tier ($0.0001-0.0005/req)** | | | | |
| GPT-4.1 Nano (OpenAI) | $0.10 | $0.40 | Untested | Cheapest OpenAI. Unknown tool-use at this size. |
| Gemini 2.0 Flash (Google) | $0.10 | $0.40 | Good | Previous gen, but solid tool calling. 1M context. |
| GPT-5 Mini (OpenAI) | $0.25 | $2.00 | Good+ | Newer than 4.1 mini, likely better reasoning. |
| Gemini 2.5 Flash (Google) | $0.30 | $2.50 | Good+ | Latest Flash. Thinking tokens billed separately. |
| GPT-4.1 Mini (OpenAI) | $0.40 | $1.60 | Good | Strong function calling. Solid budget option. |
| **Mid tier ($0.001-0.002/req)** | | | | |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Zero tool-call failures in benchmarks. Best agentic reliability. |
| o4-mini (OpenAI) | $1.10 | $4.40 | Great | Reasoning model, may be slow for real-time chat. |
| Gemini 2.5 Pro (Google) | $1.25 | $10.00 | Great | Google flagship. 1M context. |
| GPT-5 (OpenAI) | $1.25 | $10.00 | Great | OpenAI flagship. |

**Recommendation:** Free Llama 3.3 for demo. Production upgrade:
- **Cheapest good**: Gemini 2.5 Flash Lite or GPT-4.1 Nano ($0.00013/req)
- **Safe budget**: GPT-5 Mini or GPT-4.1 Mini (~$0.0005/req)
- **Best quality**: Claude Haiku 4.5 ($0.0015/req)

Integration: CF AI Gateway (drop-in proxy) or direct REST calls. Add API key as Worker secret.

**`runWithTools` internals** (`@cloudflare/ai-utils`):
- `maxRecursiveToolRuns` counts LLM round-trips, not individual tool invocations
- Each round-trip: LLM response -> execute ALL tool calls in parallel -> add results -> next round
- We use 3 (was 10, caused triple-creation). Default is 0 (no recursion).

---

## Rough Plan: Multi-Model AI with Key-Gated Provider Selection (~120 LOC)

**Core idea:** Detect which API keys are configured as Worker secrets. Only offer those in ChatPanel dropdown. Llama 3.3 always available (no key).

**Secrets:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`
Detection: `env.OPENAI_API_KEY?.length > 0`

**Backend:**
1. `GET /api/ai/models` - filter models by key presence (~20 LOC)
2. Provider abstraction - two code paths: `runWithTools` (Workers AI) vs OpenAI-compat REST with manual tool loop (~80 LOC)
3. Tool functions unchanged - they just call the DO

**Frontend:** Dropdown in ChatPanel, persist in localStorage, send `modelId` with each request (~15 LOC)

**Open questions:** Streaming format per provider, global vs per-board model selection

---

## Sprint Plan (Session 7, Feb 16 - Deadline Sunday Feb 22 10:59 PM CT)

### Spec Coverage Tracker

**Board features:**
| Feature | Spec? | Status | Worktree |
|---------|-------|--------|----------|
| Infinite canvas + pan/zoom | Required | DONE | |
| Sticky notes | Required | DONE | |
| Rectangles | Required | DONE | |
| Circles | Required | DONE | |
| Lines | Required | DONE | |
| Standalone text | Required | DONE (PR #9) | |
| Connectors/arrows | Required | Lines only, no arrows | `feat/connectors` IN FLIGHT |
| Frames/groups | Required | Not started | `feat/frames` IN FLIGHT |
| Move/resize/rotate | Required | DONE | |
| Multi-select | Required | Not started | `feat/multi-select` IN FLIGHT |
| Delete | Required | DONE | |
| Copy/paste/duplicate | Required | DONE | `feat/copy-paste` |

**Real-time (all DONE):** cursors, sync, presence, LWW, reconnect, persistence.

**AI agent:**
| Requirement | Status | After Current Wave |
|---|---|---|
| 6+ command types | 8 tools now | 10+ with frames+connectors |
| `createFrame` | Blocked by frames canvas | Unblocked |
| `createConnector` | Blocked by connectors canvas | Unblocked |
| `resizeObject` (dedicated) | Covered by update_object | Could add |
| `changeColor` (dedicated) | Covered by update_object | Could add |
| "Create SWOT analysis" | BLOCKED (no frames + weak model) | Unblocked if frames + model fix |
| "Arrange in a grid" | Possible but Llama 3.3 unreliable | Model quality issue |
| <2s single-step response | Llama 3.3 is slow | Model quality issue |

**Deliverables:**
| Deliverable | Status | Effort | Blocked By |
|---|---|---|---|
| GitHub repo | Exists, needs README polish | 30 min | Features done |
| Demo video (3-5 min) | NOT STARTED | 2 hr | All features |
| Pre-search doc | DONE | | |
| AI dev log | 12 TODOs | 1 hr writing | |
| AI cost analysis | 7 TODOs | 1 hr writing | |
| Deployed app | LIVE | | |
| Social post | NOT STARTED | 15 min | Demo video |
| Prod smoke test | NOT DONE | 30 min | |
| Privacy policy | NOT STARTED | 30 min | |
| Data deletion endpoint | NOT STARTED | 30 min | |

### Worktree Waves

**Wave 1 (DONE - PRs #9-#12 merged):**
- ~~`feat/standalone-text`~~ MERGED - standalone text + AI create_text
- ~~`feat/frames`~~ MERGED - frame containers + AI createFrame
- ~~`feat/connectors`~~ MERGED - arrowhead connectors + AI create_connector
- ~~`feat/multi-select`~~ MERGED - shift+click, marquee, bulk ops
- `feat/e2e-tests` - Playwright test suite (still in flight)

**Wave 2 (after wave 1 merges):**
- AI tool expansion - `createFrame`, `createConnector`, `resizeObject`, `changeColor`
- Copy/paste/duplicate - last spec-required operation
- Fit-to-content button - small UX win

**Wave 3 (parallel with writing):**
- Privacy policy + data deletion endpoint
- Visual polish (see backlog below)

## Visual Differentiation Backlog

*Shared constants extracted to `src/client/theme.ts`. Still inline `style={}`, no CSS framework.*

**High impact (demo video differentiators):**
- [x] **Micro-interactions** - object fade-in on create (Konva Tween: opacity 0->1, scale 0.8->1, 200ms EaseOut), toolbar hover scale(1.1) transition. Skips initial load objects via `wasInitializedRef` lag.
- [x] **Consistent dark theme** - indigo-500 `#6366f1` accent across: toolbar active/hover, Transformer, marquee, presence avatars, color picker outline, ChatPanel send button, user message bubbles, BoardList hover. Shared via `colors` from `theme.ts`.
- [x] **Cursor lerp** - rAF loop with LERP_FACTOR=0.25, Konva Group refs bypass React re-renders, target/display positions in refs. ~200ms to 95% of target.

**Medium impact (first impression):**
- [x] **Branded login page** - two-column layout: left gradient panel (indigo->dark) with app name + tagline + decorative dot grid, right panel with form. Dark theme.
- [x] **Canvas background** - subtle radial indigo glow (fillRadialGradient on Rect) behind grid dots, dot opacity bumped 0.08->0.1.
- [x] **Custom cursor icons per tool** - crosshair for drawing tools, text for text tool, default for select. CSS cursor set on outer wrapper div via `toolCursors` map.

**Low impact (nice-to-have):**
- [x] **Object entrance animations** - Konva Tween: scale 0.8->1 + opacity 0->1 on create (200ms EaseOut)
- [x] **Confetti on first object** - 40 CSS particles with custom property animation, triggered on 0->1 object transition, auto-cleanup 1.8s
- [x] **Presence cursor trails** - Konva Line polyline per cursor, tension=0.4 smooth curve, 12 sample points at ~20Hz, opacity 0.3, updated imperatively in rAF loop
- [ ] **Board minimap** - small overview in corner
- [x] **Keyboard shortcut overlay** - ? key to toggle, lists all 19 shortcuts in a modal grid

**Sequential (after all code):**
- Prod smoke test
- README polish with screenshots
- AI dev log + cost analysis (writing)
- Demo video (LAST - needs everything working)

### Critical Path

~~frames lands~~ DONE -> AI tool expansion (already in PRs) -> prod smoke test -> demo video

### Key Risk

Llama 3.3 can't reliably do multi-step AI commands (SWOT, grid layout). The multi-model plan (Haiku via AI Gateway, ~120 LOC) would fix this but requires ANTHROPIC_API_KEY as Worker secret.

### Design Principle
> Prioritize bulletproof sync + working AI agent over feature count.

---

## Key Decisions (all sessions)

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 16 | Custom auth over Better Auth | Active CF Workers bugs in Better Auth 1.4.x ([#6665](https://github.com/better-auth/better-auth/issues/6665), [#6545](https://github.com/better-auth/better-auth/issues/6545)) |
| Feb 16 | PBKDF2 over argon2 | Web Crypto built-in, zero deps, sufficient for identity-only auth |
| Feb 16 | No CRDTs | DOs serialize writes, LWW by construction |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is the differentiator |
| Feb 16 | HTML overlay for text editing | Konva built-in text editing doesn't support multiline well |
| Feb 16 | Hash routing over React Router | Zero deps, shareable links, browser back/forward |
| Feb 16 | Tracked migrations over raw execute | `d1_migrations` table, `npm run migrate` |
| Feb 16 | Llama 3.3 for now, Haiku upgrade path | Free tier for demo, quality issues mitigated with prompt hacks |


## Known Tech Debt

- Vite build >500KB chunk (konva + react) - code split in polish
- WS reconnect has no max retry limit (retries every ~8s forever; acceptable for collab app, user navigates away to stop)
- WS reconnect doesn't distinguish non-retryable close codes (server returns 401 as HTTP pre-upgrade, Chrome maps to 1006 - indistinguishable from network failure; needs server-side close code fix)
- `send()` silently drops messages during reconnect window (optimistic local state can diverge until next `init`)
- Undo stack not cleared on WS reconnect (`init` replaces objects but stale snapshots remain in undo stack; undo after reconnect can apply outdated state)
- AI `update_object` does flat props replace (not deep merge)
- `Ai` type mismatch requires `as any` cast in ai.ts (cosmetic)
- Lines have no resize handles (drag-to-move only, no endpoint editing)
- Resize not implemented for circles (drag-to-move only)
- No React error boundary for graceful failures
- No automated tests (zero test files in src/)
