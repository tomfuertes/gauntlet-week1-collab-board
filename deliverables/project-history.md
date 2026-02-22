# YesAInd: Project History

_A day-by-day engineering narrative of building a multiplayer improv canvas with AI agents in one week._

---

## Day 0: The Brief

The assignment: build a production-scale collaborative whiteboard with real-time sync and an AI agent that can manipulate the canvas. Ship in 7 days. Gate for Austin admission.

The twist: this wasn't just a whiteboard project. The spec said "AI-first development methodology" - use coding agents, MCPs, and structured AI workflows throughout. Which meant the AI wasn't just the thing being built; it was the primary tool for building it.

The stack decision came first. A pre-search session mapped out tradeoffs: Firebase vs Supabase vs custom WebSocket vs Cloudflare Durable Objects. The verdict landed on Cloudflare Workers + Durable Objects + D1. The reasoning: DOs are purpose-built for stateful real-time connections - each board gets its own isolated DO instance, which handles WebSocket multiplexing and object persistence in a single edge-collocated process. No separate pub/sub layer, no regional database hop for WS state. The tradeoff was a steeper learning curve on CF primitives, but the architecture fit the problem too cleanly to pass up.

One more early decision: Better Auth looked appealing (full-featured library) but hit a wall immediately on CF Workers. Workers don't support Node.js crypto APIs that Better Auth depends on. The pivot happened on the first commit: custom PBKDF2 auth using the Web Crypto API, with timing-safe comparison and D1 session storage. This pattern - "evaluate, discover the CF Workers constraint, build the minimal right thing" - would repeat throughout the week.

---

## Day 1 (Feb 16): MVP in 24 Hours

**86 commits. 0 to deployed.**

The day started with a `hello world` on CF Workers and ended with a deployed multiplayer whiteboard with auth, sticky notes, shapes, real-time sync, and a working AI agent. The commit timestamps tell the story better than any retrospective.

The first architectural decision after scaffold: WebSocket sync. The temptation is to build object creation first (visible, satisfying) but the spec was explicit - "multiplayer sync is the hardest part, start here." So the first real feature was cursor sync via WebSocket, then object state sync, then persistence. The pattern was vertical: each increment delivered something two browser windows could witness simultaneously.

A critical early bug revealed a subtle DO gotcha. The initial WebSocket cursor sync used an in-memory Map to track connections. When the DO hibernated (CF hibernates DOs during inactivity to save cost), the Map reset and connections lost their cursor state. The fix was `ws.serializeAttachment()` - storing per-connection ephemeral state in the WS attachment, which survives hibernation and is readable in `webSocketClose`. This pattern became load-bearing throughout the project.

Object sync used Last-Write-Wins (LWW) via `updatedAt` timestamps. Not glamorous but correct for the concurrent editing model, and documented as the conflict resolution approach from the start.

By midday, the board had sticky notes (double-click to create, drag to move, inline text edit), rectangle shapes, and real-time sync verified across two browser windows. The AI agent came next: a chat sidebar backed by Cloudflare Workers AI, with tool calls for `createStickyNote`, `createShape`, `createFrame`, and a handful of manipulation commands. The AI could talk to the board.

The end-of-day audit revealed things that still needed work: resize (Konva Transformer with sync), connectors (arrow tool), frames, multi-select, copy/paste, undo/redo. But the MVP gate passed.

---

## Day 2 (Feb 17): AI Grows Up

**~60 commits. The agent learns to improv.**

The shift on Day 2 was conceptual. The whiteboard was a tool; now it became a stage. The framing pivoted from "AI assistant that can draw things" to "improv theater with AI co-performers." This wasn't just product branding - it changed what the AI needed to do. An assistant answers requests. An improv partner says "yes, and."

The Agents SDK migration happened early: the simple chat handler became a full `AIChatAgent` Durable Object, giving the AI persistent conversation state, proper tool execution lifecycle, and a WebSocket connection to the Board DO for canvas mutations. The architecture became: client WS to ChatAgent DO -> `streamText()` with tools -> Board DO RPC -> broadcast to all players.

