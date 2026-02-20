# Session: template-overhaul

**Date:** 2026-02-19
**Branch:** feat/template-overhaul
**Issues:** #31 (server-side template seeding), #34 (displayText for templates)

## What Was Done

### Problem
Templates embedded tool-call pseudocode as plain text in user messages. No model reliably executed these as actual tool calls - models produced 1-4 objects instead of the expected 7. The chat bubble also showed raw pseudocode instead of friendly text.

### Solution
1. **Rewrote `src/shared/board-templates.ts`** - Added `id`, `displayText`, `description`, and typed `objects: Omit<BoardObject, "id" | "createdBy" | "updatedAt">[]` to `BoardTemplate`. Created `sticky()` and `frame()` helpers. Converted all 7 templates from pseudocode to typed arrays. Added `getTemplateById()` lookup.

2. **Modified `src/server/chat-agent.ts`** - Server-side template seeding: when `body.templateId` is present, looks up template, seeds all objects via Board DO `mutate()` RPC with shared `batchId`, rewrites user message to `displayText`, injects `SCENE ALREADY SET` into system prompt (instead of `SCENE_SETUP_PROMPT`) so AI reacts to existing scene without recreating objects. Wrapped seed loop in try/catch (PR review fix).

3. **Modified `src/client/components/ChatPanel.tsx`** - Added `initialTemplateId` prop, `pendingTemplateId` one-shot state (mirrors `pendingIntent` pattern). Template chips now use `setPendingTemplateId(t.id)` instead of `sendMessage(t.prompt)`. Body includes `templateId` field.

4. **Modified `src/client/components/OnboardModal.tsx`** - Updated `onSubmit` to pass optional `templateId`. Template chips pass `chip.id` and `chip.displayText`.

5. **Modified `src/client/components/Board.tsx`** - Added `chatInitialTemplateId` state, threaded through OnboardModal -> ChatPanel for both desktop and mobile.

## Key Decisions
- **Server-side seeding over AI tool calls** (KEY-DECISION in chat-agent.ts): Guarantees exactly 7 objects regardless of model capability. Removes the unreliable pseudocode-to-tool-call path entirely.
- **Reuse `pendingIntent` one-shot pattern**: Consistent with existing codebase patterns for ephemeral body fields.
- **`batchId` grouping on seeded objects**: Enables batch undo of all template objects as a single action.

## UAT Results (session 2 - context continuation)
- 7 objects created on canvas via Board DO RPC (PASS) - verified via PerfOverlay Objects counter
- Chat shows "Set the scene: Vampire Dentist" not pseudocode (PASS)
- AI responds narratively: "The vampire dentist's office just got a makeover!" (PASS)
- Intent chips enabled after AI response completes (PASS)
- AI Assistant avatar appears in header presence (PASS)
- Connection stable at 60 FPS throughout (PASS)
- PR review issues all fixed: hoisted boardStub, consistent keys, accurate JSDoc
- All checks pass: tsc, eslint, prettier

## Tech Debt
- Template seed loop is sequential (`await` per object). Could batch via a single RPC call if Board DO supported it.
- Template objects are hardcoded positions - no responsive layout adaptation for different screen sizes.
