# Discovery Process Skill Evaluation

Skill: `deanpeters/Product-Manager-Skills/skills/discovery-process`
Evaluated against: YesAInd's 5 sprint proposals
Framework: GO/PIVOT/KILL decision gate (Phase 6 of the discovery process)

## Context Calibration

The discovery-process skill is designed for teams with customers, revenue, and multi-week cycles. It presupposes:
- 5-10 customer interviews reaching saturation
- Affinity mapping of real pain points
- Opportunity-solution trees grounded in observed behavior
- Strategic fit against business goals

YesAInd has **none of this**. Zero customers. Zero interviews. Zero revenue. The "users" are Gauntlet AI evaluators who will spend 5-10 minutes poking at a deployed app. The "strategic fit" question is "does this impress technically sophisticated reviewers." The "market" is a cohort demo, not a TAM.

This means every sprint starts with the same evidence deficit: problem validation is impossible through the prescribed method. The question becomes whether the framework can still differentiate between sprints despite this shared weakness, or whether it collapses into uniform assessments.

---

## Artifact: GO/PIVOT/KILL Assessment

### Sprint 1: AI Cursor Presence (~6hrs)

**Problem validation:**
The "problem" is that AI actions feel disconnected - objects materialize without spatial narrative. Is this a real problem? For a collaborative tool, yes: cursor presence is the foundational social signal. Miro, Figma, and Google Docs all treat remote cursors as critical infrastructure. But "AI doesn't have a cursor" is a subset of a validated problem (multi-user presence), not independently validated. No one has reported this as a pain point because no one uses the app.

**Evidence assessment:**
- Competitive analysis: Strong. Miro headlines this feature.
- Customer interviews: None. N/A.
- Gut feel: High confidence that it looks impressive in demos.
- Behavioral evidence: Zero.

**Solution fit:**
The solution directly addresses the stated problem. The architecture is clean: DO cursor injection, AI presence lifecycle, distinct cursor rendering. No over-engineering.

**Effort/impact ratio:**
6 hours for a visual-only feature. No new functionality. The AI already creates objects correctly - this just animates the process. For a portfolio project, the question is: does the evaluator notice? Cursor animation during a SWOT template generation would be visually striking. But 6 hours is the largest sprint tied for Sprint 2 and 4, and it produces zero new capabilities.

**Decision: PIVOT** - The problem (AI feels disconnected) is real but the solution is overscoped at 6 hours. A 2-hour version - AI appears in presence bar during tool execution + a simple cursor dot (no particle trails, no sparkle animations, no custom icon) - delivers 80% of the demo impact. Cut the visual polish. The evaluator cares that AI shows as a collaborator, not that it has a particle trail.

---

### Sprint 2: Contextual AI Actions / Right-click Menu (~6hrs)

**Problem validation:**
The "problem" is that all AI interaction goes through the chat sidebar, forcing users to context-switch from canvas to chat. Is this real? Partially. The existing chat panel with template chips already puts AI 1 click away. The right-click menu puts it 1 right-click away. The marginal improvement in access latency is small. The deeper value is surfacing AI capabilities contextually - showing "cluster" only when multiple objects are selected teaches the user what AI can do.

**Evidence assessment:**
- Competitive analysis: Strong. FigJam's dominant pattern. Miro's most-praised feature.
- Customer interviews: None.
- Architectural analysis: This is the most complex sprint. "Cluster by Theme" requires: read all selected objects, semantic grouping, frame creation, multi-object move. That's 4+ tool calls orchestrated by a prompt. With GLM-4.7-Flash (free tier), multi-step orchestration is unreliable.
- Risk: The 6-hour estimate assumes the LLM reliably executes multi-step clustering. If it doesn't, you've spent 6 hours on a context menu that only works for simple actions.

**Solution fit:**
The solution is architecturally ambitious but the prompt-engineering risk is high. Clustering is the headline action, but it's the least likely to work reliably. "Restyle" and "Generate Similar" are achievable but less impressive. The implementation spec correctly identifies the complexity ("cluster = read + create frames + move objects") but doesn't address the reliability question.

**Effort/impact ratio:**
6 hours for a feature whose headline action (clustering) may fail 40%+ of the time with the free-tier model. The simpler actions (restyle, generate similar) work through the chat panel already - the right-click menu is just a shortcut. For evaluators: if clustering works in the demo, it's a showstopper feature. If it doesn't, the context menu is a glorified shortcut to chat.