Two AI personas emerged: SPARK (the energetic scene-starter) and SAGE (the reactive co-performer). SAGE introduced a new pattern: `ctx.waitUntil` fires a second `generateText` call after each response, letting SAGE react to what just happened on canvas without blocking the main response stream. The first exchange was unreliable (timing gap - `waitUntil` fires before the base class adds the new message to `this.messages`), but reliably triggered on the 2nd+ exchange.

Improv mode got a system prompt: the yes-and principle, scene starter templates, and the first version of game mode scaffolding. The AI was instructed to build on what players contributed rather than redirect or reset. Intent chips appeared in the chat panel - pre-baked prompts like "yes, and..." and "add a complication" to guide players toward good improv structure.

The GLM-4.7-Flash model replaced the initial Workers AI default. The AI tools got a full refactor into a DRY registry. A demo script landed. The infrastructure was ready for what came next: making the AI's canvas output not terrible.

---

## Day 3 (Feb 18): The Layout Problem Becomes Visible

**~80 commits. Features pile up; the AI keeps making a mess.**

Day 3 was the most expansive day by feature count. The worktree-based parallel development workflow hit its stride - multiple Claude Code agents working in isolated branches simultaneously, merging via a custom `merge.sh` script. The commit log shows the pattern clearly: `Merge branch 'feat/ai-director'`, `Merge branch 'feat/scene-gallery'`, `Merge branch 'feat/spectator-mode'`, each a self-contained worktree sprint.

Features that shipped: AI Director (proactive scene complications after 60s inactivity), scene playback (event recording in DO Storage, public replay viewer), scene gallery (public browsable grid), spectator mode (read-only live view with emoji reactions), AI image generation (SDXL tool, image BoardObject type), floating toolbar redesign, performance overlay (FPS, WS latency, object count), dynamic intent chips, multiplayer chat attribution, and the first batch undo implementation.

But underneath the feature velocity, a problem was crystallizing. Every time the AI created multiple objects, they landed on top of each other. The AI was specifying x,y coordinates for each object, and its spatial reasoning was simply wrong. A scene with three characters would render as three overlapping figures. A grid layout request would produce overlapping sticky notes at origin. The canvas was becoming visually broken every time the AI touched it.

The first prompt engineering attempt: add concrete layout rules. "Place objects at least 200px apart. Check existing positions before creating." The AI ignored them - or more precisely, it acknowledged them and then placed objects wherever it computed, which was wrong. The eval baseline at this point: 3/10 layout pass, average overlap 3.6.

The key insight that Day 3 eventually produced: **LLMs can't do spatial reasoning.** They don't have a spatial model of the canvas. Telling an LLM "place this 200px right of the existing object" is asking it to do arithmetic on a coordinate system it doesn't track. Prompt rules for layout are soft - they get processed through the same inference that generates narrative text. They can be ignored when the model is focused on something else.

The solution path was clear but not yet built: stop asking the LLM to reason about positions. Move layout to code.

---

## Day 4 (Feb 19): Server-Side Enforcement

**~70 commits. Code takes over what prompts couldn't.**

Day 4 was the architectural turning point of the project.

`enforcedCreate()` landed first: a wrapper around every AI canvas mutation that clamps object positions to canvas bounds (no more objects appearing off-screen at x=-5000) and rejects creates when object count caps are exceeded. The out-of-bounds rate dropped to 0 immediately - not 10% better, 100% better. The constraint moved from "the LLM should..." to "the server enforces."

The overlap problem was harder. The first version of `enforcedCreate()` tried nudging: detect overlap, move the new object by 20px until it clears. The threshold was 0.2 (20% overlap allowed). This helped but didn't solve it - objects were still landing too close, and the nudge step was too small to escape dense regions.

Version 22's zero-tolerance enforcement rewrote the nudge logic: threshold 0 (any overlap = move), nudge step increased to `objectWidth + 16px` (full object-width gap, not a small offset). Lines and connectors exempted (they're supposed to cross things). The overlap score dropped from 3.5 to near-zero.

The game mode restructure came alongside: `hat` (Scenes From a Hat) and `freezetag` were culled. Harold mode was added - structured improv format with Opening, First Beats, Second Beats, and Third Beats phases. The AI uses `humanTurns` to detect which phase the scene is in and coaches accordingly. The theater metaphor deepened.

