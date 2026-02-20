# Quality Exploration Round 1 - Feb 19, 2026

7-agent quality exploration swarm against localhost:8787 (wrangler dev). Each agent played real scenes, collected eval API metrics + D1 traces, and reported structured findings. Future rounds target prod.

## Agents

| Agent | Focus | Model Tested | Exchanges | Boards |
|-------|-------|-------------|-----------|--------|
| first-impression | New user first 60s | GLM + GPT-4o Mini | 1-2 per board | 2 |
| scene-arc | Full scene momentum | GLM 4.7 Flash | 15 | 2 |
| persona-chemistry | SPARK vs SAGE vs custom | GLM 4.7 Flash | 4 per board | 3 |
| game-modes | Hat vs Yes-And vs Freeform | GPT-4o Mini + GLM reactive | 3-6 per mode | 3 |
| visual-storytelling | Canvas spatial coherence | GLM + GPT-4o Mini | 5 + image prompts | 2 |
| cross-model-feel | GLM vs GPT-4o Mini vs Haiku | All 3 | 5 (scripted) | 3 |
| mobile-experience | Mobile-first feel (375x812) | GLM 4.7 Flash | 4 | 1 |

## Critical Findings

### C1: GLM `<think>` and `<tool_call>` XML leaks into chat

Every agent independently confirmed. GLM 4.7 Flash externalizes chain-of-thought in `<think>...</think>` blocks that render verbatim in chat. By exchange 3+, messages contain 1000-3000+ words of circular reasoning. `<tool_call>` XML fragments also leak. Gets worse as context window grows.

- **scene-arc**: 3,000+ word loops by exchange 14, tool call XML visible in sticky note content
- **cross-model**: GLM catastrophically fails by exchange 3 with `[SPARK]` x50 repetition
- **persona-chemistry**: Chinese + English reasoning visible, `Done.</think>[SAGE]` in chat
- **game-modes**: makes all modes indistinguishable noise when reactive persona fires

**Fix**: Strip `<think>...</think>` and `<tool_call>...</tool_call>` blocks from all model responses before building UIMessage. ~10 lines in `chat-agent.ts`.

### C2: Template scene setup fails for all models

Templates embed tool-call pseudocode (`createFrame "Dr. Fang's Dental Clinic" x=50 y=80`) as plain text in user messages. No model reliably executes these as actual tool calls.

- **first-impression**: Expected 7 objects (1 frame + 6 stickies). GLM: 4 objects, no frame. GPT-4o Mini: 3 objects, exact overlaps.
- **visual-storytelling**: Time Travel Cafe: 1-2 objects instead of 7. Models invent new characters not in template.
- **scene-arc**: Inconsistent between identical runs - Board 1 got 11 objects, Board 2 got 3.

**Fix**: Server-side template seeding. When a template is selected, pre-populate board objects via Board DO RPC (bypass chat), then send a "scene is set, react to it" prompt to ChatAgent.

### C3: Default model should be Claude Haiku 4.5

Cross-model agent ran identical 5-exchange Pirate Therapy script on all 3 models:

| Dimension | GLM 4.7 Flash | GPT-4o Mini | Claude Haiku 4.5 |
|-----------|--------------|-------------|-------------------|
| Response time | ~35s | ~20s | **~10-15s** |
| Think-tag leak | YES | YES | **NO** |
| Persona discipline | FAIL | PARTIAL | **PASS** |
| Scene coherence at E5 | CATASTROPHIC | DEGRADED | **EXCELLENT** |
| Out-of-bounds objects | 0 | 10 | **0** |
| Improv callbacks | None | Weak | **Strong** |

Haiku: fastest, cleanest, best persona voices, best improv callbacks, zero artifacts. 1-line change in OnboardModal.

## High Findings

### H1: Reactive persona uses wrong [NAME] prefix

SAGE's reactive responses contain `[SPARK]` tags (and vice versa). GLM reads conversation history saturated with `[SPARK]` prefixes and echoes the dominant tag. The `_buildGenerateTextMessage` check doesn't strip rogue prefixes.

- **persona-chemistry**: SAGE bubble shows `[SPARK] When laser eyes melt the agenda...`
- **visual-storytelling**: SAGE consistently outputs `[SPARK]`, one response switched to `[USERNAME]`

**Fix**: Strip `[OTHERPERSONANAME]` from reactive response text before display. Regex replace in `_buildGenerateTextMessage`.

### H2: Template raw text shown in user chat bubble

When user taps a scene chip, their message bubble shows full raw prompt including `createFrame x=50 y=80 width=900 height=600` and hex color codes. Immersion-breaking, especially on mobile.

- **mobile-experience**: raw coordinates visible as "your" message on chat-first mobile layout

**Fix**: Add `displayText?: string` field to `BoardTemplate`. Show that in chat history instead of raw prompt.

### H3: OnboardModal missing on mobile

Mobile layout path (<=768px) in Board.tsx returns chat-first layout without rendering OnboardModal. No game mode or model selection available on mobile.

