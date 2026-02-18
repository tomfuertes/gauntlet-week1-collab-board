# What's Next - Strategy vs Reality (Feb 18, 2026)

## The Three Breakthrough Features - ALL SHIPPED

| Feature | Status | What shipped |
|---------|--------|--------------|
| ~~**1. Scene Playback (viral loop)**~~ | **Shipped** | Event recording in DO, public replay endpoint, ReplayViewer with play/pause, share scene button, `#replay/{id}` route. |
| ~~**2. Async Improv**~~ | **Shipped** | D1 activity tracking (migration 0003), `recordBoardActivity`/`markBoardSeen` helpers, activity endpoint, unread badges in BoardList. |
| ~~**3. AI as Director**~~ | **Shipped** | Dynamic intent chips, 60s inactivity timer, scene phase tracking in DO, dramatic structure system prompt. |

## The Loop is Closed

```
open board -> play scene -> share replay link -> recruit new player
                                 ^                      |
                                 |   async badges       |
                                 +--- bring them back --+
```

## What's Left Before Feb 22 Gate

- [ ] UAT on prod (full flow: auth -> board -> scene -> AI director nudge -> replay -> share link)
- [ ] Two-browser sync test with activity badges
- [ ] Push to main (triggers CF deploy)
- [ ] Final gate prep

## Tier 2+ Features (Post-Gate)

Not planned for Feb 22: improv game modes, audience/spectator mode, scene gallery, mobile-first chat, custom AI characters, persistent characters, daily challenges.
