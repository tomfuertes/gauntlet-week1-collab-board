# Prompt Improvement Plan

*From orchestrator session 2026-02-19. Context: multi-provider models shipped, D1 tracing + Langfuse live, Claude Haiku 4.5 as default.*

## Current State

- 12 tools, personas (SPARK/SAGE), game modes (freeform/hat/yesand), scene budgets
- D1 tracing middleware captures every system prompt, tool call, token usage
- Langfuse cloud UI for trace visualization
- Experience is chaotic - AI responses unpredictable, tool usage inconsistent, improv quality varies by model

## Phase 1: See What's Happening (DONE)

- Langfuse traces show exact system prompt, tool calls, and model behavior per exchange
- `npm run traces` gives D1 query access
- Can now answer: "what did the AI actually receive and do?"

## Phase 2: Lock the Model, Baseline the Experience

- Claude Haiku 4.5 as default (shipped) - one model, consistent behavior
- Play 3-5 scenes. In Langfuse, tag good ones and bad ones
- Identify patterns: when does it create random scattered objects vs. coherent scenes?

## Phase 3: Fix the System Prompt (biggest lever)

Current `prompts.ts` has LAYOUT RULES + persona identity + game mode block. Likely issues:

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Random object placement | Layout rules are coordinate-based, not semantic | Add "scene composition" rules: "group related objects, create spatial narrative" |
| AI ignores player input | System prompt is long, player message gets buried | Shorten system prompt, make "yes, and the player's idea" the #1 rule |
| No dramatic arc | Budget phases exist but prompts are generic | Make phase prompts more directive: "setup phase = establish WHO/WHERE/WHAT" |
| Personas feel same | Trait descriptions are long prose | Distill to 1-line behavioral rules: "SPARK always escalates, SAGE always connects" |
| Tool spam | No guidance on when NOT to use tools | Add "only create objects that serve the narrative" |

## Phase 4: Eval Harness + Iteration Loop

- `scripts/prompt-eval.ts` already exists for layout scoring
- Extend it: send the same 5 prompts, score responses on coherence + tool appropriateness
- Change one prompt variable, re-run, compare in Langfuse
- This is the "inner loop" that makes prompt tuning systematic instead of vibes-based

## Phase 5: Model-Specific Tuning (later)

- Once Claude Haiku 4.5 prompts are solid, test on other models (GLM, GPT-4o Mini)
- Different models respond differently to the same prompt
- May need model-specific prompt variants (or just pick the best model)

## UI Improvements (from user feedback)

- Model selector should be accessible from the scene-start dialog (not buried behind header dropdown)
- Character picker at scene start (choose your AI partner)
- Per-player persona assignment: each human player picks an AI agent to improvise with
  - This is an architectural change: currently personas alternate turns, not bound to players
  - Would need: persona-to-player mapping in ChatAgent, per-player system prompts, UI for claiming a persona
  - Complexity: medium-high, needs plan mode

## Key Insight

The single highest-impact change is Phase 3 - rewriting the system prompt to be shorter, more directive, and focused on "yes, and" improv principles rather than layout coordinates. PROMPT_VERSION should bump to v6.
