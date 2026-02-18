# What's Next (Feb 18, 2026)

## Shipped - The Three Breakthrough Features

| Feature | What shipped |
|---------|--------------|
| ~~Scene Playback (viral loop)~~ | Event recording in DO, public replay endpoint, ReplayViewer with play/pause, share scene button, `#replay/{id}` route. |
| ~~Async Improv~~ | D1 activity tracking (migration 0003), `recordBoardActivity`/`markBoardSeen` helpers, activity endpoint, unread badges in BoardList. |
| ~~AI as Director~~ | Dynamic intent chips, 60s inactivity timer, scene phase tracking in DO, dramatic structure system prompt. |
| ~~Scene Gallery~~ | Public `#gallery` route, `/api/boards/public` endpoint, SceneGallery grid with replay links, Gallery nav link in BoardList. |

## The Loop is Closed

```
open board -> play scene -> share replay link -> recruit new player
                                 ^                      |
                                 |   async badges       |
                                 +--- bring them back --+
```

## In Progress

| Worktree | Branch | What |
|----------|--------|------|
| ai-audit | `feat/ai-audit` | First-principles audit of agent architecture. Observability, prompt versioning, tool call optimization. |

## Roadmap

| Feature | Notes |
|---------|-------|
| Improv game modes | Scenes From a Hat, Yes-And chains - structured replayability |
| Audience/spectator mode | Read-only WS + emoji reactions - improv needs witnesses |
| Mobile-first chat view | Canvas as secondary "stage" - phone users |
| Custom AI characters | Upload personality, share characters |
| Persistent characters across scenes | Continuity creates attachment |
| Daily scene challenges + leaderboard | Brings people back daily |
