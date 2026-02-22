# YesAInd

Multiplayer improv canvas with AI agent integration. Real-time collaborative whiteboard where players and AI improvise scenes together.

## Live

> **https://yesaind.com**

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite 7 + react-konva + TypeScript |
| Backend | Cloudflare Workers + Hono + Durable Objects |
| Real-time | WebSockets (Board DO per board, ChatAgent DO per AI session) |
| Auth | Passkey/WebAuthn primary + password fallback (PBKDF2 timing-safe, D1 sessions) |
| Database | DO Storage (board state) + D1 (users, sessions, metadata) |
| AI | 8 models across 3 providers (Anthropic, OpenAI, Workers AI) via AI SDK |
| Deploy | Cloudflare git integration (auto-deploy on push to main) |

## Features

- Real-time collaborative canvas with multi-cursor presence
- AI-powered scene creation with 19 tools (draw, write, arrange, background, etc.)
- 3-step troupe builder: pick AI personas, assign models per character
- Stage Manager: AI sets up scene before first exchange
- Spectator mode with audience polls and collective wave effects
- Public scene gallery and replay viewer
- AI Show: autonomous two-performer improv (DO alarm-driven, 12 turns, zero human input)
- Chat prefixes: `SM:` (stage direction), `QA:` (test bypass)
- Emoji reactions, audience polls, collective wave effects

## Architecture

Each board is a Durable Object instance. All WebSocket connections for a board route to the same DO, which serializes writes and broadcasts to peers. LWW conflict resolution by construction - no CRDTs needed.

```
Browser ──WebSocket──> CF Worker ──> Board DO (per board)
                         │                    │
                         │ auth (D1)          │ board state (DO Storage)
                         │                    │ cursors, polls, waves (memory)
                         │
                         └── AI chat ──> ChatAgent DO ──> streamText + tools ──> Board DO RPC
```

## Local Development

```bash
npm ci
npm run dev          # build + wrangler dev
```

Requires: Node.js 20+, Cloudflare account with Workers Paid plan ($5/mo for DOs).

## v2 Roadmap

- [ ] Remove `Note:` prefix (half-baked, no client UI) and replace with `SM:` intent chip in ChatPanel
- [ ] v28 Sonnet prompt tuning - Sonnet scores 80% vs Haiku 97% due to over-creation during crises; needs model-tier-aware prompt injection
- [ ] Rebaseline narrative eval with fixed judge (tool_usage dimension was broken pre-v27)
- [ ] AI Show: audience interaction during shows (polls, heckle-to-influence)
- [ ] AI Show: "next show in X minutes" scheduled shows
- [ ] AI Show: custom persona/model selection for shows
- [ ] Heckle interaction (spectators influence the scene via typed heckles)
- [ ] Per-user show daily budget cap (separate from main AI budget)

## Documentation

See `CLAUDE.md` for architecture, conventions, and agent delegation patterns.
