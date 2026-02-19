# Batch Tool - Poor Man's Code Mode

*Exploration notes - not a deliverable. Idea: mimic Code Mode's "run multiple ops in one LLM step" without the V8 isolate.*

## Problem

Each tool call is a full neural network round trip. A scene setup (frame + 3 stickies) = 4 tool calls = 4 LLM passes at ~200K context tokens each. Our `stopWhen: stepCountIs(5)` exists to cap this cost.

## Idea

Create a `batchExecute` tool that accepts an ordered array of operations and runs them sequentially in one LLM step. The LLM calls ONE tool instead of N.

### Before (4 round trips)

```
LLM -> tool_call(createFrame, {title: "Dentist Office"})        -> result -> LLM
LLM -> tool_call(createStickyNote, {text: "Dr. Fang"})          -> result -> LLM
LLM -> tool_call(createStickyNote, {text: "Garlic mouthwash"})  -> result -> LLM
LLM -> tool_call(createStickyNote, {text: "Chair of doom"})     -> result -> LLM
```

### After (1 round trip)

```
LLM -> tool_call(batchExecute, {
  operations: [
    { tool: "createFrame", args: { title: "Dentist Office", x: 100, y: 100 } },
    { tool: "createStickyNote", args: { text: "Dr. Fang", x: 110, y: 140 } },
    { tool: "createStickyNote", args: { text: "Garlic mouthwash", x: 320, y: 140 } },
    { tool: "createStickyNote", args: { text: "Chair of doom", x: 110, y: 350 } },
  ]
}) -> results[] -> LLM
```

## Implementation sketch

```typescript
// In ai-tools-sdk.ts, add as tool #12:
batchExecute: tool({
  description:
    "Execute multiple canvas operations in a single call. Use this when you need to " +
    "create related objects together (e.g. a frame with stickies inside it, or a row of shapes). " +
    "Operations run in order. Each operation's result is available in the results array.",
  inputSchema: z.object({
    operations: z.array(z.object({
      tool: z.enum([
        "createStickyNote", "createShape", "createFrame", "createConnector",
        "moveObject", "resizeObject", "updateText", "changeColor",
        "deleteObject", "generateImage",
      ]).describe("Tool name to execute"),
      args: z.record(z.unknown()).describe("Arguments for the tool (same as calling it directly)"),
    })).describe("Ordered list of operations to execute sequentially"),
  }),
  execute: instrumentExecute("batchExecute", async ({ operations }) => {
    const results = [];
    for (const op of operations) {
      const toolFn = toolRegistry[op.tool];
      if (!toolFn) {
        results.push({ error: `Unknown tool: ${op.tool}` });
        continue;
      }
      try {
        const result = await toolFn.execute(op.args);
        results.push(result);
      } catch (err) {
        results.push({ error: `${op.tool} failed: ${err.message}` });
      }
    }
    return { completed: results.length, results };
  }),
}),
```

The `toolRegistry` would be a map of tool name -> execute function, built from the same `createSDKTools` return value.

## Tradeoffs vs Code Mode

| | Batch tool | Code Mode |
|---|---|---|
| **Chaining** | No - LLM can't use result of op[0] in op[1]'s args (positions must be pre-computed) | Yes - code references previous results naturally |
| **Conditional logic** | No - all ops run unconditionally | Yes - `if/else` in generated code |
| **Error handling** | Partial - continues on failure, returns error per op | Full - try/catch in generated code |
| **Schema validation** | Weak - `z.record(z.unknown())` loses per-tool Zod schemas | Strong - TypeScript types from schema |
| **LLM familiarity** | Medium - JSON arrays are common in training data | High - TypeScript is extremely common |
| **Infra requirement** | None - pure tool definition | Worker Loader API (closed beta) |

## Key limitation

The LLM can't reference previous results. In Code Mode you'd write:
```typescript
const frame = await createFrame({title: "Office"});
const s1 = await createStickyNote({x: frame.x + 10, y: frame.y + 40, ...});
```

With batch tool, the LLM must pre-compute all positions:
```json
[
  { "tool": "createFrame", "args": { "x": 100, "y": 100 } },
  { "tool": "createStickyNote", "args": { "x": 110, "y": 140 } }
]
```

This is workable because our LAYOUT RULES in the system prompt already give grid slot coordinates. The LLM is already pre-computing positions for discrete tool calls.

## Prompt addition

Add to SYSTEM_PROMPT TOOL RULES section:
```
- When creating 2+ objects together (scene setup, adding complications), prefer batchExecute
  over individual tool calls. It's faster and keeps related objects in one action.
- You can still use individual tools for single operations or when you need to read board
  state between operations (getBoardState -> then act on results).
```

## Verdict

Quick win. Doesn't solve the chaining problem but eliminates the round-trip tax for the most common case (creating multiple objects). Low risk, easy to implement, backwards compatible (existing tools still work). Could cut scene setup from 4-5 LLM passes to 1-2.
