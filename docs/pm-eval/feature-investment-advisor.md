# Feature Investment Advisor Skill Evaluation

## Artifact: ROI Analysis

### Sprint 1: AI Cursor Presence - Financial Analysis

#### Step 0: Gather Context

- **Feature:** When the AI agent creates or moves objects, an animated cursor appears on the canvas tracing to each creation point. AI appears in the presence bar. All connected users see the AI "working" in real time.
- **Target segment:** Gauntlet AI program evaluators (portfolio reviewers).
- **Current MRR/ARR:** $0
- **Current ARPU:** $0
- **Monthly churn rate:** N/A (no users to churn)
- **Gross margin:** N/A (no revenue to margin)
- **Development cost estimate:** ~6 hours at $100/hr = $600
- **Ongoing COGS:** Negligible (cursor data is ephemeral WS messages, no storage or API costs)
- **Ongoing OpEx:** Near zero (maintenance absorbed into existing WS infrastructure)

#### Step 1: Identify Revenue Connection

Classification: **No direct revenue impact.**

Walking through the five categories:

1. **Direct monetization** - No. There is no pricing tier, no paid add-on, no usage fee. The app is free.
2. **Retention improvement** - No. There are no customers to retain. Churn rate is undefined (0/0).
3. **Conversion improvement** - No. There is no trial-to-paid funnel. No conversion rate exists.
4. **Expansion enabler** - No. There is no upsell path. ARPU is $0.
5. **No direct revenue impact** - Yes. This is a platform/UX improvement with strategic-only value.

The skill says to skip to strategic value assessment. There are no adaptive sub-questions to answer because every formula requires a nonzero customer base or revenue figure.

**The math that doesn't work:**
- `Potential Monthly Revenue = Customer Base x Adoption Rate x Price` = 0 x anything x $0 = $0
- `LTV Impact = Increase in Customer Lifetime x Customer Base x ARPU x Margin` = anything x 0 x $0 x 0% = $0
- Every formula in the skill produces $0.

#### Step 2: Assess Cost Structure

- **One-time development cost:** $600
- **Monthly COGS impact:** ~$0 (cursor presence is ephemeral WS broadcast, no new infra)
- **Monthly OpEx impact:** ~$0 (no support burden, no new monitoring)
- **Contribution margin:** Undefined (Revenue - COGS) / Revenue = ($0 - $0) / $0 = 0/0

Red flag check: COGS > 20% of projected revenue? COGS is $0, revenue is $0. The check is meaningless.

#### Step 3: Evaluate Constraints and Timing

- **Competitive threat:** Yes, moderate. Miro Sidekicks already ships AI cursor presence as a headline feature. However, CollabBoard is not competing for customers - it's competing for evaluator attention. The "threat" is that without cursor presence, the demo looks like a toy next to Miro.
- **Capacity:** Solo dev, one feature at a time. Classic "can only build one major feature this quarter" constraint.
- **Dependencies:** Requires existing WS infrastructure (already built), AI tool execution hooks (already built). No blocking dependencies.
- **Timing:** Gauntlet Week 1 submission deadline is fixed. Every hour matters.

#### Step 4: Deliver Recommendation (Faithful Application)

**ROI Calculation:**
- `ROI = (Annual Revenue x Margin %) / Development Cost`
- `ROI = ($0 x 0%) / $600`
- `ROI = $0 / $600`
- **ROI = 0:1**

This is below every threshold the skill defines:
- Not > 3:1 (Build Now)
- Not > 2:1 (even marginal)
- Not > 1:1 (breakeven)
- It is exactly 0:1.

**Pattern match: Pattern 3 - Don't Build (Poor ROI)**

Triggers satisfied:
- ROI < 1:1? Yes (0 < 1). Check.
- Margin-diluting? N/A (no margin to dilute).
- No compelling strategic value? The skill says to check for "competitive moat, platform enabler, compliance, market requirement." None of these map cleanly to a portfolio project.

**Faithful output per Pattern 3:**
- Financial case summary: Breakeven is impossible. Revenue is $0 now and $0 after building. The feature generates zero financial return on a $600 investment. Payback period is infinite.
- Alternative scope: Could reduce scope (e.g., just show AI in presence bar without animated cursor). Saves maybe 2 hours.
- Conditions that would make it viable: A pricing model where cursor presence drives conversion (e.g., "collaborative AI" as a paid tier).
- Threshold for changing decision: Any nonzero revenue projection.

**The skill's faithful recommendation for Sprint 1: Don't Build.**

#### Step 5: Follow-Up

The skill offers sensitivity analysis. Let's try:
- Adoption at 2x: 2 x 0 = 0 revenue. ROI still 0:1.
- Adoption at 0.5x: 0.5 x 0 = 0 revenue. ROI still 0:1.

