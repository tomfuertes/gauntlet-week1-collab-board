# AI Development Log

**Project:** YesAInd - Multiplayer Improv Canvas with AI Agent Integration
**Developer:** Tom Fuertes | **Period:** Feb 16-22, 2026

---

## Tools & Workflow

**Primary:** Claude Code (CLI) with an Opus orchestrator in "CEO Mode" - a structured delegation pattern where the lead model never touches source files. All implementation was delegated to Sonnet/Haiku worker agents spawned into isolated git worktrees.

**Secondary:** Cursor for initial scaffolding and quick edits early in the week before full CEO Mode adoption.

**Workflow pattern:** The human acted as product director; Opus acted as engineering lead; Sonnet/Haiku acted as engineers. Each task was created in a shared TaskList, workers picked up tasks via `TeamCreate`, implemented in a worktree branch, committed, and reported back via `SendMessage`. The lead never blocked - background task injection kept the orchestrator available for user input while agents ran in parallel.

**Supporting tools:** `playwright-cli` for UAT on production, `wrangler` for Cloudflare Workers local dev, custom eval harness (`scripts/prompt-scenarios-diag.ts`) for prompt quality measurement.

---

## MCP Usage

**playwright-cli** was the primary MCP. Used for:

- Two-browser multiplayer sync verification (two named sessions, interacting independently)
- UAT on production (`https://yesaind.com`) after every significant feature
- Accessibility tree snapshots (`playwright-cli snapshot`) for understanding page structure without visual screenshots

Key limitation discovered: `playwright-cli mousedown` sends `{ button: 'undefined' }` which Konva's Stage handler rejects. Canvas interactions requiring mousedown were tested via AI chat commands instead.

No other MCPs were used. Langfuse was integrated directly via its SDK for observability (not as an MCP).

---

## Effective Prompts

**1. Initial AI agent architecture (Feb 16, session f8e4fcae):**

> "Implement the following plan: AI Agent: Workers AI + Board Manipulation. Users type natural language in a chat sidebar, the AI manipulates the board (create stickies, organize content, answer questions), and all connected clients see changes in real-time via the existing WebSocket sync."

Worked because it gave the complete architecture diagram and the key insight: "AI mutations go through the same DO path as user mutations, so LWW + broadcast work automatically."

**2. CEO Mode delegation (Feb 20, session ca0d28f0):**

> "Let's keep going with the swarm of agents on tasks in parallel. Play an agent person was on first principle rather than giving them one task to follow through. And last time all of the agents ran out of context, so try to break tasks up into bite-sized chunks. That can be handled well by Sonnet or Haiku."

This established the parallel delegation pattern that dominated the second half of the week. Breaking tasks small enough for Haiku was the key efficiency unlock.

**3. Server-side layout enforcement (Feb 21, session 0f95fcea):**

> "Move layout correctness from prompt instructions to server-side enforcement. After the AI creates objects via tool calls, the server should validate and fix positions before persisting. This frees the prompt from mechanical spatial rules."

This was the architectural pivot of the week - recognizing that LLMs cannot do spatial reasoning reliably, so the right fix was code, not prompting. Led to the `flowPlace()` auto-layout engine and `enforcedCreate()` validation layer.

**4. Root cause debugging (Feb 22, session 235b2d5e):**

> "The auto-layout engine (flowPlace) should prevent overlap, but eval shows overlap=12 on grid-2x2. Root cause: each createSDKTools closure has its own `aiCreatedBounds` array. When stageManager and main both create objects, they place objects without knowing about each other's positions."

Effective because it provided the diagnosis, not just the symptom. The agent could implement `SharedBounds` immediately without investigation.

**5. Orient and proceed (Feb 22, session 3560dad4):**

> "Read the task list to orient and then let me know where you think we should go. And if you have a strong recommendation, just start doing it in CEO mode."

The most efficient prompt type: trust the orchestrator to triage, recommend, and execute without a checkpoint. Combined with a full TaskList, this kept momentum without requiring constant human direction.

---

## Code Analysis

**Estimated breakdown:** ~95% AI-generated, ~5% human-authored.

Human-written code was limited to: the initial `wrangler.toml` configuration, the first migration SQL, and occasional one-line fixes during debugging that were faster to type than to delegate.

Everything else - 19 AI tools, the eval harness (~800 LOC), the genetic prompt tuner, all React components, the Durable Object architecture, the WebAuthn auth flow, the Langfuse integration, the auto-layout engine - was written by Sonnet or Haiku agents following task descriptions.

The 231 Claude Code sessions across 7 days (33/day average) reflect near-continuous AI-driven development.

---

## Strengths & Limitations

**Where AI excelled:**

