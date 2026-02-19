# Thursday AM Pickup

## What Shipped (this session)

- `c5a117c` React error boundary + memoize ToolIconBtn (CSS hover, React.memo)
- `3a3b9dc` Daily scene challenges + leaderboard (D1 migration 0005, API routes, BoardList card, LeaderboardPanel)
- `488fc34` Mobile-first chat view (useIsMobile hook, CanvasPreview, responsive Board layout, touch targets)
- `a8ffc84` Custom AI characters (user-created personas replace SPARK/SAGE, D1 migration 0006, persona CRUD API, ChatPanel management UI)
- `d8a5e97` DX: npm run dev = build+serve (killed Vite HMR, no more EMFILE/WS collisions)
- `3121a95` Health check reads WRANGLER_PORT (was broken checking Vite port after dev mode switch)
- `9cde847` Observability logs in wrangler.toml
- Docs: aggressive consolidation (notes 286->80 lines), tiered model selection for worktree agents

## In Progress

- `feat/ai-tools-fix` worktree - AI chat responds text-only, no tool calls to paint the board. Regression from custom-characters merge rewriting chat-agent.ts/prompts.ts. Sonnet agent investigating.

## Merge When Ready

```bash
scripts/merge.sh ai-tools-fix
```

Then clean up all worktrees:
```bash
scripts/worktree.sh remove custom-characters
scripts/worktree.sh remove mobile-chat
scripts/worktree.sh remove daily-challenges
scripts/worktree.sh remove ai-tools-fix
```

## UAT Backlog (nothing has been browser-verified)

1. **AI tool calls** - blocked on ai-tools-fix merge. "Create a yellow sticky" should produce a board object.
2. **Daily challenges** - challenge card in BoardList, accept flow, leaderboard view, spectator reactions increment score
3. **Game modes** - hat prompt card + "Next prompt" advances, yes-and beat counter, gallery badges
4. **Token budgets** - budget phase badges (Act 3, Finale), "New Scene" button at scene-over
5. **Custom characters** - create persona, see it respond in chat with correct name/color, delete persona reverts to defaults
6. **Mobile chat** - resize browser to <768px, chat becomes primary, canvas preview strip at top, tap to expand

## Remote State

- All D1 migrations applied (0001-0006)
- CF auto-deploys on push to main
- Mistral Small 3.1 24B active, $5/day budget cap
- ENABLE_ANTHROPIC_API = false

## Unshipped Roadmap

| Feature | Model | Notes |
|---------|-------|-------|
| Narrative/relationship state | opus | Who-hates-whom graph, structural multi-agent |
| Rate limiting (auth + AI) | sonnet | Security tech debt |

## Key Context

- `npm run dev` = build once + wrangler dev (no Vite HMR). `dev:hmr` exists as escape hatch.
- `npm run health` checks WRANGLER_PORT now (not Vite port)
- Worktree agents default to `--model sonnet`. Use opus for architectural work.
- merge.sh does squash merge + --no-gpg-sign (sandbox blocks GPG socket)
