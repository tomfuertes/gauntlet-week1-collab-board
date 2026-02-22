# YesAInd

Multiplayer improv canvas where players and AI personas perform scenes together in real time. Two AI performers. One stage. Zero scripts.

> **https://yesaind.com**

486 commits. 6 days. ~95% AI-generated code. One lesson: code enforces what prompts suggest.

> **[Deliverables](deliverables/README.md)** | **[Blog Post](https://tomfuertes.com/2026/02/22/yesaind)**

## Features

**Collaborative Canvas**

- Infinite board with pan/zoom, sticky notes, shapes, connectors, frames, text
- Real-time sync between 2+ users with multiplayer cursors and presence
- Single and multi-select, drag, resize, rotate, copy/paste, undo/redo
- Passkey/WebAuthn auth (password fallback)

**AI Improv Engine**

- 19 AI tools: createPerson, drawScene, highlightObject, play_sfx, askAudience, advanceScenePhase, etc.
- SPARK + SAGE personas with configurable per-character model selection
- Stage Manager sets up scenes silently via `generateText` (no chat output)
- Reactive persona auto-responds via `ctx.waitUntil` after each player turn
- Chat prefixes: `SM:` (stage direction), `QA:` (test bypass)
- 3 game modes: Yes And (beginner), Freeform (mid), Harold (advanced improv structure)
- Server-side auto-layout engine (`flowPlace`) - LLMs say _what_, code decides _where_
- 27 prompt versions, measured by automated LLM-as-judge eval (34/35, 97% pass rate)

**AI Show** (autonomous performance)

- Select a premise, watch two AI personas improvise a full scene with zero human input
- DO alarm-driven turn loop: 12 turns, ~2 minutes, setup -> build -> crisis -> resolution -> curtain call
- Replayable after completion via existing replay infrastructure

**Spectator Mode**

- Read-only live view (no auth required) via `#watch/<boardId>`
- Emoji reactions, audience polls, collective wave effects
- Public scene gallery and replay viewer

## Stack

| Layer     | Technology                                                                       |
| --------- | -------------------------------------------------------------------------------- |
| Frontend  | React + Vite 7 + react-konva + TypeScript                                        |
| Backend   | Cloudflare Workers + Hono + Durable Objects                                      |
| Real-time | WebSockets (Board DO per board, ChatAgent DO per AI chat, ShowAgent DO per show) |
| Auth      | Passkey/WebAuthn primary + password fallback (PBKDF2, D1 sessions)               |
| Database  | DO Storage (board state) + D1 (users, sessions, metadata)                        |
| AI        | Anthropic + OpenAI via AI SDK (Haiku 4.5 default, 8 models available)            |
| Deploy    | Cloudflare git integration (auto-deploy on push to main)                         |

## Architecture

```
Browser --WebSocket--> CF Worker --> Board DO (per board)
                         |                   |
                         | auth (D1)         | objects (DO Storage)
                         |                   | cursors, polls (memory)
                         |
                         +-- AI chat ------> ChatAgent DO --> streamText + tools --> Board DO RPC
                         |
                         +-- AI show ------> ShowAgent DO --> alarm loop + generateText --> Board DO RPC
                         |
                         +-- spectator ----> Board DO (read-only WS, no auth)
```

Each board is a Durable Object instance. All WebSocket connections route to the same DO, which serializes writes and broadcasts to peers. LWW conflict resolution. AI mutations go through the same DO path as human mutations - broadcast is automatic.

## Key Pivots

| What Changed                                       | Why                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Better Auth -> custom PBKDF2                       | CF Workers doesn't support Node.js crypto APIs                     |
| LLM-specified x,y -> `flowPlace()` auto-layout     | LLMs can't do spatial reasoning; prompt rules get ignored          |
| Soft prompt caps -> server-side `enforcedCreate()` | Haiku treats "ONLY N objects" as a suggestion                      |
| Hat/Freezetag -> Harold improv mode                | Harold maps to real improv pedagogy with phase coaching            |
| Workers AI -> Anthropic + OpenAI only              | Workers AI required CF auth even for local dev                     |
| Sonnet as default -> Haiku as tuned default        | Capability inversion: Sonnet 80% vs Haiku 97% on constrained tasks |

## Cost Economics

| Metric                                    | Value                                         |
| ----------------------------------------- | --------------------------------------------- |
| Cost per AI turn (Haiku)                  | $0.007                                        |
| Cost per user/month (3 cmds x 2 sessions) | $0.042                                        |
| vs Midjourney per image                   | $0.04 (5.7x more expensive for static output) |
| 100 users/month                           | ~$4                                           |
| 10,000 users/month                        | ~$455                                         |

Each $0.007 turn creates 3-6 interactive canvas objects (characters, props, effects, sound). Midjourney creates 1 static image for $0.04. The business model works because improv is text-and-tool-heavy (cheap tokens), not image-generation-heavy (expensive pixels).

## AI-First Development

Built entirely with Claude Code in CEO Mode: Opus orchestrates, Sonnet/Haiku implement in parallel git worktrees. 231 sessions, 265 tasks tracked. Custom hooks enforce the workflow:

| Hook                        | What It Does                                              |
| --------------------------- | --------------------------------------------------------- |
| `force-background-tasks.sh` | Workers run in background so the lead never blocks        |
| `task-completion-gate.sh`   | Workers must report structured metadata before completing |
| `session-end-promote.sh`    | Auto-promotes recurring learnings to CLAUDE.md            |
| `bash-secrets-warn.sh`      | Blocks API keys from appearing in shell commands          |
| `ceo-stop-guard.sh`         | Prevents stopping session while workers are active        |

[Full hooks source](https://gist.github.com/tomfuertes/a6d751e509d4d4c1ec841e9970bd65f4)

## Local Development

```bash
npm ci
npm run dev          # build + wrangler dev
```

Requires: Node.js 20+, Cloudflare account with Workers Paid plan ($5/mo for DOs).

## Deliverables

| Document           | Link                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| AI Development Log | [deliverables/ai-development-log.md](deliverables/ai-development-log.md) |
| Project History    | [deliverables/project-history.md](deliverables/project-history.md)       |
| AI Cost Analysis   | [deliverables/ai-cost-analysis.md](deliverables/ai-cost-analysis.md)     |
| Demo Script        | [deliverables/demo-script.md](deliverables/demo-script.md)               |

## v2 Roadmap

- [ ] Remove `Note:` prefix and add `SM:` intent chip to ChatPanel
- [ ] Sonnet prompt tuning (model-tier-aware constraints for capable models)
- [ ] Rebaseline narrative eval with fixed judge
- [ ] AI Show: audience interaction (polls, heckle-to-influence)
- [ ] AI Show: scheduled shows, custom personas/models
- [ ] Spectator heckle interaction
- [ ] Per-user show daily budget cap