Sensitivity analysis is useless when the base case is zero. Multiplying zero by any scalar produces zero.

---

### Sprint 5: AI Board Generation - Financial Analysis

#### Step 0: Gather Context

- **Feature:** On blank boards, a prominent "Generate Board" sparkle input appears. User describes what they want, AI generates a complete structured board (SWOT, Kanban, brainstorm, etc.).
- **Target segment:** Gauntlet AI program evaluators.
- **Current MRR/ARR:** $0
- **Current ARPU:** $0
- **Monthly churn rate:** N/A
- **Gross margin:** N/A
- **Development cost estimate:** ~4 hours at $100/hr = $400
- **Ongoing COGS:** Small per-generation AI inference cost (~$0.001-0.01 per generation with GLM-4.7-Flash, which is free tier). Effectively $0.
- **Ongoing OpEx:** Near zero.

#### Step 1: Identify Revenue Connection

Classification: **No direct revenue impact.**

Same analysis as Sprint 1. All five categories produce the same answer: $0. Every formula zeros out.

- `Potential Monthly Revenue = 0 x anything x $0 = $0`

Skip to strategic value assessment.

#### Step 2: Assess Cost Structure

- **One-time development cost:** $400
- **Monthly COGS impact:** ~$0 (free-tier AI model)
- **Monthly OpEx impact:** ~$0
- **Contribution margin:** 0/0 = undefined

#### Step 3: Evaluate Constraints and Timing

- **Competitive threat:** Yes. FigJam uses board generation as their primary AI entry point. Without it, CollabBoard's AI feels like a chat sidebar rather than a canvas-native AI experience.
- **Capacity:** Same solo dev constraint.
- **Dependencies:** Requires existing AI tool infrastructure (already built), template coordinate system (already built). Minimal new work - mostly a UI trigger + prompt engineering.
- **Timing:** Same fixed deadline.

#### Step 4: Deliver Recommendation (Faithful Application)

**ROI Calculation:**
- `ROI = ($0 x 0%) / $400`
- **ROI = 0:1**

**Pattern match: Pattern 3 - Don't Build (Poor ROI)**

Identical to Sprint 1. The skill produces the exact same recommendation for both features. It cannot differentiate between them because both have identical revenue: zero.

**The skill's faithful recommendation for Sprint 5: Don't Build.**

---

### The Degenerate Verdict from Faithful Application

Both features receive "Don't Build" recommendations. The framework cannot distinguish between them. It cannot rank them. It produces identical outputs because the only differentiator it has - revenue - is zero for both.

The 3:1 ROI threshold is meaningless: 0:1 < 3:1 for both. The sensitivity analysis is meaningless: 2x of zero is zero. The payback period is meaningless: infinite for both. The contribution margin is meaningless: 0/0 for both.

**The skill, applied faithfully, recommends building neither feature and offers no way to choose between them.** If a PM followed this advice, they would ship nothing.

---

## Adapted Framework: Portfolio Impact Analysis

### Substitution Map

| Financial Concept | Portfolio Substitute | Measurement |
|---|---|---|
| Revenue / MRR | Portfolio impact score | How much does this impress evaluators? (1-10) |
| Customer retention | Evaluator engagement time | Does this make someone spend more time with the demo? (seconds) |
| Churn reduction | "Boredom risk" reduction | Does this prevent evaluators from closing the tab? |
| ARPU | Per-evaluator impression depth | Does this create a memorable moment? |
| 3:1 ROI threshold | 3:1 effort-to-wow ratio | Does the wow factor justify 3x the dev hours? |
| Contribution margin | Signal-to-noise ratio | Does the feature strengthen or dilute the project's narrative? |
| Payback period | Time-to-wow | How quickly does the evaluator see the value? |

### Sprint 1 (AI Cursor Presence) - Adapted Analysis

**Step 1: Identify Impact Connection**

Category: **Engagement improvement** (analog of retention improvement).

- What engagement problem does this address? The "dead AI" problem - when AI creates objects, they just appear. The evaluator doesn't see the AI "working." It feels like a database insert, not a collaborator.
- Expected engagement lift: High. Cursor presence transforms a 2-second "oh, stuff appeared" into a 10-15 second "whoa, the AI is moving around the board creating things." That's a 5-7x increase in engagement duration per AI action.
- Portfolio impact score: **8/10**. Miro's headline AI feature. Demonstrates understanding of collaborative UX patterns. Shows technical sophistication (real-time cursor interpolation across WS).

**Step 2: Assess Cost**

