# Tool Approval Gates (CF Agent Pattern)

*Exploration notes - not a deliverable. See [Agents starter](https://github.com/cloudflare/agents-starter).*

## What it is

AI SDK tools can have a `needsApproval` function that pauses execution until a human approves. The LLM decides to call the tool, but the call is held until the user clicks "approve" in the UI.

```typescript
deleteObject: tool({
  description: "Delete an object from the whiteboard",
  inputSchema: z.object({ id: z.string() }),
  // Gate: require human approval before deleting
  needsApproval: async ({ id }) => {
    // Could add logic: only gate if object was created by another user
    return true;
  },
  execute: async ({ id }) => {
    await stub.mutate({ type: "obj:delete", id });
    return { deleted: id };
  },
}),
```

On the client, `useAgentChat` exposes pending tool calls via `onToolCall`:
```typescript
const { messages } = useAgentChat({
  agent,
  onToolCall: async ({ toolCall }) => {
    // Show approval UI, return result or rejection
    const approved = await showConfirmDialog(`Delete ${toolCall.args.id}?`);
    if (!approved) return { error: "User rejected deletion" };
  },
});
```

## What we do instead

All 11 tools auto-execute. The AI creates, moves, deletes, and recolors objects without asking. This is intentional for improv - the AI is a scene partner, not an assistant requesting permission.

## Where it could help

- **deleteObject**: AI occasionally deletes objects other players created. Gating this behind "OK to delete [sticky text]?" would prevent frustration.
- **Bulk operations**: If the AI decides to "clear the board" or reorganize everything, an approval gate would let users veto destructive changes.
- **generateImage**: Takes several seconds and consumes SDXL credits. Approval gate = "Generate image: 'gothic dentist office'? This uses AI credits."

## Where it would hurt

- **Scene momentum**: Improv lives on speed. Every approval dialog breaks flow. "Yes, and..." becomes "Yes, and... [approve] [approve] [approve]..."
- **Reactive persona**: The autonomous persona exchange would stall waiting for approval on every tool call.
- **Director nudges**: The AI director fires after 60s inactivity. Requiring approval defeats the purpose of proactive nudging.

## Possible middle ground

Gate only destructive tools, skip approval for creates:
```typescript
needsApproval: async ({ id }) => {
  const obj = await stub.readObject(id);
  // Only gate if deleting someone else's work
  return obj?.createdBy !== AI_USER_ID;
}
```

## Decision

Nice-to-have. Could gate `deleteObject` for non-AI-created objects. Low priority - improv flow matters more than safety rails for a creative tool.
