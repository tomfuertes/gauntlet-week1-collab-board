# Complex Shape Composition - Session Report

Branch: `feat/complex-shapes` | Prompt: v7 -> v11 | Date: 2026-02-20

## Problem

The v6 prompt refactor trimmed the system prompt by 72% and moved composition instructions to a first-exchange-only module. The base prompt actively steered toward stickies: "Create stickies for new characters, props, set pieces." Result: AI created sticky notes with text descriptions instead of composing multi-shape characters.

## Solution: Tool-Centric Architecture

Instead of a bigger prompt, we built better tools. LLMs select tools based on tool descriptions (read every call), not system prompt essays (fade after exchange 1).

### New Tools

**`drawScene`** - Composes 2-10 shapes in a bounding box using proportional coordinates (0-1). The AI thinks "eyes near the top (relY=0.2), body in the middle (relY=0.65)" and the server converts to pixels. Sidesteps LLMs' weakness with spatial math. Each composition gets its own batchId for granular undo.

**`createText`** - Creates small text labels (the `text` board object type existed but had no creation tool). Replaces 200x200 stickies for labels.

### Prompt Iterations

| Version | Change | Signal |
|---------|--------|--------|
| v8 | Tools + minimal prompt rewording (1 bullet) | Haiku: PASS. GLM: messy. |
| v9 | drawScene as FIRST tool rule. Director/intent updates. | GLM fixed. 2nd-exchange persistence confirmed. |
| v10 | All intent prompts aligned with drawScene-first. | "What happens next?" = 3 batch ops. "Complicate everything" = 4 batch ops. |
| v11 | Hat wrapup fix. SCENE_SETUP_PROMPT deduped (-50 tokens). | Polish. |

### UAT Results (3 agents, 2 models)

| Scenario | Haiku 4.5 | GLM-4.7-Flash |
|----------|-----------|---------------|
| Direct "draw a X" | PASS | PASS (v9+) |
| Scene setup (1st exchange) | PASS | - |
| 2nd exchange persistence | PASS | - |
| "What happens next?" intent | PASS (v10) | - |
| "Complicate everything" intent | PASS (v10) | - |

## Key Decisions

- **Proportional coords over absolute**: AI thinks in 0-1 fractions, server multiplies. Avoids LLM spatial math weakness.
- **Per-composition batchId**: Each drawScene generates its own UUID. Undo removes one character, not the whole AI turn.
- **First-rule positioning**: Moving "use drawScene" to the first TOOL RULE fixed GLM. Smaller models weight earlier rules more heavily.
- **Tool description teaches the pattern**: Snowman example in drawScene's description string, not in system prompt.

## Files Changed

| File | Lines | What |
|------|-------|------|
| `src/server/ai-tools-sdk.ts` | +114 | drawScene + createText tools, batchExecute enum |
| `src/server/prompts.ts` | +14/-21 | v11 prompt: all phases/intents aligned with drawScene |
| `src/client/components/ChatPanel.tsx` | +4 | Tool display metadata (icons/labels) |

## Learnings

- `ToolName` type auto-derives from `createSDKTools` return. Adding tools propagates everywhere via `Record<ToolName, string>` - ChatPanel icon/label maps must be updated.
- Batch op count is a clean quality signal: 4 ops = full scene, 2-3 = targeted additions, 0 = chat-only.
- GLM-4.7-Flash can use complex tool schemas when the tool rule is positioned first in the system prompt.