- Dev cost: 6 hours ($600 equivalent)
- Ongoing cost: Zero
- Signal-to-noise ratio: High positive. Cursor presence reinforces the "real-time collaboration" narrative that is the project's core thesis.

**Step 3: Evaluate Constraints**

- Competitive benchmark: Miro Sidekicks does exactly this. Building it shows awareness of industry best practices. Not building it is a visible gap.
- Dependencies: None blocking.

**Step 4: Deliver Recommendation**

**Effort-to-wow calculation:**
- Wow factor: 8/10
- Dev effort: 6 hours (normalized to 6/10 on the sprint scale)
- Effort-to-wow ratio: 8/6 = **1.33:1**

Below the 3:1 adapted threshold? Yes. But the original 3:1 threshold assumes you have alternatives that score higher. In a portfolio context with 5 sprint options, 1.33:1 means "solid but not the most efficient use of time."

**Time-to-wow:** Near-instant. The moment an evaluator triggers any AI action, they see the cursor. No onboarding required.

**Boredom risk reduction:** High. AI cursor presence is continuously visible whenever AI acts. It's not a one-time moment - it pays off on every AI interaction.

**Adapted recommendation: Build, but note the 6-hour cost is high relative to the 4-hour alternatives.**

---

### Sprint 5 (AI Board Generation) - Adapted Analysis

**Step 1: Identify Impact Connection**

Category: **Conversion improvement** (analog: converts a confused evaluator into an engaged one).

- What conversion problem does this address? The blank canvas problem. An evaluator opens a new board and sees... nothing. They have to know to open the chat panel, type a prompt, and wait. Board generation puts a sparkle input front and center on the empty canvas.
- Expected conversion lift: Very high. This is the difference between "evaluator creates a board, stares at blank canvas, leaves" and "evaluator creates a board, types 'create a project planning board', and gets a fully populated workspace in 3 seconds."
- Portfolio impact score: **9/10**. FigJam's primary AI moment. Solves the most critical UX problem (blank canvas). Creates the single most shareable demo moment.

**Step 2: Assess Cost**

- Dev cost: 4 hours ($400 equivalent)
- Ongoing cost: Near zero (free AI model)
- Signal-to-noise ratio: Very high positive. Board generation is THE feature that makes the AI feel native to the canvas rather than bolted on as a chat sidebar.

**Step 3: Evaluate Constraints**

- Competitive benchmark: FigJam uses this as their primary entry point. It's the expected pattern for AI-native canvas tools.
- Dependencies: Minimal - reuses existing AI tool infrastructure and template system.

**Step 4: Deliver Recommendation**

**Effort-to-wow calculation:**
- Wow factor: 9/10
- Dev effort: 4 hours (normalized to 4/10 on the sprint scale)
- Effort-to-wow ratio: 9/4 = **2.25:1**

Closer to the 3:1 threshold and significantly better than Sprint 1's 1.33:1.

**Time-to-wow:** Immediate. It's the first thing an evaluator sees on a new board. Zero friction, zero discovery required.

**Boredom risk reduction:** Critical. This is the feature that prevents the evaluator from bouncing on an empty board. It's a one-time moment but it's the gateway to everything else.

**Adapted recommendation: Build first. Highest effort-to-wow ratio of the two features.**

---

### Adapted Framework Comparison

| Metric | Sprint 1 (Cursor) | Sprint 5 (Board Gen) | Winner |
|---|---|---|---|
| Portfolio impact score | 8/10 | 9/10 | Sprint 5 |
| Dev cost | 6 hrs ($600) | 4 hrs ($400) | Sprint 5 |
| Effort-to-wow ratio | 1.33:1 | 2.25:1 | Sprint 5 |
| Time-to-wow | Immediate (on AI action) | Immediate (on board create) | Tie |
| Boredom risk reduction | High (recurring) | Critical (gateway) | Sprint 5 |
| Competitive benchmark | Miro Sidekicks | FigJam AI | Tie |
| Signal-to-noise | Reinforces collab narrative | Reinforces AI-native narrative | Tie (different narratives) |

**Adapted framework verdict: Sprint 5 first, Sprint 1 second.**

Sprint 5 wins on three dimensions: lower cost, higher wow factor, and it's the gateway feature (if evaluators bounce on the blank canvas, they never see cursor presence). Sprint 1 is the better recurring-engagement feature but it's moot if the evaluator never triggers an AI action.

---

## What Decision This Changed (or Didn't)

**Gut feel priority:** Sprint 1 first. The reasoning would be: "Cursor presence is technically harder and more impressive. Miro uses it as a headline. It shows deeper engineering skill."

**Financial framework (faithful):** Don't build either. No differentiation possible. Useless.

