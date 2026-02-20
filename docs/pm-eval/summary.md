# PM Skills Evaluation Summary

Evaluated 3 of 8 proposed skills from deanpeters/Product-Manager-Skills against YesAInd.
Date: 2026-02-18

## Scorecard

| Skill | Actionability | Novelty vs Vanilla | Total | Verdict |
|-------|:---:|:---:|:---:|---------|
| company-research | 4/5 | 4/5 | **8/10** | Earned its keep |
| discovery-process | 4/5 | 3/5 | **7/10** | Conditional keep |
| feature-investment-advisor | 3/5 | 2/5 | **5/10** | Theater for pre-revenue |

Cut threshold from ideas.txt: combined score < 6/10 = cut.

---

## Skill-by-Skill Verdict

### company-research: KEEP

The only skill that **requires external data** to function. WebSearch surfaced 10+ post-cutoff facts Claude couldn't hallucinate:

- Miro MCP Server (Feb 2, 2026) - 16 days old, connects to 11 AI coding platforms
- Figma x Anthropic "Code to Canvas" (Feb 17, 2026) - announced yesterday
- Figma IPO July 2025 at $18.8B, subsequent 85% crash
- tldraw SDK 4.0 (Sept 2025) with Agent starter kit + $6K/yr licensing
- Miro AI Workflows GA (Jan 2026) with multi-vendor integration

**Decision changed:** Moved AI Board Generation from Sprint 5 to Sprint 1. Both Miro and Figma have shipped full-board generation as GA features - YesAInd's template chips are two generations behind. Also surfaced an entirely new strategic dimension (MCP servers as "context layer for AI coding") that wasn't on the radar.

**Why it works:** The skill's structure (exec quotes, product insights, roadmap signals, PLG) forced breadth that a casual "search for Miro AI features" would miss. WebSearch provided the novel data; the framework ensured coverage.

### discovery-process: CONDITIONAL KEEP

The KILL gate had teeth - killed 2 of 5 sprints, pivoted a third, cutting planned work from 26hrs to 10hrs:

| Sprint | Decision | Sharp Insight |
|--------|----------|---------------|
| 1: AI Cursor Presence | PIVOT (6hrs -> 2hrs) | 80% of demo impact from presence bar alone; particle trails are gold-plating |
| 2: Contextual AI Actions | **KILL** | Clustering requires multi-step LLM orchestration unreliable on free-tier GLM-4.7-Flash |
| 3: AI Batch Undo | GO | Self-evident problem, best effort/impact ratio |
| 4: Intent Preview | **KILL** | Sprint 3 already solves the same problem (AI reversibility) at 1/3 the cost |
| 5: AI Board Generation | GO | First-impression gateway feature |

**Decision changed:** Yes - KILL'd Sprint 2 despite it being "FigJam's dominant pattern" (the LLM reliability argument is sharp and non-obvious). KILL'd Sprint 4 by identifying problem overlap with Sprint 3.

**Why it's conditional:** Vanilla Claude asked to "prioritize 5 sprints in 10 hours" would likely converge on the same build order (3+5 first, maybe 1, skip 2+4). The framework adds better reasoning (LLM reliability, problem overlap) but the endpoint is similar. The KILL decisions are the value-add; the GO decisions were already obvious.

### feature-investment-advisor: CUT (for pre-revenue)

The financial framework **completely degenerated** at $0 revenue:

- Both sprints got identical 0:1 ROI, both got "Don't Build"
- Every formula multiplied by customer count/ARPU/revenue - all $0
- Sensitivity analysis useless (2x of 0 = 0)
- Framework couldn't differentiate between the two features at all
- The 3:1 threshold compared against 0:1 for both - informationally empty

An adapted version (substituting "portfolio impact" for revenue) produced a useful comparison and flipped the priority order (Sprint 5 > Sprint 1 on effort-to-wow ratio). But the user had to reinvent the metrics - the skill provided the structure, not the insight.

