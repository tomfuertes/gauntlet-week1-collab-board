# Prompt Tuning & Eval Architecture

## Prompt Assembly Pipeline

All prompt content lives in `src/server/prompts.ts`. The system prompt is assembled per-message from a base constant plus conditional injections.

**PROMPT_VERSION** (`v17` currently) is exported as a string constant, logged with every AI request, and stamped into every eval report for correlation. Bump it on every content change.

### Base + Conditional Blocks

| Block | Constant/Function | When injected |
|---|---|---|
| Core improv rules, layout rules, tool rules | `SYSTEM_PROMPT` | Every message |
| Persona identity + partner block | `buildPersonaSystemPrompt()` | Every message (persona claimed or round-robin) |
| Game mode rules (hat/yesand/freezetag) | `buildGameModePromptBlock()` | When `gameMode != "freeform"` |
| Character relationship web | `buildRelationshipBlock()` | When relationships exist |
| Scene lifecycle phase guidance | `buildLifecycleBlock()` | Every message (establish->curtain) |
| Budget phase warning (act3/finale/bow) | `BUDGET_PROMPTS[phase]` | When `humanTurns >= 60%` of budget |
| Scene setup (first exchange) | `SCENE_SETUP_PROMPT` | `humanTurns <= 1` |
| Intent chip | `INTENT_PROMPTS[intent]` | When client sends `body.intent` |
| Momentum nudge | `MOMENTUM_PROMPT` | `humanTurns >= 3` and `budgetPhase === "normal"` |
| Director note | `buildDirectorNotePrompt()` | Message starts with `note:` |
| Canvas reaction | `buildCanvasReactionPrompt()` | Player made canvas mutations since last AI turn |
| Plot twist | `buildPlotTwistPrompt()` | `[PLOT TWIST]` button clicked |
| Tag-out | `buildTagOutPrompt()` | Player switches persona mid-scene |
| Heckle | `buildHecklePrompt()` | Audience heckles buffered since last AI response |
| Audience wave | `buildWavePrompt()` | 3+ spectators same emoji within 5s |
| SFX reaction | `buildSfxReactionPrompt()` | Player triggered sound effect |
| Poll result | `buildPollResultPrompt()` | Audience poll concluded |
| QA command | `buildQACommandPrompt()` | Message starts with `qa:` |

### The 5 AI Call Types

1. **Chat streaming** - main `onChatMessage` path, `streamText()` with all 19 tools, full prompt assembly above
2. **Reactive persona (SAGE)** - fires via `ctx.waitUntil` after each response; separate `generateText()` call with stripped-down prompt; first exchange unreliable (timing gap)
3. **Director nudge** - proactive scene push from `DIRECTOR_PROMPTS[phase]` or mode-specific variants; fires between player turns
4. **Canvas reaction** - triggered when player mutates canvas; injects `buildCanvasReactionPrompt()`
5. **Stage Manager pre-flight** - synchronous `streamText()` before first exchange; uses `STAGE_MANAGER_PROMPT`; sets backdrop image + characters before players see the scene

---

## Eval Pipeline

### Tier 1: Playground (not yet built)

- Planned as a ~50-line script
- Imports `prompts.ts` directly, calls AI SDK, no server or board state needed
- Target: 2-3s per call for rapid prompt variation testing
- Use case: iterate on a single prompt block in isolation before committing

### Tier 2: Full Eval Harness

**Start server first:** `npm run dev` then `npm run health`

```bash
npm run eval               # layout + narrative (all scenarios)
npm run eval:layout        # layout only (EVAL_SKIP_NARRATIVE=1)
npm run eval:narrative     # narrative only (EVAL_SKIP_LAYOUT=1)
npm run eval:compare <a.json> <b.json>   # delta table, exit 1 on regression

# Env overrides
EVAL_USERNAME / EVAL_PASSWORD   # auth (default: eval/eval1234)
EVAL_MODEL                      # AI model under test (default: glm-4.7-flash)
EVAL_JUDGE_MODEL                # judge model (default: claude-sonnet-4)
EVAL_SKIP_JUDGE=1               # skip LLM judge, transcript only
EVAL_SKIP_LAYOUT=1 / EVAL_SKIP_NARRATIVE=1
```

