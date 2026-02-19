# Code Mode (CF Agent Pattern)

*Exploration notes - not a deliverable. See [blog post](https://blog.cloudflare.com/code-mode/), [Worker Loader API docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/).*

## What it is

Instead of exposing N discrete tools to the LLM, Code Mode gives it ONE tool: "write TypeScript code." The SDK converts MCP tool schemas into TypeScript type definitions, and the LLM writes executable code that calls them as APIs. The code runs in a V8 isolate sandbox with no network access - it can only call the provided APIs.

## Current approach (11 discrete tools)

```
Human: "Set the scene at a dentist office"
LLM -> tool_call(createFrame, {title: "Dentist Office"})
  -> result: {x: 100, y: 100, width: 400, height: 300}
LLM -> tool_call(createStickyNote, {text: "Dr. Fang - suspiciously pale", x: 110, y: 140})
  -> result: {x: 110, y: 140, width: 200, height: 200}
LLM -> tool_call(createStickyNote, {text: "Garlic mouthwash on the shelf", x: 320, y: 140})
  -> result: {x: 320, y: 140, width: 200, height: 200}
```

Each `->` is a full neural network pass. 3 tool calls = 3 round trips through the model. Our `stopWhen: stepCountIs(5)` exists to cap this cost.

## Code Mode approach

```
Human: "Set the scene at a dentist office"
LLM -> writes TypeScript:
  const frame = await codemode.createFrame({title: "Dentist Office"});
  const s1 = await codemode.createStickyNote({
    text: "Dr. Fang - suspiciously pale",
    x: frame.x + 10, y: frame.y + 40
  });
  const s2 = await codemode.createStickyNote({
    text: "Garlic mouthwash on the shelf",
    x: frame.x + 220, y: frame.y + 40
  });
  console.log({frame, s1, s2});
```

ONE neural network pass. The code executes sequentially in a V8 isolate, results come back via `console.log()`. The LLM can use previous results (frame position) to compute child positions - something that currently requires multiple round trips.

## Why this matters for us

1. **Eliminates round-trip tax**: Our scenes often need 3-5 tool calls (frame + stickies + connectors). That's 3-5 LLM passes at ~200K context tokens each. Code Mode does it in 1 pass.
2. **Better spatial reasoning**: The LLM can compute positions relative to previous objects in code (`frame.x + 10`) instead of guessing or waiting for results.
3. **LLMs are better at code than tool calls**: Tool call tokens are synthetic training constructs. TypeScript appears in millions of repos. The LLM literally writes better tool-calling code than it makes tool calls.
4. **Cost reduction**: Fewer LLM passes = fewer input tokens = cheaper scenes. Could cut per-scene cost by 3-5x.

## Blockers

- **Worker Loader API in closed beta.** Works locally with wrangler, but prod deployment requires beta access. Sign up: https://forms.gle/MoeDxE9wNiqdf8ri9
- **Migration effort**: Need to convert 11 `tool()` definitions into TypeScript API types. The `codemode()` helper from `agents/codemode/ai` handles schema conversion, but our tools have side effects (DO RPC calls) that need to be wired as sandbox bindings.
- **Streaming**: Current `streamText` streams text + tool call deltas to the client. Code Mode returns results after execution. Need to handle the UX of "AI is writing code..." vs current progressive tool call display.

## Implementation sketch

```typescript
import { codemode } from "agents/codemode/ai";

// In onChatMessage:
const { system: codeSystem, tools: codeTools } = codemode({
  system: SYSTEM_PROMPT,
  tools: createSDKTools(boardStub, batchId, this.env.AI),
});

const result = streamText({
  model: this._getModel(),
  system: codeSystem,
  messages: ...,
  tools: codeTools, // single "execute_code" tool
});
```

## Decision

Watch for Worker Loader API GA. Prototype locally when time permits. Don't block on it - our discrete tools work, just less efficiently.