- **Parallel execution:** Multiple Sonnet workers in separate git worktrees ran simultaneously on independent tasks. A task that would have taken 2 hours sequentially finished in 30 minutes.
- **Eval pipeline construction:** The LLM-as-judge eval harness (Haiku scoring Haiku's output on 4 dimensions, 7 runs per scenario) was designed and implemented by the AI in a single session. Iteration from 3/10 to 34/35 (97%) layout pass rate happened through AI-driven prompt tuning.
- **Consistent implementation quality:** Workers followed TypeScript strict mode, existing patterns, and code conventions reliably without reminders.
- **Root cause analysis:** Given a clear symptom and relevant files, agents correctly diagnosed non-obvious bugs (shared mutable closure state, batchExecute tool opacity to the AI SDK's toolCalls array).

**Where AI struggled:**

- **Spatial reasoning:** LLMs cannot reliably place objects at non-overlapping coordinates even with explicit rules. "NEVER place overlapping objects" in the system prompt was ignored. Required server-side enforcement (`flowPlace()` auto-layout, zero-tolerance overlap clamping).
- **Sonnet capability inversion:** Sonnet 4 scored 28/35 (80%) vs Haiku 4.5 at 34/35 (97%) on the same prompt. Sonnet's superior reasoning caused elaboration during crisis scenes (full fire scenes) instead of restraint (effects-only). Smarter models needed harder constraints, not softer ones.
- **Context exhaustion:** Long-running workers routinely ran out of context window. Mitigation: break tasks into atomic chunks that Haiku can handle in <20 tool calls, write implementation plans to `$TMPDIR` so orchestrators can read progress on handoff.
- **Hook blindness:** Agents initially missed that `batchExecute` wrapping made tool calls invisible to the AI SDK's `toolCalls[]` array. Required a debugging session to discover and document as a KEY-DECISION comment.

---

## Key Learnings

1. **CEO Mode is a force multiplier, not just automation.** The human directing AI agents is 10x faster than coding directly - but only if the orchestrator has a clear task backlog and gives agents precise, scoped work. Vague tasks produce vague results regardless of model capability.

2. **LLM-as-judge eval is the right feedback loop.** Human evaluation of layout quality was subjective and slow. A Haiku judge scoring Haiku's output on rubric dimensions (yesAnd, characterConsistency, sceneAdvancement, toolAppropriateness) gave a single comparable number across prompt versions. 97% pass rate after 27 prompt iterations with a measurable signal would have been impossible without it.

3. **Smarter models sometimes need harder constraints.** The intuition "use the best model for best results" was wrong in the presence of agent-style tool use. Haiku's limited reasoning kept it on-task; Sonnet's reasoning caused it to elaborate beyond what the task required. Model selection requires empirical eval, not capability assumptions.

4. **Code enforces what prompts only suggest.** Every spatial rule in the system prompt was eventually moved to server-side code (`enforcedCreate`, `flowPlace`, `SharedBounds`). The prompt now focuses on narrative behavior - the only thing code cannot enforce.

5. **Tasks are context lifeboats.** Context compaction can happen at any time. Task descriptions written with zero assumptions (file paths, the problem, the fix approach) let fresh agents pick up mid-task without losing work. This became standard practice after the first context loss.

---

## Hooks & Automation Infrastructure

The CEO Mode workflow is enforced by a system of Claude Code hooks - shell scripts triggered on lifecycle events (session start/end, tool calls, task completion). These hooks are the guardrails that make autonomous multi-agent orchestration safe and productive.

**Full source:** [github.com/tomfuertes/.../claude-code-hooks](https://gist.github.com/tomfuertes/a6d751e509d4d4c1ec841e9970bd65f4)

### Security Hooks

| Hook                   | Event                     | Purpose                                                                                   |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `bash-secrets-warn.sh` | PreToolUse (Bash)         | Blocks API keys/tokens from appearing in shell commands                                   |
| `detect-secrets.sh`    | PreToolUse (Edit/Write)   | Blocks secrets from being written to files, suggests env vars                             |
| `secret-patterns.sh`   | (shared library)          | 25+ regex patterns for AWS, GitHub, Stripe, OpenAI, Anthropic keys, private keys, DB URLs |
| `git-clean-guard.sh`   | PreToolUse (Bash)         | Prevents `git clean -f` which permanently destroys untracked files                        |
| `npm-malware-scan.sh`  | SessionStart + PreToolUse | Detects supply-chain malware (Shai-Hulud campaign, Sep-Oct 2025)                          |

### Team Orchestration Hooks

| Hook                        | Event             | Purpose                                                                                         |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `force-background-tasks.sh` | PreToolUse (Task) | Injects `run_in_background: true` into named teammate spawns so the lead never blocks           |
| `ceo-stop-guard.sh`         | Stop              | Prevents lead from stopping session while workers are active                                    |
| `task-completion-gate.sh`   | TaskCompleted     | Enforces structured metadata (changes, learnings, risks) before workers can mark tasks complete |
| `task-call-logger.sh`       | PreToolUse (Task) | Diagnostic logger for debugging team orchestration issues                                       |

### Knowledge Management Hooks

| Hook                     | Event      | Purpose                                                                                 |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| `session-end-promote.sh` | SessionEnd | Auto-promotes learnings appearing in 2+ completed tasks to CLAUDE.md with deduplication |

### How They Wire Together

`settings.json` registers hooks across lifecycle events. The key innovation is the **task completion gate**: workers must report structured metadata (`changes`, `learnings`, `failed_approaches`, `loose_ends`, `risks`) before marking a task complete. The session-end hook then scans all completed tasks and auto-promotes recurring patterns to CLAUDE.md - creating a self-improving knowledge base across sessions.

The **force-background-tasks** hook is what makes CEO Mode non-blocking. It detects teammate spawns (by the presence of the `name` parameter) and injects `run_in_background: true`, ensuring the lead agent stays available for user input while workers execute in parallel.