The eval infrastructure appeared in this period: an LLM-as-judge pipeline scoring AI responses on layout quality, narrative coherence, and tool appropriateness. The harness ran scenarios against the live server and produced JSON reports. The judge model was Haiku (cheap, fast, consistent), scoring the main Haiku performer. This created the eval loop: change prompt or code, run eval, measure delta.

A persistent eval bug had been hiding: the judge was blind to tool calls because `toolCalls[]` wasn't included in the transcript passed to the judge. Fix that, and the scores shifted significantly. The pipeline had been evaluating the wrong thing.

Multi-provider AI models shipped: Anthropic + OpenAI via their respective SDKs, with Workers AI removed (it required wrangler auth even for local dev, added friction). `body.model` was sent per-message rather than stored on the DO instance - because class-level state resets on DO hibernation, any model selection stored as a property would vanish after inactivity. Sending the model on every message made the system hibernation-resilient.

---

## Day 5 (Feb 20): The Auto-Layout Engine

**~80 commits. LLMs stop specifying coordinates entirely.**

The final move on the spatial reasoning problem: strip x,y from the tool schemas completely.

`flowPlace()` - a shelf-packing algorithm inside the `createSDKTools` closure - replaced LLM-specified coordinates. When the AI calls `createPerson("Alice")`, it doesn't specify where Alice goes. `flowPlace()` reads the current board state (lazy-initialized, cached per closure), finds the next available shelf position scanning left-to-right, top-to-bottom with 16px gaps, and places the object there. Frame-aware: objects created after a frame are placed inside it. `drawScene` compositions (complex multi-part scenes) bypass the per-part count cap because the entire composition counts as one create.

The result: AI canvas layout went from visually broken to consistently clean. The LLM's job narrowed to narrative and tool selection. Code handled space.

The Day 5 feature explosion ran on top of this foundation: ambient mood lighting (smooth gradient canvas background transitions), curtain call overlay (confetti burst, star rating on scene end), transient visual effects (sparkle, poof, explosion, highlight - purely client-side Konva animations), Konva tween animations for smooth object movement, Heckler Mode (spectators spend emoji reactions to inject one-liners), scene postcards (shareable canvas snapshot with chat quote overlay), the "Previously On..." recap feature (AI-narrated scene summary on board return), and mobile canvas (pinch-to-zoom, tap-to-create, touch-friendly toolbar).

The audience features deserve their own note. Audience Waves let spectators collectively trigger canvas effects - confetti, shake, glow, wave patterns - with the AI noticing and incorporating them atmospherically. Audience Polls let spectators vote on what should happen next, with results injected into the AI's context. The architecture: spectators connect to the Board DO read-only, poll votes aggregate there, results broadcast to all clients including the ChatAgent DO via an RPC call that triggers the AI's next response.

The crisis/escalation problem also got addressed. When players chose "escalate!" or "plot twist!", the AI was supposed to use effect tools (transient animations) instead of creating more objects. Haiku routinely ignored this. The fix was `CRISIS_KEYWORDS` detection server-side: messages matching crisis patterns get `maxCreates` capped at 2/1 (main/stageManager) instead of 4/3. Prompt rules as suggestions; server caps as enforcement. Same pattern as layout.

Eval score for stakes-escalation: 0/7 before, 6/7 after.

---

## Day 6 (Feb 21): 97% and the Capability Inversion

**~80 commits. Haiku beats Sonnet on the same prompt.**

The final eval push targeted 34/35 (97%) across all scenario categories. The prompt reached v26, then v27. The evaluation infrastructure itself got an audit: `computeOverlapScore` had been double-counting objects inside frames (three persons inside a frame = 3 overlaps, even though they were correctly placed). Fixed to exclude frames and lines from overlap calculation. The eval score correction changed the picture: what looked like "3/10 layout pass" in early integration runs was partly broken judge, not broken layout.

`flowPlace()` got its two-pass fallback. Pass 1: coarse grid scan at object-sized steps. If the board was dense enough that Pass 1 found no clear position, Pass 2: fine-grained fallback scanning below all existing content at `objectWidth/4` step size. The "place at origin" fallback that had been causing overlap=12 on dense scenes was eliminated.

