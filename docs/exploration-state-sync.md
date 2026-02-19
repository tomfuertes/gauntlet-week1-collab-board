# Agent SDK State Sync (CF Agent Pattern)

*Exploration notes - not a deliverable. See [Agent class docs](https://developers.cloudflare.com/agents/concepts/agent-class/).*

## What it is

Instead of manually managing DO storage + WebSocket broadcasts, the Agent SDK gives you a reactive state primitive that auto-persists and auto-broadcasts.

```typescript
class MyAgent extends Agent<Env, { score: number; phase: string }> {
  initialState = { score: 0, phase: "setup" };

  someMethod() {
    // ONE call does three things:
    this.setState({ ...this.state, score: 42 });
    //   a) Updates in-memory state
    //   b) Persists to DO SQLite (cf_agents_state table)
    //   c) Broadcasts to ALL connected WebSocket clients automatically
  }

  onStateChanged(newState, oldState) {
    // React to changes server-side
  }
}
```

Client side:
```typescript
const [state] = useAgent(agent);
// state.score updates in real-time via WS, no manual handling
```

The SDK sends `{ type: "cf_agent_state", state: {...} }` on every `setState`. The React hook auto-updates.

## What we do instead

Our Board DO manually manages everything:

```
Client mutates object
  -> sends WS { type: "obj:update", obj: {...} }
  -> Board DO webSocketMessage()
  -> DO persists: this.ctx.storage.put(`obj:${id}`, obj)
  -> DO broadcasts to OTHER clients: conn.send(JSON.stringify(msg))
  -> Client applies optimistically (doesn't wait)
```

~30 lines of code per mutation type (create/update/delete) across Board DO + client hooks.

## Why we DON'T switch

The Agent SDK state sync is designed for a **single state object** - the whole state is one JSON blob replaced on every `setState`. Our board has **hundreds of independent objects**.

- **Granularity**: `setState` replaces the entire state. With 500 objects, every sticky move broadcasts all 500 objects to every client (~100KB vs ~200 bytes for our per-object approach).
- **Conflict resolution**: We use LWW per-object via `updatedAt`. Agent SDK is LWW on the entire state blob - two users moving different stickies would race and one edit would be lost.
- **Optimistic updates**: Our client applies mutations instantly. Agent SDK state sync is server-authoritative - client would wait for the broadcast round-trip.

## Where it WOULD fit

Small, shared, infrequently-updated state:
- Current scene theme / mood
- Voting on next prompt
- Turn indicator ("whose turn is it?")
- Board-level settings (game mode already uses per-message body, but a persistent setting would fit)

Our ChatAgent already uses AIChatAgent's built-in message persistence, which is essentially state sync for chat history.

## Decision

Skip. Our manual DO Storage + targeted WS broadcast is the right architecture for canvas objects. The granularity mismatch is fundamental, not incidental.
