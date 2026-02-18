# AI Cost Analysis

*CollabBoard - Gauntlet AI Week 1*

## Development Costs

17 sessions over 3 days (Feb 16-18, 2026). Claude Code handled architecture, implementation, testing, and docs. Cursor used for spot edits.

| Category | Cost | Notes |
|----------|------|-------|
| Claude Code (Max plan) | ~$200/mo | Flat subscription, heavy Opus usage across 17 sessions |
| Cursor (Pro plan) | ~$20/mo | Secondary tool, light usage for focused edits |
| Workers AI (GLM-4.7-Flash) | $0 | Free tier, replaced Llama 3.3 in session 11 |
| Cloudflare (Workers, D1, DOs) | $0 | Free plan covers dev + prod at current scale |
| Claude Haiku 4.5 (Anthropic API) | <$2 | ~500 test requests during development |
| **Total dev cost** | **~$222** | **Amortized to this project's share of monthly subscriptions** |

> **Note:** Claude Code Max is a monthly subscription, not per-project. Actual marginal cost for this project is near $0 if the subscription is used for other work too.

## Production AI Models

| Model | Input/1M | Output/1M | Tool Accuracy | Notes |
|-------|----------|-----------|---------------|-------|
| GLM-4.7-Flash (Workers AI) | $0 | $0 | Good | 131K context, free tier |
| Claude Haiku 4.5 (Anthropic) | $1.00 | $5.00 | Excellent | Deployed to prod |

Selection: `ANTHROPIC_API_KEY` env var toggles Haiku on. Without it, falls back to GLM free tier.

## Token Budget Per Interaction

| Component | Tokens | Notes |
|-----------|--------|-------|
| System prompt | ~600 | Improv rules + tool/layout/color rules |
| Tool definitions (10 tools) | ~1,500 | Zod schemas serialized by AI SDK |
| Chat history (avg) | ~500 | Grows with conversation, 5-msg avg |
| User message | ~30 | Short improv prompts |
| **Total input per turn** | **~2,630** | |
| AI response text | ~50 | 1-2 sentences (improv rules enforce brevity) |
| Tool calls (avg 2-3) | ~250 | createStickyNote, createFrame, etc. |
| **Total output per turn** | **~300** | |

Scene generation (template chip) is heavier: ~3,500 input / ~1,000 output (7 tool calls across 2-3 steps).

Guardrail: `stopWhen: stepCountIs(5)` caps at 5 LLM round-trips per user message.

## Cost Per Interaction (Haiku 4.5)

| Interaction Type | Input Cost | Output Cost | Total |
|------------------|-----------|-------------|-------|
| Regular chat message | $0.0026 | $0.0015 | **$0.004** |
| Scene generation | $0.0035 | $0.0050 | **$0.009** |
| getBoardState + modify | $0.0030 | $0.0020 | **$0.005** |

## Monthly Projections

| Scale | Interactions/day | Haiku Monthly | GLM Monthly |
|-------|-----------------|---------------|-------------|
| Solo dev (now) | ~20 | **$2.40** | $0 |
| 10 active users | ~200 | **$24** | $0 |
| 50 active users | ~1,000 | **$120** | $0 |
| 100 active users | ~2,000 | **$240** | $0 |

Assumes avg 20 interactions/user/day (mix of chat + scene gen).

## Cloudflare Platform Costs

| Service | Free Tier | Our Usage | Cost |
|---------|-----------|-----------|------|
| Workers | 100K req/day | Well under | $0 |
| Durable Objects | 1M req/month | Well under | $0 |
| DO Storage | 1GB | ~KB per board | $0 |
| D1 (SQLite) | 5M reads, 100K writes/month | Well under | $0 |
| Workers AI (GLM) | Free tier models | All GLM calls | $0 |
| Static Assets | Unlimited | Vite build (~750KB) | $0 |

**Total platform cost: $0.** The only variable cost is the Anthropic API key for Haiku.

## Unit Economics

At Haiku pricing ($0.004/interaction):
- **Cost per user per month**: ~$2.40 (20 interactions/day)
- **Break-even at $5/mo plan**: 2x margin on AI costs
- **Primary cost driver**: AI model, not infrastructure

## Cost Optimization Levers

1. **Model selection** - GLM-4.7-Flash for free, Haiku for quality. Could add per-board toggle.
2. **Step limit** - Currently 5. Reducing to 3 saves ~40% on multi-step interactions.
3. **History truncation** - No current cap on chat history. Sliding window (last 20 messages) would bound input costs.
4. **Tool-result caching** - getBoardState returns full board; caching within a session would cut repeat calls.

## Development ROI

| Metric | Value |
|--------|-------|
| Total dev time | ~18 hours (1 person + AI) |
| Equivalent manual effort (estimate) | ~80-100 hours |
| AI acceleration factor | ~5x |
| Features shipped | 30+ (auth, canvas, real-time sync, AI agent with 10 tools, multiplayer chat, improv mode, 7 scene templates, etc.) |
| Cost per feature | ~$7 (amortized subscription) |
