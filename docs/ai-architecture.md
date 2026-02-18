# AI Architecture

How the AI agent system works in CollabBoard - from user message to canvas mutation.

## Request Lifecycle

```
User types message in ChatPanel
        |
        v
useAIChat.ts (client hook)
  - Wraps useAgentChat from Cloudflare Agents SDK
  - Connects via WebSocket to /agents/ChatAgent/<boardId>
  - Converts UIMessage <-> AIChatMessage for ChatPanel compatibility
  - Sends { messages, body: { username, selectedIds } }
        |
        v
ChatAgent DO (chat-agent.ts)
  - One instance per board (instance name = boardId)
  - AIChatAgent base class (Cloudflare Agents SDK)
  - onChatMessage() handles user messages
  - Builds system prompt (base + selection context + multiplayer attribution)
  - Sets AI presence on board (presence bar indicator)
        |
        v
streamText() / generateText() (Vercel AI SDK v6)
  - Model: Claude Haiku 4.5 (if ANTHROPIC_API_KEY set) or GLM-4.7-Flash (free)
  - System prompt from prompts.ts (versioned)
  - Tool registry from ai-tools-sdk.ts (10 tools)
  - stopWhen: stepCountIs(5) for chat, stepCountIs(3) for director
        |
        v
Tool Execution (ai-tools-sdk.ts)
  - Each tool validates input (Zod schemas)
  - Calls Board DO via RPC (readObjects, readObject, mutate)
  - Returns structured result for LLM chaining (x, y, width, height)
  - Fire-and-forget cursor animation (cursorToCenter)
        |
        v
Board DO RPC (board.ts)
  - readObjects() - returns all objects from DO Storage
  - readObject(id) - returns single object
  - mutate(msg) - validates + persists + broadcasts
        |
        v
WebSocket Broadcast
  - Board DO broadcasts obj:create/update/delete to all connected clients
  - Other clients apply mutations to their canvas
  - Sender already applied optimistically (no echo)
```

## Tool Registry

10 tools defined in `src/server/ai-tools-sdk.ts`, display metadata in `src/shared/ai-tool-meta.ts`.

| # | Tool | Category | RPC Calls | Description |
|---|------|----------|-----------|-------------|
| 1 | createStickyNote | Create | mutate(obj:create) | Sticky note with text + color |
| 2 | createShape | Create | mutate(obj:create) | Rect, circle, or line |
| 3 | createFrame | Create | mutate(obj:create) | Labeled container for grouping |
| 4 | createConnector | Create | readObject x2 + mutate | Arrow/line between two objects |
| 5 | moveObject | Modify | readObject + mutate(obj:update) | Reposition an object |
| 6 | resizeObject | Modify | readObject + mutate(obj:update) | Change dimensions |
| 7 | updateText | Modify | readObject + mutate(obj:update) | Change text/title content |
| 8 | changeColor | Modify | readObject + mutate(obj:update) | Change color/fill |
| 9 | getBoardState | Read | readObjects | Read objects (with filter/summary) |
| 10 | deleteObject | Delete | mutate(obj:delete) | Remove an object |

All create tools share helpers: `randomPos()`, `makeObject()`, `createAndMutate()`. Modify tools use `updateAndMutate()`. Both helpers handle error logging and return structured results.

Objects created in a single `streamText` call share a `batchId` for batch undo.

## Model Selection

```
ChatAgent._getModel():
  ANTHROPIC_API_KEY set? -> Claude Haiku 4.5 (claude-haiku-4-5-20251001)
  else                   -> GLM-4.7-Flash (@cf/zai-org/glm-4.7-flash, free tier)
```

Both models support multi-turn tool calling. Haiku is more reliable at complex tool sequences. GLM-4.7-Flash has 131K context and is free via Workers AI.

## AI Director (Proactive Mode)

The director creates scene complications after player inactivity.

```
User sends message
  -> onChatMessage() resets 60s timer via DO schedule alarm
  -> Timer fires: onDirectorNudge()
     -> Guards: skip if newer timer pending, stream active, or no messages
     -> Compute scene phase from user message count
     -> generateText() with director-augmented system prompt
     -> Build UIMessage manually from result
     -> persistMessages() to broadcast to connected clients
```

### Scene Phase System

Phase is determined by user message count in the conversation:

| Messages | Phase | Director Behavior |
|----------|-------|-------------------|
| 0-2 | Setup | Add establishment details (props, traits, locations) |
| 3-5 | Escalation | Raise stakes, add complications (red stickies) |
| 6-8 | Complication | Subvert existing elements, add twists |
| 9-11 | Climax | Maximum tension, converge all elements, callbacks |
| 12+ | Callback | Full circle, reference earliest scene elements |

## File Map

| File | Role |
|------|------|
| `src/server/prompts.ts` | All prompt content + scene phases + version constant |
| `src/server/chat-agent.ts` | ChatAgent DO - message handling, director mode, metrics |
| `src/server/ai-tools-sdk.ts` | 10 tools + instrumentation wrapper + helpers |
| `src/shared/ai-tool-meta.ts` | Tool display metadata (icons, labels, summaries) |
| `src/client/hooks/useAIChat.ts` | Client hook - WebSocket to ChatAgent, message adaptation |
| `src/client/components/ChatPanel.tsx` | Chat UI - messages, tool results, chips, templates |

## Observability

Structured JSON logs emitted at key points:

| Event | Where | Fields |
|-------|-------|--------|
| `ai:request:start` | onChatMessage, onDirectorNudge | boardId, model, promptVersion, trigger |
| `ai:request:end` | onFinish callback | boardId, model, promptVersion, steps, toolCalls, durationMs |
| `ai:tool` | instrumentExecute wrapper | tool, durationMs, ok, error? |
| `ai:create` | createAndMutate | type, id, x, y, w, h |
| `ai:update:error` | updateAndMutate | id, error |
| `ai:overlap` | getBoardState | score, total |

## Token Budget

getBoardState strips LLM-irrelevant fields (`updatedAt`, `createdBy`, `batchId`, `rotation` when 0) to reduce context noise. On a 15-object board, this saves ~225 tokens per call.

Summary mode activates at 20+ objects, returning counts by type + overlap score instead of full objects.
