# Session: text-over-stickies

**Branch:** feat/text-over-stickies
**Date:** 2026-02-20

## What changed

Prompt guidance updated so AI uses `createText` as the default for text content, reserving `createStickyNote` for visual callouts only.

### Files modified
- `src/server/prompts.ts` - PROMPT_VERSION v12 -> v13
- `src/server/ai-tools-sdk.ts` - Tool descriptions updated

### Changes in detail

**prompts.ts:**
- `SYSTEM_PROMPT` TOOL RULES: text vs sticky decision is now explicit. "For dialogue, narration, labels, and descriptions: use createText (DEFAULT). Use createStickyNote ONLY for action words, exclamations, or status callouts..."
- `DIRECTOR_PROMPTS.setup`: "sticky for dialogue/narration" -> "createText for dialogue/narration"
- `DIRECTOR_PROMPTS.escalation`: "RED stickies for dialogue/warnings" -> "createText for dialogue; RED stickies only for visual-pop exclamations"
- `DIRECTOR_PROMPTS.complication`: "Add a sticky" -> "Add createText"
- `INTENT_PROMPTS["What happens next?"]`: stickies -> createText for dialogue/reactions
- `INTENT_PROMPTS["Plot twist!"]`: sticky for revelation -> createText for revelation
- `SCENE_SETUP_PROMPT`: "prop stickies" -> "prop labels via createText"

**ai-tools-sdk.ts:**
- `createStickyNote` description: now explicitly states narrow use case (colored card for action words/exclamations), directs model to createText for general text
- `createText` description: promoted to "DEFAULT for dialogue, narration, labels, descriptions..."

## Rationale

Stickies' colored card background only adds value when the background color itself communicates meaning (urgency, action, status). Using stickies for all text creates visual noise - the canvas looks like an explosion of post-its rather than a composed scene.

## Prompt coverage

All 6 prompt surfaces that previously recommended stickies for dialogue/narration were updated. The `createStickyNote` tool description reinforces the restriction at the tool-selection layer (models see both system prompt and tool descriptions when choosing tools).
