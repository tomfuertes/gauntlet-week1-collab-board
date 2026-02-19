# Agent SDK Task Queues (CF Agent Pattern)

*Exploration notes - not a deliverable. See [Agent class docs](https://developers.cloudflare.com/agents/concepts/agent-class/).*

## What it is

A built-in reliable async work system inside your Durable Object. A mini job queue that lives alongside your agent, persisted to DO SQLite (`cf_agents_queues` table).

```typescript
class MyAgent extends Agent<Env, State> {
  async onChatMessage(onFinish) {
    // Enqueue work - persisted, survives hibernation
    await this.queue("processImage", { url: "https://...", boardId: "abc" });
    return streamText({ ... }); // return immediately
  }

  // Runs when task dequeues. Throws = auto-retry. Succeeds = auto-delete.
  async processImage(payload: { url: string; boardId: string }) {
    const result = await fetchAndResize(payload.url);
    await this.env.R2.put(`images/${payload.boardId}`, result);
  }
}
```

## What we do instead: `ctx.waitUntil()`

```typescript
// Reactive persona
this.ctx.waitUntil(
  this._triggerReactivePersona(activeIndex, personas).catch((err) => {
    console.error(...); // log and swallow
  })
);

// Activity recording
this.ctx.waitUntil(
  recordBoardActivity(this.env.DB, this.name).catch(...)
);
```

## Comparison

| | `ctx.waitUntil()` | `this.queue()` |
|---|---|---|
| **Persistence** | In-memory. DO eviction = work lost. | SQLite. Survives hibernation + eviction. |
| **Retry** | None. `.catch()` swallows errors. | Auto-retry on failure until success. |
| **Ordering** | Fire-and-forget, no guarantees. | FIFO within the DO. |
| **Backpressure** | None. All run concurrently. | Sequential dequeue, one at a time. |
| **Visibility** | Invisible. Can't inspect pending work. | Queryable. List/cancel pending tasks. |

## Why we don't switch

Our `ctx.waitUntil` use cases are best-effort:

- **Reactive persona**: Failure = one fewer AI response. Not critical. Retry would be weird UX (delayed duplicate).
- **Activity recording**: D1 "last active" timestamp. Failure = board doesn't show as recently active. No harm.
- **Presence cleanup**: AI presence dot. Disappears on next heartbeat anyway.

Task queues add reliability we don't need and sequential ordering we don't want (reactive persona should fire ASAP, not wait behind queued work).

## Where it WOULD fit

Features with external side effects users would notice missing:
- Scene export to PDF/image (expensive, must complete)
- Email notifications ("your board had activity")
- AI-generated scene summaries (persist to D1 for gallery)
- Billing/usage tracking (must not lose records)

Mental model: `ctx.waitUntil` = "do this if you can, I don't care if it fails." `this.queue()` = "do this eventually, don't stop trying until it works."

## Decision

Low priority. Our async work is all best-effort. Revisit if we add features requiring guaranteed completion.
