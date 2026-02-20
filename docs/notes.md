# Notes

*What's in-flight. Not architecture (that's CLAUDE.md), not history (that's git log).*

## Loose Ends

- [cloudflare/ai#404](https://github.com/cloudflare/ai/issues/404): `workers-ai-provider` drops `tool_choice`. Shim in place.
- Eval harness WS 400 on localhost. Workaround: test against prod.
- Person toolbar click-to-place not wired (needs name prompt dialog). AI creates via chat tool.
- Daily challenge leaderboard empty - feature works, zero usage. Not a bug.

## Unshipped (specs done, ready to implement)

| Feature | Priority | Notes |
|---------|----------|-------|
| Animation Phase 1: smooth movement | High | `duration` on moveObject, Konva `node.to()` tweens. Task #13. |
| Animation Phase 2: transient effects | High | `obj:transient` WS msg, createEffect tool. Task #14. |
| Animation Phase 3: choreography | Medium | `choreograph` tool (punch/enter/exit). Blocked by P1+P2. Task #15. |
| Audience row at bottom of stage | Medium | Spectator silhouettes from `spectatorCount`. ~80 lines. Task #11 spec done. |
| Narrative/relationship state | Medium | Who-hates-whom graph, multi-agent memory. Opus worktree. |
| Improv scene lifecycle | Medium | Tag-out/tap-out, bench/stage, multi-scene arc. |

## Tech Debt

- AI route accepts arbitrary boardId (phantom DOs)
- No upper bound on AI chat history (`maxPersistedMessages` - agents@0.5.0 supports it)
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close codes
- ChatAgent error handling: tool failures swallowed, LLM unaware of partial success
