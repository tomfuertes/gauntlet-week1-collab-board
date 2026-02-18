# What's Next - Strategy vs Reality (Feb 18, 2026)

## The Three Breakthrough Features

| Feature | Status | What's remaining |
|---------|--------|------------------|
| ~~**1. Scene Playback (viral loop)**~~ | **Shipped** (`feat/scene-playback`) | ~~Event log, replay client, share button.~~ Done: event recording in DO, public replay endpoint, ReplayViewer with play/pause, share scene button, `#replay/{id}` route. |
| **2. Async Improv** | **In progress** (worktree: `feat/async-notify`) | D1 last-seen tracking, activity endpoint, unread badges in BoardList. AI context windowing and turn-taking UX are stretch. |
| ~~**3. AI as Director**~~ | **Shipped** (`feat/ux-intents` + `feat/ai-director`) | ~~Proactive AI, scene complications, dramatic structure.~~ Done: dynamic intent chips, inactivity timer (60s), scene phase tracking in DO, dramatic structure system prompt. |

## Tier 2+ Features

Not started, not planned for Feb 22: improv game modes, audience/spectator mode, scene gallery, mobile-first chat, custom AI characters, persistent characters, daily challenges.

## What's Actionable Before Feb 22 Gate

1. ~~**Scene Playback**~~ - shipped.
2. ~~**AI Director proactive mode**~~ - shipped.
3. **Async notifications** - in progress. Worktree active.
4. **UAT on prod** - full improv flow with scene playback + AI director.
5. **Final gate prep** - Feb 22.

## Core Insight

The loop is now closable:

```
open board -> play scene -> share replay link -> recruit new player
```

Scene playback shipped. The viral loop exists. Async notifications would remove the coordination friction for returning players.