- **mobile-experience**: fresh mobile user lands directly in chat view with no framing

**Fix**: Render simplified OnboardModal on mobile, or expose game mode as horizontal chip row.

### H4: "Meanwhile, elsewhere..." creates 0-1 objects

Intent requires 4+ sequential tool calls (`getBoardState` -> evaluate -> `createFrame` -> stickies). Models satisfy chat narrative first and skip/partially execute canvas operations.

- **visual-storytelling**: GLM created 1 sticky instead of frame + stickies. GPT-4o Mini created 0 canvas objects.

**Fix**: Remove `getBoardState` prerequisite, pass explicit coords: "Create frame at x=1200 y=100".

### H5: Scene momentum collapses at Act 3 with GLM

Context window degrades quadratically. By exchange 12-14, conversation history has 15+ exchanges with tool call results + leaked `<think>` content. Model spends generation budget on deliberation not output.

- **scene-arc**: Exchanges 1-8 feel like improv. 12-15: 3,000+ word rambling loops.

**Fix**: (a) Trim `<think>` from history before appending to `this.messages`, (b) reduce `stepCountIs` from 5 to 3 for GLM.

## Medium Findings

### M1: Mobile touch targets below 44px minimum

- Back button: 16px, persona pills: 18px, tool disclosure: 12px, send button: 34px
- Only intent chips correctly hit 44px (`mobileMode` prop applied)

### M2: SPARK color preference ignored

SPARK trait says "Red stickies (#f87171)" but GLM defaults to yellow (#fbbf24). Trait instruction too buried for weak models. SAGE green/blue works correctly.

### M3: Yes-And "Yes, and..." rule followed ~50%

No post-processing enforcement. `_ensurePersonaPrefix` only patches `[NAME]`, not game mode rules.

### M4: Hat "Next prompt" piles objects on existing scene

No spatial reset. `SCENE_SETUP_PROMPT` only fires on `humanTurns <= 1`. Second hat prompt gets no dedicated setup.

### M5: No dispersion rule when no frame exists

Without a frame, all stickies share the same coordinate system and stack at similar positions. Clutter onset at 8-10 objects.

### M6: Eval harness WS upgrade fails (400) on localhost

`routeAgentRequest`/partyserver returns 400 during WS handshake. Likely local wrangler dev issue - needs investigation against prod.

## Intent Chip Reliability (from scene-arc)

| Chip | Canvas Objects Created | Quality |
|------|----------------------|---------|
| "Complicate everything" | 2-3 consistently | Most reliable |
| "Meanwhile, elsewhere..." | 0-1 but sometimes a frame | Best quality when it works |
| "The stakes just got higher" | Modified existing text | Works as designed |
| "A stranger walks in" | 0-1 | Unreliable |
| "Plot twist!" | 0 for 2 attempts | Least reliable |

## What Worked Well

- **Persona voice distinctness is real**: SPARK (punchy, theatrical) vs SAGE (wry, philosophical) are distinguishable when the prefix bug isn't confusing things
- **Image generation is excellent**: Contextually relevant, high quality SDXL outputs. Penguin barista, time capsule jar both thematically perfect
- **Mobile chat-first layout is structurally sound**: Canvas preview strip at 30% viewport works well. The core loop (chat + preview) is right
- **Narrative callbacks exist mid-scene**: "THE TRUTH: WHISKERS IS NOT A CAT" frame, "Bed Bath & Beyond" treasure map callback. The improv DNA works
- **Intent chip rotation logic is correct**: Chips rotate per `getIntentChips`, "Meanwhile" correctly creates parallel scenes
- **Daily Challenge banner on empty BoardList is engaging**: Creative prompt gives immediate context

## Process Learnings

- All agents must use `mode: "bypassPermissions"` (sandbox is safety boundary)
- Target prod for UAT/exploration, localhost only for uncommitted changes
- Eval harness should be a team member, not background task
- Agent bash commands must be simple - no `LATEST=$(ls...)` patterns
- 7 agents was too many for round 1 - 3-4 focused agents with deeper iteration would yield more actionable findings per agent
- Think-tag leakage was the #1 finding from EVERY agent - a pre-flight check would have caught this before deploying the full swarm

## Screenshots

All in `.playwright-cli/` (gitignored):
- `first-impression-04-scene-setup-result.png` - sparse canvas vs expected rich scene
- `scene-arc-critical-bug.png` - tool call XML in sticky note content
- `scene-arc-act3.png` - Act 3 badge appearance
- `persona-chemistry-sage-spark-reactive.png` - `Done.</think>[SAGE]` in chat
- `cross-model-feel-board3-haiku-final.png` - Haiku's clean improv result
- `game-modes-yesand-escalate.png` - reasoning leak during Yes-And
- `mobile-experience-05-ai-complete.png` - raw tool-call text in user bubble
- `visual-storytelling-09-cluttered-state.png` - overlapping images and stickies