Reports written to `scripts/eval-results/<timestamp>.json` (tracked in git for scoring history, schema `eval-report-v2`).

#### Layout Scenarios (objective, `scenarios.json`)

Single-turn prompts scored on canvas metrics from `GET /api/boards/:id/objects`:

| Metric | Pass condition |
|---|---|
| `overlapScore` | must be 0 |
| `outOfBounds` | must be 0 |
| `objectCount` | >= `expectedMinObjects` |
| `typesMatch` | expected object types present (multiset subset) |

10 layout scenarios: `scene-setup`, `row-layout`, `complication`, `image-gen`, `grid-2x2`, `connector-link`, `color-variety`, `mixed-types`, `character-intro`, `stakes-escalation`

#### Narrative Scenarios (LLM judge, `narrative-scenarios.json`)

Multi-turn conversations scored by `judge-rubric.ts` via Anthropic API directly. 5 scenarios:

| Scenario ID | Description | Primary Dimensions |
|---|---|---|
| `scene-arc-dentist` | Full dramatic arc: vampire dentist with escalation and Van Helsing callback | yes_and_quality, dramatic_arc, audience_engagement |
| `character-consistency` | SPARK voice stability across tonal shifts (director note mid-scene) | character_voice, yes_and_quality |
| `tool-narrative-sync` | Canvas objects serve the narrative vs filler (includes "meanwhile" intent) | tool_usage, audience_engagement |
| `yesand-chain` | Yes-And Chain mode: escalation discipline, beat-by-beat building | yes_and_quality, dramatic_arc, character_voice |
| `audience-engagement-cold` | Cold open with vague prompt - bold choices from nothing (2 turns) | audience_engagement, tool_usage, dramatic_arc |

Each scenario: multi-turn WS session via ChatAgent, transcript collected, then `judgeTranscript()` called with Anthropic SDK. Layout metrics also captured at scenario end.

#### Comparison Tool

```bash
npx tsx scripts/prompt-compare.ts scripts/eval-results/A.json scripts/eval-results/B.json
```

- Delta table: per-scenario per-dimension score change
- Regression flag: narrative dimension drop >= 1.0, or layout pass->fail
- Exit code 1 if any regression (CI-gatable)
- Handles both v1 (layout-only) and v2 (combined) report schemas

### Tier 3: Langfuse Production Monitoring

Already wired in `src/server/tracing-middleware.ts`. Every AI call (chat stream, reactive, director) is traced with full I/O. Eval harness also pushes scores to Langfuse when `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` are set.

