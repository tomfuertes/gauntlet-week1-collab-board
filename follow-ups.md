# Follow-ups

*Session handoff context - Feb 18, 2026. Delete after pickup.*

## Next: Code Cleanup Worktree Sprint

User chose to start with tech debt cleanup before new features. Post-merge refactors are now unblocked.

### Priority Refactors

| # | Refactor | Lines | Files |
|---|----------|-------|-------|
| 11 | Merge Board/Replay/Spectator object renderers into shared utility | 90+ | Board.tsx, ReplayViewer.tsx, SpectatorView.tsx |
| 12 | Extract `<Button variant="..."/>` component | 100 | across 5+ components |
| 13 | Board.tsx further decomp (BoardObjectRenderer, ConnectionToast) | 260+ | Board.tsx |
| 14 | Discriminated union for BoardObject.props per shape type | 50+safety | types.ts, Board.tsx, ai-tools-sdk.ts |
| 15 | Extract `BoardStub` interface to shared file | 20+safety | ai-tools-sdk.ts, board DO |
| 16 | `<Modal>` + `<TextInput>` shared components | 130 | across components |

### Quick Wins Still Open

| # | Refactor | Lines |
|---|----------|-------|
| 1 | Delete unused `User`/`Session` types | 11 |
| 4 | Extract `readAndCenter()` helper for tools | 12 |
| 5 | Consolidate model selection into single `_getModel()` | 6 |
| 6 | Extract `_logRequestStart/End()` helpers | 30 |
| 7 | Move `BoardMutation` to shared/types.ts | 10 |
| 10 | Director message builder helper | 40 |

### After Cleanup: Feature Priorities

1. **Improv game modes** - Scenes From a Hat, Yes-And chains
2. **Per-scene token budgets** - natural endings, cost ceiling
3. Narrative/relationship state
4. Custom AI characters