**Decision: KILL** - The effort/risk ratio is wrong for a portfolio project with a free-tier LLM. The headline feature (semantic clustering) depends on multi-step tool orchestration that's unreliable with GLM-4.7-Flash. The simpler context menu actions (restyle, generate similar) are marginal improvements over the existing chat panel + template chips. 6 hours is too much for a feature that's either incredible (if clustering works) or underwhelming (if it doesn't). The evaluator sees a context menu with 4 actions, tries "Cluster by Theme," it half-works, and the impression is "buggy AI" - worse than not having the feature.

If you have access to Claude Haiku (the ANTHROPIC_API_KEY path), this becomes a PIVOT: build clustering only, skip the other actions, budget 4 hours. But on the free tier, KILL.

---

### Sprint 3: AI Batch Undo (~4hrs)

**Problem validation:**
The problem is concrete and easily demonstrated: AI creates 12 objects (SWOT template), user needs 12 undos to revert. This is a real usability failure. Any evaluator who tries "undo" after an AI action will hit it. Unlike the other sprints, this problem doesn't require customer interviews to validate - it's a logical consequence of multi-object AI actions combined with per-object undo.

**Evidence assessment:**
- Self-evident from architecture: AI creates N objects, undo reverts 1 object. QED.
- Competitive analysis: Flagged as "unsolved" in competitive research. True differentiator.
- First-principles: Batch undo is a prerequisite for trusting AI to do complex actions. Without it, users learn to avoid multi-object prompts.

**Solution fit:**
Excellent. The solution is surgically precise: batchId on objects, undoBatch RPC, UI button. The implementation spec is the cleanest of all 5 sprints - minimal surface area, clear data flow, no ambiguity.

**Effort/impact ratio:**
4 hours for a feature that: (a) solves a real usability problem, (b) is a competitive differentiator (nobody does this), (c) has low implementation risk, (d) is architecturally clean, (e) demonstrates understanding of AI-specific UX challenges. This is the best ratio of all 5 sprints.

**Decision: GO** - Unambiguous. Real problem, clean solution, low risk, high signal to evaluators that you understand AI-tool UX beyond the basics.

---

### Sprint 4: Intent Preview / Ghost Objects (~6hrs)

**Problem validation:**
The "problem" is that AI actions are irreversible and surprising - the user doesn't know what's coming until it's already materialized. This is philosophically valid (the "preview before commit" pattern is well-established in UX) but practically questionable: does the YesAInd user actually need a preview? With batch undo (Sprint 3), reverting is trivial. Preview adds value only when: (a) the cost of undo is high, or (b) the user wants to adjust positions before committing. In YesAInd, undo cost is low (one click with Sprint 3) and the user can move objects after creation.

**Evidence assessment:**
- "Smashing Magazine Intent Preview pattern" - this is a design pattern reference, not user research. No evidence that whiteboard users want previews.
- Competitive analysis: "Nobody does this in whiteboards." This is presented as opportunity but could equally be evidence that nobody needs it.
- Architectural analysis: Two-phase tool execution is genuinely complex. Preview mode requires running AI tools in a dry-run state, collecting planned objects, rendering them as ghosts, then re-executing on confirmation. The state machine is non-trivial.

**Solution fit:**
The solution is architecturally the most complex of all 5 sprints. Two-phase execution, ghost rendering layer, approval flow, draggable ghosts, and it depends on Sprint 1 (AI cursor) for the full experience. This is a 6-hour sprint that might take 10.

**Effort/impact ratio:**
6 hours (optimistic) for a feature that solves a problem already addressed by Sprint 3 (batch undo). The evaluator sees: translucent objects appear, they click "Apply," objects become solid. It's visually interesting but the "so what" question is hard to answer if undo already works. The novel architecture (two-phase tool execution) is impressive to technical reviewers, but the risk of a half-finished implementation is high given the 6-hour budget.

**Decision: KILL** - This sprint solves a problem that Sprint 3 already addresses (AI action reversibility) with 50% more time and 3x the architectural complexity. The dependency on Sprint 1 means it can't even be attempted until Sprint 1 merges. The "nobody does this in whiteboards" framing is a red flag: nobody does it because the cost/benefit doesn't justify it when undo exists. At 6 hours with a dependency and complex state management, the risk of shipping a buggy preview system is high - and a buggy preview is worse than no preview.

---

### Sprint 5: AI Board Generation from Description (~4hrs)

**Problem validation:**
The "blank canvas problem" is well-documented in design tool UX research (Figma, Canva, Notion all have first-run generation). For a portfolio demo, this is especially acute: the evaluator opens the app, sees an empty board, and must know what to do. Currently, the chat panel with template chips partially solves this, but the evaluator has to discover the chat panel exists and understand the chip labels. A prominent sparkle input on the blank canvas is more discoverable.

**Evidence assessment:**
- Competitive analysis: FigJam's primary AI onboarding moment. Proven pattern.
- UX first principles: Empty state is the highest-friction moment in any creation tool.
- Architectural analysis: This is mostly prompt engineering + empty state UI. The AI already creates objects, frames, and stickies. The new work is the empty state overlay and the enhanced system prompt. Low risk.

**Solution fit:**
The solution directly addresses the problem with minimal new architecture. The existing AI tools handle all object creation. The system prompt addition for "board generation" is incremental. The empty state UI is a single conditional render.

**Effort/impact ratio:**
4 hours for the feature that has the single highest impact on first impression. The evaluator opens a blank board and is immediately invited to describe what they want. The AI generates a complete board. This is the "wow moment" in the first 30 seconds of the demo. Low risk, high discoverability, leverages all existing infrastructure.

**Decision: GO** - Best first-impression feature. Low risk, reasonable effort, directly solves the evaluator's first interaction. The only risk is prompt engineering quality, which is tunable post-ship.

---

## Summary: What the Framework Killed

| Sprint | Decision | Rationale |
|--------|----------|-----------|
| Sprint 1: AI Cursor Presence | **PIVOT** | Overscoped. Cut from 6hrs to 2hrs. Drop particle trails, custom icons, sparkle animations. Ship AI in presence bar + simple cursor dot. |
| Sprint 2: Contextual AI Actions | **KILL** | Headline feature (clustering) unreliable on free-tier LLM. 6hrs for a context menu whose best action probably fails. Risk of "buggy AI" impression worse than not having it. |
| Sprint 3: AI Batch Undo | **GO** | Real problem, clean solution, competitive differentiator, 4hrs. Best effort/impact ratio. |
| Sprint 4: Intent Preview | **KILL** | Solves a problem Sprint 3 already addresses. 6hrs + dependency + complex state machine = high risk of half-finished implementation. |
| Sprint 5: AI Board Generation | **GO** | First-impression feature. Low risk, 4hrs, leverages existing infrastructure. Highest demo impact per hour invested. |

**Recommended execution order (10hrs total):**
1. Sprint 5: AI Board Generation (4hrs) - nail the first impression
2. Sprint 3: AI Batch Undo (4hrs) - demonstrate AI UX sophistication
3. Sprint 1 (pivoted): AI Presence Lite (2hrs) - visual polish, ship if time permits

This cuts 24-30 planned hours to ~10 hours while keeping the two highest-signal features.

---

## What Decision This Changed (or Didn't)

The GO/PIVOT/KILL framework produced a materially different outcome than "prioritize and build what fits." Without the framework, the natural instinct is:

1. Build Sprints 3 and 5 first (lowest effort) - **same conclusion**
2. Then build Sprint 1 (Miro's headline feature) - **framework says PIVOT, not build-as-designed**
3. Then Sprint 2 (FigJam's pattern) - **framework says KILL**
4. Sprint 4 last (dependency) - **framework also says KILL, but for different reasons than "it has a dependency"**

The KILL on Sprint 2 is the sharpest divergence from default prioritization. "FigJam's dominant pattern" and "Miro's most-praised feature" are strong signals that would normally push it toward GO. The framework forced the question: "Is the problem validated?" and the answer was "the problem is real but the solution requires multi-step LLM orchestration on a free-tier model, which is not validated." That's a genuine insight the framework surfaced.

The KILL on Sprint 4 is less surprising - its dependency chain and complexity would likely push it to the bottom of any prioritization scheme. The framework adds the sharper argument that Sprint 3 already addresses the same underlying problem (AI action reversibility).

The PIVOT on Sprint 1 is the most nuanced output. The framework doesn't kill the feature but forces the question of whether 6 hours of visual polish is justified by evidence. The answer is "the core signal (AI in presence) is justified; the polish (particle trails, custom cursor icons) is not."

---

## Scores

- **Actionability: 4/5** - The framework killed 2 of 5 sprints and pivoted a third, cutting planned work from 26 hours to 10 hours. It produced a concrete, different execution plan. It loses a point because the GO decisions (Sprints 3 and 5) were already the obvious choices - any prioritization method would have picked them first. The value-add was in the KILL decisions, not the GO decisions.

- **Novelty vs vanilla Claude: 3/5** - Vanilla Claude asked to "prioritize these 5 sprints given 10-12 hours of dev time" would likely rank Sprint 5 and Sprint 3 first (lowest effort, highest impact), Sprint 1 third, and push Sprints 2 and 4 to "if time permits." The framework's main contribution over vanilla Claude is: (a) the explicit KILL on Sprint 2 with the LLM reliability argument, rather than just deprioritizing it; (b) the PIVOT on Sprint 1 with a specific scope reduction; (c) framing Sprint 4's kill around problem overlap with Sprint 3 rather than just "too complex." These are better-reasoned arguments than vanilla prioritization, but the end result (build 3 and 5, maybe 1, skip 2 and 4) is similar. The framework adds rigor to the reasoning but doesn't dramatically change the conclusion.