**Missing:** per-turn runtime quality signal (task #159). Currently traces capture latency and token counts but no quality scores from production traffic.

---

## Judge Rubric (5 Dimensions)

| Dimension | What it measures | Prompt section to tune |
|---|---|---|
| `yes_and_quality` | Does AI build on player offers without blocking or negating? | `YOUR IMPROV RULES` in `SYSTEM_PROMPT`; `INTENT_PROMPTS` |
| `character_voice` | Is the persona distinct and consistent, or generic assistant-speak? | `buildPersonaSystemPrompt()` - `[CHARACTER IDENTITY]` block; `DEFAULT_PERSONAS` in `shared/types.ts` |
| `dramatic_arc` | Does the scene build, escalate, and resolve? | `buildLifecycleBlock()`, `DIRECTOR_PROMPTS`, `BUDGET_PROMPTS`, `MOMENTUM_PROMPT` |
| `tool_usage` | Do canvas tools serve the narrative or just fill space? | `TOOL RULES` in `SYSTEM_PROMPT`; `LAYOUT RULES`; `SCENE_SETUP_PROMPT` |
| `audience_engagement` | Would spectators be entertained - humor, surprise, resonance? | `YOUR PERFORMANCE` in `SYSTEM_PROMPT`; `INTENT_PROMPTS`; `PLOT_TWISTS` pool |

Scoring: 1-5 per dimension, averaged to `overallScore` (1 decimal). Judge model: `claude-sonnet-4` by default. Few-shot examples are embedded in `JUDGE_PROMPT` in `judge-rubric.ts`.

---

## Scenarios -> Prompt Section Mapping

| Scenario | What it tests | Tune here if scores are low |
|---|---|---|
| `scene-arc-dentist` | Full arc from setup to callback; "yes, and" each offer | `LIFECYCLE_GUIDANCE`, `BUDGET_PROMPTS`, `buildPlotTwistPrompt()` |
| `character-consistency` | SPARK persona stays in voice under tonal pressure | `[CHARACTER IDENTITY]` block in `buildPersonaSystemPrompt()`, `DEFAULT_PERSONAS.spark.trait` |
| `tool-narrative-sync` | Objects placed with dramatic intent, not mechanically | `TOOL RULES`, `LAYOUT RULES`, `INTENT_PROMPTS["Meanwhile, elsewhere..."]` |
| `yesand-chain` | Yes-And Chain mode rules followed, escalation controlled | `buildGameModePromptBlock("yesand", ...)`, `DIRECTOR_PROMPTS_YESAND` |
| `audience-engagement-cold` | Bold specific choices from a vague prompt | `YOUR PERFORMANCE` (no preambles), `SYSTEM_PROMPT` opening improv rules |

Layout scenarios: overlap/bounds failures -> tune `LAYOUT RULES` (default sizes, frame insets, dispersion rule). Object count failures -> tune `SCENE_SETUP_PROMPT` or relevant `INTENT_PROMPTS` entry.

---

## Tuning Workflow

1. Edit `src/server/prompts.ts` - target the specific section mapped above
2. Bump `PROMPT_VERSION` (e.g. `v17` -> `v18`)
3. *(When Tier 1 playground exists)* Run playground for 2-3s iteration on that block in isolation
4. `npm run dev && npm run health` - start server
5. `npm run eval` - full run, saves report to `scripts/eval-results/<timestamp>.json`
6. `npm run eval:compare <baseline.json> <new.json>` - check delta, verify no regressions
7. If overall scores improve and no regressions: commit + `git push` (auto-deploys)
8. If regression: revert the section, re-tune, repeat from step 1

**Baseline:** Keep a known-good report in `scripts/eval-results/` named `baseline-<version>.json` for long-term comparison. All eval results are now tracked in git for scoring history across prompt versions.

---

## What the Eval Does NOT Test

- **Director nudges** - proactive AI-initiated turns between player messages; no harness for inter-turn timing
- **Canvas reactions** - triggered by WS `obj:create/update/delete` events; harness sends only chat messages
- **Reactive persona (SAGE)** - fires via `ctx.waitUntil`, unreliable on first exchange; 30-40s GLM latency makes harness impractical
- **Multiplayer sync** - two players building together; eval uses one WS connection per scenario
- **Audience interactions** - heckles, waves, polls require spectator WS connections and timing coordination
- **Stage Manager pre-flight** - runs before first exchange; not captured in narrative transcript
- **Game mode mechanics** - freeze tag, hat prompt cycling; scenarios.json only covers freeform and yesand

---

## Model Scope for Tuning

**Primary targets** (best instruction-following, most users):
- `claude-haiku-4-5` - default model, highest traffic
- `claude-sonnet-4` (or `claude-sonnet-4-5`) - power users
- `gpt-4o-mini` - OpenAI path

**Lower priority:**
- `glm-4.7-flash` - eval default (fast/cheap for iteration), degrades by exchange 3+
- Workers AI models - available but weakest instruction adherence

`EVAL_MODEL` env var overrides the model under test. The judge model (`EVAL_JUDGE_MODEL`) is separate - always use a strong model (Sonnet or better) for judging regardless of what's being tested.
