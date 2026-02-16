# CollabBoard

Real-time collaborative whiteboard with AI agent integration.

## Live Demo

> Deployed URL: *coming soon*

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + react-konva + TypeScript |
| Backend | Cloudflare Workers + Hono |
| Real-time | Durable Objects + WebSockets |
| Auth | Custom (username/password, argon2, D1 sessions) |
| Database | DO Storage (board state) + D1 (users, sessions, metadata) |
| AI | Workers AI + function calling |
| Deploy | Cloudflare (auto-deploy on push) |

## Architecture

Each board is a Durable Object instance. All WebSocket connections for a board route to the same DO, which serializes writes and broadcasts to peers. This gives last-write-wins conflict resolution by construction - no CRDTs needed.

```
Browser ──WebSocket──> CF Worker ──> Durable Object (per board)
                         │                    │
                         │ auth (D1)          │ board state (DO Storage)
                         │                    │ cursor positions (memory)
                         │                    │ presence (memory)
                         │
                         └── AI commands ──> Workers AI ──> mutations back to DO
```

## Local Development

```bash
npm install
npm run dev          # wrangler dev (backend + frontend)
```

Requires: Node.js 20+, Cloudflare account with Workers Paid plan ($5/mo for DOs).

## Documentation

Internal planning docs are in `docs/` (git-crypt encrypted). See `CLAUDE.md` for architecture details and development conventions.

Submission deliverables:
- [Pre-Search Document](docs/pre-search.md) - Architecture discovery process
- [AI Development Log](docs/ai-dev-log.md) - AI-first development methodology
- [AI Cost Analysis](docs/ai-cost-analysis.md) - Unit economics and scaling projections
