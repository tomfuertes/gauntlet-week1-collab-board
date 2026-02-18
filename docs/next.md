# What's Next - Strategy vs Reality (Feb 18, 2026)

## The Three Breakthrough Features

| Feature | Status | What exists | What's missing |
|---------|--------|-------------|----------------|
| **1. Scene Playback (viral loop)** | **Not started** | DO broadcasts `obj:create/update/delete` already. No recording, no replay, no share link. | Event log recording with timestamps in DO storage. Replay client (`setTimeout` over event log). "Share Scene" button + replay URL. |
| **2. Async Improv** | **Partially there** | Chat persists in DO SQLite. Board state persists in DO Storage. Both resume on reconnect. AI responds to each contribution. | Notifications ("Bob added to your scene"). Making AI respond meaningfully to contributions hours apart (context windowing). Turn-taking UX. |
| **3. AI as Director** | **Started by ux-intents** | Dynamic intent chips that change based on board state. AI intent patterns for improv. System prompt has scene structure. | Proactive AI behavior (introducing complications after inactivity). Ticking clocks / urgency. Explicit scene transitions (setup -> escalation -> complication -> climax -> callback). |

## Tier 2 Features

| Feature | Status | Notes |
|---------|--------|-------|
| Improv game modes | Not started | Needs scene playback first for replayability |
| Audience/spectator mode | Not started | Read-only WS connection + emoji reactions |
| Scene gallery | Not started | Needs playback + some curation/metadata |
| Mobile-first chat view | Not started | Canvas as secondary "stage" |

## Tier 3 Features

All not started (custom AI characters, persistent characters, daily challenges).

## What's Actionable Before Feb 22 Gate

Architecture supports all three without a rewrite. Scope-wise with 4 days left:

1. **Scene Playback** - highest leverage. Needs: event log recording (DO change), replay client (new component), share URL (routing). Probably 1-2 days of focused work.
2. **AI Director proactive mode** - building on ux-intents, add inactivity-triggered complications. Prompt engineering + a `setInterval` in the ChatAgent DO. Probably half a day.
3. **Async notifications** - smallest standalone piece, but least impact without the other two.

## Core Insight

The "current loop is broken" diagnosis still holds. Nothing shipped so far closes the loop:

```
open board -> play scene -> ??? -> recruit new player
```

Scene playback is the missing piece that turns transient sessions into shareable artifacts. Every session generates content that recruits new players. Without it, every session evaporates.
