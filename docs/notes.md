# Notes

*What's in-flight. Not architecture (that's CLAUDE.md), not history (that's git log).*

## Loose Ends

- [cloudflare/ai#404](https://github.com/cloudflare/ai/issues/404): `workers-ai-provider` drops `tool_choice`. Shim in place.
- Eval harness WS 400 on localhost. Workaround: test against prod.
- Daily challenge leaderboard empty - feature works, zero usage. Not a bug.

## Unshipped (specs done, ready to implement)

| Feature | Priority | Notes |
|---------|----------|-------|
| Animation Phase 1: smooth movement | High | `duration` on moveObject, Konva `node.to()` tweens. Task #13. |
| Animation Phase 2: transient effects | High | `obj:transient` WS msg, createEffect tool. Task #14. |
| Animation Phase 3: choreography | Medium | `choreograph` tool (punch/enter/exit). Blocked by P1+P2. Task #15. |
| Improv scene lifecycle | Medium | Tag-out/tap-out, bench/stage, multi-scene arc. |

## Shipped

| Feature | Notes |
|---------|-------|
| Audience row at bottom of stage | Spectator silhouettes from `spectatorCount`. |
| Narrative/relationship state | Who-hates-whom graph, multi-agent memory. |
| Per-player persona assignment | Each human player picks an AI agent to improvise with. |

## Tech Debt

- Circles have no resize handles
- ChatAgent error handling: tool failures swallowed, LLM unaware of partial success

## Resolved Tech Debt

- Phantom DO guard (AI route now validates boardId)
- Chat history cap (`maxPersistedMessages` implemented)
- WS reconnect max retry (backoff + max attempts configured)