Quality signal shipped: a per-turn Haiku judge scoring yesAnd, characterConsistency, sceneAdvancement, and toolAppropriateness (0-3 each), firing via `ctx.waitUntil` after reactive persona. The scores log to the server for observability. Gated by `QUALITY_SIGNAL_ENABLED` env var, deployed to production but toggleable.

Then the capability inversion finding: Sonnet 4 scored 28/35 (80%) on the same prompt that got Haiku 34/35 (97%). The stakes-escalation category was catastrophic for Sonnet: 1/7 (14%). The explanation, on reflection, made sense. Sonnet's superior reasoning caused elaboration instead of restraint during crisis turns. When the prompt says "plot twist - use effects!", Haiku executes the rule. Sonnet reasons about why a fire scene would be dramatically richer and generates one. The server-side maxCreates cap blocked most of the over-creation, but the eval expected effects-first behavior, which Sonnet's reasoning overrode.

This is a counterintuitive result in LLM product development: **more capable models don't always score higher on constrained tasks.** The prompt was tuned for Haiku's compliance pattern. Sonnet needs a different prompt - model-tier-aware injection with harder constraints for higher-capability models. The fix path is known but not yet built; Haiku remains the tuned default.

The `batchExecute` meta-tool bug class deserves a mention. The tool wraps multiple create calls into one LLM round-trip, which the AI SDK sees as a single tool call. Effect tools (`highlightObject`, `play_sfx`, `askAudience`) must be called directly, not wrapped inside `batchExecute` - because the SDK's `toolCalls[]` only sees the `batchExecute` wrapper, making the inner tools invisible to the judge and to reactive systems that key on tool call types. "NOT inside batchExecute" was load-bearing. When the judge was fixed to expand batchExecute inner tools, the prompt workaround could be removed.

The final eval state: Haiku 34/35 (97%). Complication 7/7, character-intro 7/7, grid 7/7, color 7/7, stakes-escalation 6/7 (86%). The 1 miss in stakes-escalation represents a genuine hard case - "maximum escalation" turns where even the server cap can't fully compensate for what the prompt would ideally accomplish via model behavior.

---

## What Was Built

YesAInd (yesaind.com) is a multiplayer improv canvas where players and AI co-perform scenes together. The stack: React + Vite + react-konva on the client, Cloudflare Workers + Hono + Durable Objects on the server, D1 for persistent state, Anthropic and OpenAI for AI.

The AI architecture uses 19 tools across creation, manipulation, effects, and audience interaction. The system prompt is modular - injected conditionally per message based on game mode, scene phase, and detected intent. Layout is handled entirely by server-side code; the LLM reasons about narrative, not coordinates.

The development methodology was AI-first throughout. Claude Code was the primary coding agent, with parallel worktree agents handling feature branches simultaneously. The eval harness ran continuously to measure prompt quality, not just spot-check. The key workflow insight: AI coding agents are most effective when given isolated, well-scoped tasks with clear acceptance criteria - not "build the app" but "implement spectator mode in this worktree, verify it works in two browsers, commit."

**486 commits. 6 days. One lesson:** Code enforces what prompts suggest.

---

## Key Pivots

| What Changed                                                         | Why                                                                                     | When    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| Better Auth -> custom PBKDF2                                         | CF Workers doesn't support Node.js crypto APIs Better Auth needs                        | Day 1   |
| LLM layout (x,y in tool schema) -> `flowPlace()` server-side packing | LLMs can't do spatial reasoning; soft prompt rules get ignored                          | Day 3-5 |
| Soft prompt rules -> hard server-side caps                           | Haiku treats "ONLY N objects" as a suggestion, not a constraint                         | Day 4   |
| hat/freezetag game modes -> Harold improv                            | Harold maps to actual improv pedagogy; phase coaching via turn tracking                 | Day 4   |
| Workers AI -> Anthropic + OpenAI only                                | Workers AI required CF auth even for local dev; adding friction with no quality benefit | Day 4   |
| Eval judge (prompt-only) -> judge + board object delta               | Judge was blind to tools inside `batchExecute`; board delta captures ground truth       | Day 6   |
| Sonnet as default model -> Haiku as tuned default                    | Capability inversion: Sonnet scores 80% vs Haiku 97% on constrained improv task         | Day 6   |
