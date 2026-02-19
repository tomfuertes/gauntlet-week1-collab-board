# Notes

*Internal project management scratch. Not a deliverable.*

## Session 18 Context (Feb 18, 2026)

### What Was Done
- **Perf overlay (merged + reviewed):** FPS, msg age, object count, Konva nodes, connection state. Review caught broken WS latency measurement (replaced with honest msg age), bare catch, stale FPS buffer, refs in deps array.
- **UX intents (merged):** Dynamic intent chips + AI intent patterns for improv canvas.
- **AI Director (merged):** Proactive mode - scene complications after 60s inactivity, scene phase tracking in DO, dramatic structure system prompt.
- **Scene playback (merged):** Event recording in DO, public replay endpoint, ReplayViewer with play/pause, share scene button, `#replay/{id}` route.
- **Async notifications (merged):** D1 activity tracking (migration 0003), activity endpoint, unread badges in BoardList.
- **Scene gallery (merged):** Public `#gallery` route, `/api/boards/public` endpoint, SceneGallery grid with replay links.
- **AI architecture audit (merged):** Extracted prompts to `src/server/prompts.ts` with version constants, structured tool call logging (`instrumentExecute()`), optimized `getBoardState` token usage, `docs/ai-architecture.md`.
- **CI fix:** Skipped heavy 5-user perf test in CI (runner OOM), tagged `@heavy`.
- **Worktree DX:** Added `wrangler types` to worktree setup, codified lifecycle (implement -> review -> fix -> UAT -> commit, no PR).

### UAT Results (Prod)
- 14/17 pass. Two known failures:
  - AI Director nudge didn't fire after 70s idle (DO alarm issue on prod)
  - Async badges: boards not visible cross-user (board discovery gap, not notification bug)
- Core viral loop works: auth -> board -> scene -> AI objects -> share replay -> watch replay

### The Loop

```
open board -> play scene -> share replay link -> recruit new player
                                 ^                      |
                                 |   async badges       |
                                 +--- bring them back --+
```

---

## Roadmap Status

