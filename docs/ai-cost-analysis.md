# AI Cost Analysis

*CollabBoard - Gauntlet AI Week 1*

## Development Costs

8 sessions over 12 hours (Feb 16-17, 2026). Claude Code handled architecture, implementation, testing, and docs. Cursor used for spot edits.

| Category | Cost | Notes |
|----------|------|-------|
| Claude Code (Max plan) | ~$200/mo | Flat subscription, heavy Opus usage across 8 sessions |
| Cursor (Pro plan) | ~$20/mo | Secondary tool, light usage for focused edits |
| Workers AI (Llama 3.3 70B) | $0 | Free tier: 10k neurons/day |
| Cloudflare (Workers, D1, DOs) | $0 | Free plan covers dev + prod at current scale |
| Claude Haiku 4.5 (AI Gateway) | <$1 | ~200 test requests during development |
| **Total dev cost** | **~$221** | **Amortized to this project's share of monthly subscriptions** |

> **Note:** Claude Code Max is a monthly subscription, not per-project. Actual marginal cost for this project is near $0 if the subscription is used for other work too. The $221 represents full subscription cost during the build week.

## Production Cost Model

### Per-Request Costs (current stack)

| Component | Cost basis | Per request |
|-----------|-----------|-------------|
| CF Workers | $0.30/M requests (after 10M free) | ~$0.0000003 |
| Durable Objects | $0.15/M requests | ~$0.00000015 |
| DO Storage | $0.20/GB-month | negligible (~200 bytes/object) |
| D1 reads | $0.001/M (after 25B free) | ~$0.000000001 |
| D1 writes | $1.00/M (after 50M free) | ~$0.000001 |
| AI (Llama 3.3) | Free 10k neurons/day | $0 (within free tier) |

### AI Model Costs If Upgrading

Per AI chat request (~500 input + 200 output tokens):

| Model | Per request | Monthly @ 1K users (50 req/user/mo) |
|-------|-----------|-------------------------------------|
| Llama 3.3 70B (current) | $0 (free tier) | $0 |
| GPT-5 Mini | $0.00053 | $26.50 |
| Claude Haiku 4.5 | $0.0015 | $75.00 |

### Monthly Cost at Scale

Assumptions: 50 AI requests/user/month, 20 board objects/user, 5 sessions/user/month

| Component | 100 users | 1K users | 10K users | 100K users |
|-----------|-----------|----------|-----------|------------|
| CF Workers + DOs | $0 (free) | $0 (free) | ~$5 | ~$15 |
| D1 | $0 (free) | $0 (free) | $0 (free) | ~$5 |
| AI (Llama 3.3 free) | $0 | $0 | $0 | $0 |
| AI (GPT-5 Mini) | $2.65 | $26.50 | $265 | $2,650 |
| AI (Haiku 4.5) | $7.50 | $75 | $750 | $7,500 |

**Key insight:** Infrastructure is essentially free up to 10K users on CF free plan. AI is the only meaningful cost driver, and model choice determines whether it's $0 or $7,500/mo at 100K users.

## Unit Economics

At GPT-5 Mini pricing ($0.00053/AI request):
- **Cost per user per month**: ~$0.027 (50 AI requests)
- **Break-even at $5/mo plan**: 185x margin on AI costs
- **Primary cost driver at scale**: AI model, not infrastructure

### Development ROI

| Metric | Value |
|--------|-------|
| Total dev time | ~12 hours (1 person + AI) |
| Equivalent manual effort (estimate) | ~60-80 hours |
| AI acceleration factor | ~5-7x |
| Features shipped | 25+ (auth, canvas, real-time sync, AI agent, 7 shape types, multi-board, etc.) |
| Cost per feature | ~$9 (amortized subscription) |

The AI-first approach traded subscription dollars for engineer-hours. At a conservative 5x acceleration, the $221 in tooling replaced ~$3,000-5,000 in equivalent contractor time.
