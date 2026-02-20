---
name: sprint
description: Start a 1-hour sprint session. Creates a team with architect, game designer, and on-demand implementers/UAT agents. Hydrates task list from docs/notes.md backlog. Use when starting a focused work session.
disable-model-invocation: true
argument-hint: "[focus-area]"
---

# Sprint - 1-Hour Focused Session

You are starting a sprint session. A sprint is a ~1 hour focused work block with a team of specialists.

## Context Loading

1. Read `docs/notes.md` for current backlog (loose ends, unshipped, tech debt)
2. Read `CLAUDE.md` for architecture context
3. Run `git log --oneline -10` for recent momentum
4. If `$ARGUMENTS` is provided, use it as the sprint focus area

## Team Setup

Create team `gauntlet-week-one` via `TeamCreate`. Then spawn **warm advisory agents**:

### CRITICAL: All agents MUST be team members

**NEVER use `run_in_background: true` for sprint work.** Every agent spawned during a sprint MUST include `team_name: "gauntlet-week-one"` and a `name` parameter. This makes them team members who communicate via `SendMessage`. Background agents are opaque - they can't report blockers, can't be redirected, and haiku ones spin forever on failures.

The ONLY exception: a truly atomic one-shot with zero possible blockers (e.g., `npm run typecheck`).

### Warm Agents (spawn immediately)

**Architect** - `Task(name: "architect", team_name: "gauntlet-week-one", subagent_type: "general-purpose", model: "sonnet", mode: "bypassPermissions")`
- Reads code, designs solutions, stress-tests approaches
- Never writes code directly - produces specs and design docs
- Prompt: "You are the Architect for CollabBoard. Read CLAUDE.md and docs/notes.md. Your role: design solutions, review approaches, stress-test ideas. You produce specs, not code. When assigned a task via TaskGet, analyze it and produce a design spec as a SendMessage to the team lead. Always consider: existing patterns, DO hibernation constraints, WS protocol compatibility, and canvas bounds. Wait for task assignment."

**Game Designer** - `Task(name: "game-designer", team_name: "gauntlet-week-one", subagent_type: "general-purpose", model: "sonnet", mode: "bypassPermissions")`
- Owns improv mechanics, persona behavior, scene lifecycle
- Translates creative ideas into acceptance criteria
- Prompt: "You are the Game Designer for CollabBoard. Read CLAUDE.md, docs/notes.md, and docs/new-north-star.md. Your role: translate creative ideas into actionable specs with acceptance criteria. You understand improv games, persona dynamics, scene phases, and audience experience. When assigned a task, produce a spec with: user story, acceptance criteria, edge cases, and how it fits the improv canvas vision. SendMessage results to team lead. Wait for task assignment."

### On-Demand Agents (spawn when tasks need them)

**Implementer Alpha/Beta** - `Task(name: "impl-alpha", team_name: "gauntlet-week-one", subagent_type: "general-purpose", model: "sonnet", mode: "bypassPermissions")`
- Full lifecycle: implement -> PR review -> fix -> UAT -> commit
- Use `claude -w <branch>` for isolated worktree work, or `isolation: "worktree"` for team members
- Each gets a focused prompt with the spec from architect/game-designer
- Reports "ready to merge" via SendMessage when done

**UAT Local** - `Task(name: "uat-local", team_name: "gauntlet-week-one", subagent_type: "uat", model: "haiku", mode: "bypassPermissions")`
- Post-merge smoke tests against localhost
- Namespace playwright sessions: `-s=uat-local`

**UAT Prod** - `Task(name: "uat-prod", team_name: "gauntlet-week-one", subagent_type: "uat", model: "haiku", mode: "bypassPermissions")`
- Post-deploy validation against `https://collabboard.thomas-fuertes.workers.dev`
- Namespace playwright sessions: `-s=uat-prod`

## Task Hydration

After team creation, seed the task list from `docs/notes.md`:

1. Parse Loose Ends, Unshipped, and Tech Debt sections
2. `TaskCreate` for each item with:
   - `subject`: imperative action (e.g., "Wire up maxPersistedMessages in ChatAgent")
   - `description`: full context from notes.md + relevant CLAUDE.md sections
   - `activeForm`: present continuous (e.g., "Wiring up maxPersistedMessages")
   - `metadata`: `{ source: "notes.md", section: "unshipped|tech-debt|loose-ends", priority: "high|medium|low" }`
3. If `$ARGUMENTS` specifies a focus area, prioritize matching tasks

## Pipeline Pattern

For implementation tasks, create dependency chains:
```
TaskCreate("Design: <feature>")                          → architect or game-designer
TaskCreate("Implement: <feature>", blockedBy: [design])  → impl-alpha or impl-beta
TaskCreate("UAT: <feature>", blockedBy: [implement])     → uat-local or uat-prod
```

## Sprint Flow

1. Present the hydrated task list to the user
2. Ask which tasks to focus on this sprint (or use `$ARGUMENTS`)
3. Assign design tasks to warm advisors
4. When specs come back, spin up implementers in worktrees
5. When implementers report ready-to-merge, review diffs in main context
6. After merge, spawn UAT agents
7. Triage UAT failures back to implementers or create new tasks

## Session End

When the user signals sprint is over (or ~1 hour elapsed):
1. `TaskList` to capture final state
2. Update `docs/notes.md` with any new loose ends
3. `SendMessage(type: "shutdown_request")` to all active agents
4. `TeamDelete` after all agents confirm shutdown

## Key Rules

- **Orchestrator stays thin**: main context for decisions, not execution
- **Never merge in sub-agents**: always merge worktree branches from main context
- **Pipeline chains handle handoffs**: use `addBlockedBy` so you don't babysit
- **Deploy via git push**: never `wrangler deploy` manually
- **Prove it works**: every task must demonstrate correctness before completion
