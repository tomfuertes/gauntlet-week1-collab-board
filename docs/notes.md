# Notes

*What's in-flight. Not architecture (that's CLAUDE.md), not history (that's git log).*

## Loose Ends

- [cloudflare/ai#404](https://github.com/cloudflare/ai/issues/404): `workers-ai-provider` drops `tool_choice`. Shim in place.
- Eval harness WS 400 on localhost. Workaround: test against prod.
- #29 (LangSmith observability) still open - research task.

## Unshipped

| Feature | Priority | Notes |
|---------|----------|-------|
| Narrative/relationship state | Medium | Who-hates-whom graph, multi-agent memory. Opus worktree. |
| Improv scene lifecycle | Medium | Tag-out/tap-out, bench/stage, multi-scene arc. |
| `maxPersistedMessages` | Low | Cap AI chat history in DO storage. agents@0.5.0 supports it. |

## Tech Debt

- AI route accepts arbitrary boardId (phantom DOs)
- No upper bound on AI chat history
- Circles have no resize handles
- WS reconnect: no max retry, no non-retryable close codes
- ChatAgent error handling: tool failures swallowed, LLM unaware of partial success