**Adapted framework:** Sprint 5 first. The reasoning: "Board generation has a better effort-to-wow ratio (2.25:1 vs 1.33:1), costs 33% less dev time, and solves the critical gateway problem. If evaluators bounce on the blank canvas, they never see cursor presence."

**Did the priority order change?** Yes - the adapted framework flipped the order from gut feel. Gut feel favored the technically harder feature (Sprint 1). The adapted framework favored the higher-leverage feature (Sprint 5) because it formalized two things that gut feel underweighted:

1. **Gateway sequencing:** Sprint 5 is a prerequisite for Sprint 1's value. No one sees AI cursor presence if they never trigger an AI action. Board generation puts the AI front and center immediately.
2. **Cost efficiency:** 4 hours vs 6 hours matters when you have a fixed deadline. The adapted framework's effort-to-wow ratio made this explicit rather than hand-wavy.

The 3:1 adapted threshold didn't drive the decision (neither feature crossed it). What drove it was the **comparative** analysis - exactly the mode the original skill triggers under "capacity constraints." The adapted framework's value was in forcing a structured comparison rather than providing a go/no-go threshold.

---

## The Degeneration Problem

### How Badly Did the Financial Framework Fail?

Completely. It didn't just produce a wrong answer - it produced a **vacuous** answer. "Don't Build" for both features, with no ability to differentiate, is strictly worse than flipping a coin. A coin at least picks one.

The failure mode is structural, not parametric:

1. **Division by zero:** Contribution margin = Revenue / Revenue. When revenue is 0, this is undefined. The framework has no fallback.
2. **Multiplication by zero:** Every revenue formula includes a customer count or ARPU term. When these are 0, all formulas collapse to 0 regardless of other inputs.
3. **Threshold comparison against zero:** The 3:1 threshold assumes a positive numerator. 0:1 < 3:1 is technically true but informationally empty - it tells you nothing about relative priority.
4. **Sensitivity analysis breaks:** The skill offers "what if adoption is 2x?" as a follow-up. 2 x 0 = 0. Sensitivity analysis requires a nonzero base case.
5. **No ordinal ranking:** The skill produces categorical recommendations (Build Now / Strategic / Don't Build / Later) but has no mechanism for ranking features within a category. When both features land in "Don't Build," there's no tiebreaker.

### Is This a Fair Criticism?

Partially. The skill explicitly says "Don't Use When: Impact purely qualitative without measurable retention effect." A portfolio project with zero revenue is exactly this case. The skill knows its own limits - it just doesn't enforce them. It lets you run the analysis and get nonsense instead of refusing to run.

A better-designed skill would detect the zero-revenue condition in Step 0 and say: "This framework requires nonzero revenue to function. For pre-revenue or portfolio projects, consider using [alternative framework] instead." The skill doesn't do this.

### Did the Adapted Framework Add Value?

Moderate value, with caveats.

**What worked:**
- The substitution of "effort-to-wow ratio" for "ROI" produced a meaningful comparative metric.
- The "gateway sequencing" insight (Sprint 5 enables Sprint 1's value) emerged naturally from the "conversion improvement" analog.
- The structured cost comparison made the 4hr vs 6hr difference feel consequential rather than trivial.

**What didn't work:**
- The numeric scores (8/10, 9/10) are fabricated confidence. There's no empirical basis for them. They feel precise but they're just gut feel with decimal points.
- The 3:1 adapted threshold was arbitrary and neither feature crossed it, so it didn't drive any decision.
- The framework overhead (5 steps, multiple categories, formal scoring) took significant analysis time to produce a conclusion that could be stated in one sentence: "Build the cheaper feature that solves the blank-canvas problem first."

---

## Scores

- **Actionability: 3/5** - The adapted framework did change the priority order from gut feel (Sprint 5 over Sprint 1), and the "gateway sequencing" insight is genuinely useful. But the faithful financial framework was completely useless (0/5), so the average is dragged up only by the adaptation work that went well beyond what the skill itself provides. The skill deserves credit for the structured comparison template, but the user had to do the intellectual work of reinventing the metrics.

- **Novelty vs vanilla Claude: 2/5** - If you asked vanilla Claude "I'm building a portfolio project for AI program evaluators. Should I build AI cursor presence (6hrs) or AI board generation (4hrs) first?", it would almost certainly say "Board generation first - it solves the blank canvas problem, costs less, and is the gateway to all other AI features." The adapted framework arrived at the same conclusion through more formal means, but the "gateway sequencing" insight isn't proprietary to this framework - it's basic product thinking that any competent PM (or LLM) would identify. The structured format is nice for documentation purposes, but it didn't surface a non-obvious insight. The main novelty is negative: demonstrating exactly how financial ROI frameworks degenerate at zero revenue, which is pedagogically interesting but not actionable.