### Shipped
- Pre-search, scaffold, auth
- Infinite canvas, cursor sync, presence
- Sticky notes, rectangles, circles, lines, connectors/arrows, standalone text, frames
- Move/resize/rotate, multi-select, copy/paste/duplicate, undo/redo, delete
- AI agent (10 tools, DRY helpers, overlap scoring, updateAndMutate, type-linked ToolName)
- Chat panel (chips, templates, typing indicator, server-side history persistence)
- Multi-board CRUD, hash routing, color picker, toolbar
- Connection toasts, loading skeleton, empty state hint
- Cursor smoothing, entrance animations, confetti, gradient background, cursor trails
- Keyboard shortcuts, privacy policy, data deletion endpoint, context menu
- Selection-aware AI, AI object glow, live text sync, remote carets, stale cursor TTL
- AI batch undo (batchId, Undo AI button, Cmd+Z batch)
- AI presence lite (cursor dot, presence bar)
- AI board generation (empty state overlay, suggestion chips, board-templates.ts)
- Multiplayer chat attribution ([username] prefix, color-coded sender names)
- Improv mode ("yes, and" prompt, 7 scene templates)
- UI consistency (theme dedup, animations.css extraction)
- AI Director proactive mode (scene phases, 60s inactivity nudge, DO schedule alarms)
- Scene playback (event recording in DO, public replay endpoint, ReplayViewer, share button)
- Scene gallery (public #gallery route, GET /api/boards/public, gradient thumbnails)
- Perf overlay (FPS, msg age, nodes, connection state)
- Dynamic intent chips
- AI architecture audit (prompt versioning, tool observability, structured logging)
- Defensive AI tool input validation (sanitizeMessages, instrumentExecute guard)
- Smooth drag replay (throttled 100ms WS sends, spatial debounce in DO, RAF lerp interpolation in ReplayViewer)
- Floating toolbar (bottom-center pill, redesigned from left sidebar)
- AI image generation (SDXL via CF Workers AI, base64 data URL storage, Konva Image rendering, generateImage tool)

**Killed (PM eval):** Contextual AI Actions (clustering unreliable on free-tier LLM), Intent Preview (problem overlap with batch undo at 3x cost).

## Roadmap

| Feature | Notes |
|---------|-------|
| Improv game modes | Scenes From a Hat, Yes-And chains - structured replayability |
| Audience/spectator mode | Read-only WS + emoji reactions - improv needs witnesses |
| Mobile-first chat view | Canvas as secondary "stage" - phone users |
| Custom AI characters | Upload personality, share characters |
| Persistent characters across scenes | Continuity creates attachment |
| Daily scene challenges + leaderboard | Brings people back daily |
| ~~AI image generation~~ | **Shipped.** generateImage tool (SDXL 512x512 via CF Workers AI), `image` BoardObject type, base64 in DO SQLite storage, Konva rendering in Board + ReplayViewer |
| Multi-agent improv | Multiple AI characters with distinct personalities improvising against each other on canvas. Humans throw curveballs, AI agents "yes, and" autonomously |
| Narrative/relationship state | Formalize scene state: who hates whom, who's fleeing whom, alliances. AI reads/writes relationship graph to make "yes, and" structural, not just emergent |
| Per-scene token budgets | Natural scene endings via turn/token limits. Improv scenes should end, not run forever. Cost ceiling = dramatic constraint |

## Known Bugs

- AI Director nudge not firing on prod (DO alarm timing or threshold issue)
- Async badges: boards only visible to owner, no cross-user board discovery

## Product Strategy

### The Broken Loop (why sessions evaporate)
```
Open board -> Pick scene -> AI sets stage -> Chat back and forth -> Board fills up -> ...now what?
```
No arc, no ending, no way to share the funny thing that happened, no reason to return. The board is a static graveyard of stickies.

### Three Things That Broke the 1-to-100 Barrier
1. **Scene Playback (viral loop)** - SHIPPED. Every replay is an ad for the product. Turns a transient experience into a shareable artifact. Without it, sessions evaporate. With it, sessions generate content that recruits new players.
2. **Async Improv (kill the "both online" requirement)** - SHIPPED (notifications). Exquisite Corpse but spatial. Alice sets a scene before bed, Bob adds a complication in the morning. Architecture already supports it (DO SQLite chat + DO Storage board state persist across reconnects).
3. **AI as Director (structure, not just performance)** - SHIPPED. Scenes meander without a director creating urgency. AI introduces ticking clocks, complications, scene transitions after inactivity. Dramatic structure: setup -> escalation -> complication -> climax -> callback.

### Emergent Character Creation (coworker demo, Feb 18)
Coworker's prompts: demon face -> unicorn -> GOOSE ATTACKING -> penguin fleeing goose -> horde of mongoose. The AI:
- Named itself ("GLITTER the Improv Demon - I name myself")
- Created characters with personality ("HONK the GOOSE OF CHAOS, hates love, pecking EVERYTHING")
- Built inter-object relationships ("WADDLES - penguin refugee, fleeing the GOOSE OF CHAOS")
- Maintained narrative coherence across prompts (each "yes, and"s the previous)

**Key insight:** The visual medium is the bottleneck, not the AI's creativity. HONK is a circle with dots for eyes but the personality is vivid. Image generation closes that gap. Multi-agent improv (HONK vs WADDLES arguing autonomously) is the natural next step.

---

## Planned Refactors

- ~~**Board.tsx decomposition**~~ Done (1837 -> ~1500 lines). Extracted Toolbar.tsx, useKeyboardShortcuts.ts, useDragSelection.ts. Further reduction possible: BoardObjectRenderer (~100L), EmptyBoardOverlay (~127L), ConnectionToast (~36L).

---

## Open Tech Debt

**File size / DRY candidates (wc -l, sorted):**

| File | Lines | Issue |
|------|-------|-------|
| Board.tsx | 1836 | God component. Toolbar, keyboard shortcuts, drag selection, rendering all inline. Worktree in flight. |
| ai-tools-sdk.ts | 587 | 10 tools with repetitive create patterns. `createAndMutate` helps but each tool still has ~40 lines of boilerplate (schema + execute + error handling). |
| chat-agent.ts | 420 | Mixes concerns: model selection, message sanitization, streaming, director mode, metrics. Could split director into own file. |
| board.ts | 353 | WS message handler is a giant switch. Replay recording + activity tracking interleaved. Manageable for now. |
| ChatPanel.tsx | 348 | Intent chips, message rendering, input handling. Getting close to extraction threshold. |
| ReplayViewer.tsx | 318 | RAF interpolation + playback engine + rendering. Self-contained, OK. |

**Security:**
- No rate limiting on auth + AI endpoints
- AI route accepts arbitrary boardId - can create phantom DOs
- No upper bound on AI chat history
- Username enumeration via signup 409

**React/Konva:**
- `ToolIconBtn` not memoized (8 instances re-render on cursor updates)
- No React error boundary

**UX/Polish:**
- Vite build >500KB chunk - needs code splitting
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close code handling
- Undo stack not cleared on WS reconnect
- No guard against `sendMessage` when ChatAgent WS is disconnected

**Won't Fix (Week 1):**
- `send()` silently drops messages during reconnect window

---

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| Feb 16 | Custom auth over Better Auth | CF Workers bugs in Better Auth 1.4.x |
| Feb 16 | PBKDF2 over argon2 | Web Crypto built-in, zero deps |
| Feb 16 | No CRDTs | DOs serialize writes, LWW by construction |
| Feb 16 | AI priority over more shapes | Gauntlet AI exercise - AI is differentiator |
| Feb 16 | HTML overlay for text editing | Konva doesn't support multiline |
| Feb 16 | Hash routing over React Router | Zero deps, shareable links |
| Feb 17 | DO RPC over fetch routing | Type-safe, TS-checked stubs |
| Feb 17 | Scroll-to-pan, ctrl+scroll-to-zoom | Matches Figma/Miro convention |
| Feb 17 | AI tools: orthogonal over monolithic | One tool = one responsibility for LLM accuracy |
| Feb 17 | GLM-4.7-Flash over Llama 3.3 | 131K context, native multi-turn tool calling, still free |
| Feb 17 | Agents SDK over manual SSE | Server-side persistence, WS streaming, automatic tool loop |
| Feb 17 | Template coord injection over LLM geometry | LLM as content generator, not geometry solver |
| Feb 17 | Overlap score metric over visual QA | Single number for AI layout quality |
| Feb 18 | Hash-based cursor colors over index-based | Deterministic per userId regardless of array order |
| Feb 18 | TTL sweep for ephemeral WS state | Can't rely on explicit cleanup messages |
| Feb 18 | Multiplayer improv canvas as north star | Existing shared chat + canvas needs ~3hrs new code. Nobody has multiplayer + AI + canvas + improv. |
| Feb 18 | No Tailwind (yet) | 118 inline styles across 5 components. Revisit if >15 components. |
| Feb 18 | Worktree DX: auto-load ports in dev.sh | Eliminates un-whitelistable `source worktree.ports` command |
| Feb 18 | Msg age over fake WS latency | DO doesn't echo cursors; measure something honest instead |
| Feb 18 | Prompt versioning in prompts.ts | Correlate behavior changes to prompt versions in logs |

---

## AI Model Pricing

| Model | Input/1M | Output/1M | Tool-use | Notes |
|-------|----------|-----------|----------|-------|
| GLM-4.7-Flash (Workers AI) | Free | Free | Good | 131K context, multi-turn tool calling |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod |

`streamText` with `stopWhen: stepCountIs(5)` limits to 5 LLM round-trips.