**Decision changed:** The adapted version flipped gut-feel priority (Sprint 5 over Sprint 1). But vanilla Claude would reach the same conclusion: "build the cheaper feature that solves the blank-canvas gateway problem first."

---

## Cross-Skill Convergence

All three skills agreed on one thing: **AI Board Generation should be Sprint 1.** For different reasons:

| Skill | Reason Board Gen Wins |
|-------|----------------------|
| company-research | Competitors shipped GA board gen; YesAInd is 2 generations behind |
| discovery-process | First-impression gateway feature; low risk, leverages existing infra |
| feature-investment-advisor (adapted) | Best effort-to-wow ratio (2.25:1 vs 1.33:1) |

This convergence from independent frameworks is a stronger signal than any single analysis.

---

## Pattern: What Separates Signal from Theater

| Pattern | Signal | Theater |
|---------|--------|---------|
| Skill requires external data (WebSearch) | company-research | - |
| Skill has a KILL gate | discovery-process | - |
| Skill depends on numerical inputs that may be zero | - | feature-investment-advisor |
| Skill produces non-obvious reasoning | Sprint 2 KILL (LLM reliability) | Financial ROI on $0 revenue |
| Conclusion matches vanilla Claude | - | "Build the cheaper gateway feature first" |

The dividing line: **skills that force you to look outside your own head (web data, kill gates) earn their keep. Skills that formalize what you already know (structured ROI on zero revenue) are theater.**

---

## Should the Full 8-Skill Pipeline Be Pursued?

The proposed.txt 8-skill pipeline:

| # | Skill | Tested? | Prediction |
|---|-------|---------|------------|
| 1 | company-research | Yes (8/10) | **KEEP** - requires WebSearch, proven value |
| 2 | jobs-to-be-done | No | Likely 5-6/10 - Claude knows JTBD framework well, marginal novelty |
| 3 | discovery-process | Yes (7/10) | **CONDITIONAL KEEP** - KILL gate is useful but converges with vanilla |
| 4 | discovery-interview-prep | No | Likely 3/10 - requires actual customer interviews, can't run solo against a portfolio project |
| 5 | positioning-statement | No | Likely 4-5/10 - Geoffrey Moore template is useful but Claude fills it well without a skill |
| 6 | opportunity-solution-tree | No | Likely 5-6/10 - Teresa Torres framework is well-known, moderate structure value |
| 7 | press-release | No | Likely 5/10 - Working Backwards is powerful but Claude knows Amazon's format |
| 8 | feature-investment-advisor | Yes (5/10) | **CUT** for pre-revenue; KEEP for funded products with real metrics |

### Recommendation: Don't build the full pipeline.

**Keep 2 of 8:**
1. **company-research** - the only skill that produces genuinely novel output via WebSearch
2. **discovery-process** - the only skill with a KILL gate that has teeth

**Cut 6 of 8:**
- feature-investment-advisor: useless without revenue data
- jobs-to-be-done, positioning-statement, opportunity-solution-tree, press-release: frameworks Claude already knows; the skill adds structure but not insight
- discovery-interview-prep: requires real humans to interview; unusable for solo/AI-first dev

### The Broader Lesson

The PM-Skills repo contains 42 skills. Most are structured prompt templates for frameworks Claude already knows (JTBD, Moore positioning, Working Backwards, RICE, etc.). The template adds formatting discipline but not cognitive novelty.

The skills that earn their keep share one trait: **they force interaction with external reality.** company-research forces WebSearch. discovery-process forces a KILL decision. Everything else is Claude talking to itself with extra structure.

For the ccpm bridge proposed in proposed.txt: the Layer 2 execution pipeline (/pm:prd-new -> /pm:epic-decompose -> worktrees) may have independent value, but the Layer 1 PM-Skills input layer is mostly theater. Two skills out of 42 is a 4.8% survival rate.

Don't install ccpm or create the bridge skill. The 2 surviving skills can feed directly into your existing workflow (CLAUDE.md sprint plans + worktree agents) without middleware.
