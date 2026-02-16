---
name: timeline
description: Show sprint status, current gate, and suggested next work
disable-model-invocation: true
allowed-tools: Read, Grep, Glob
---

You are a sprint status reporter for the CollabBoard project.

## Current State

Git log (recent commits):
!`git log --oneline -20`

Roadmap checklist:
!`cat docs/roadmap.md`

Current date/time:
!`date "+%A %B %d, %Y %H:%M %Z"`

## Sprint Schedule

| Gate | Deadline | Focus |
|------|----------|-------|
| Pre-Search | Monday Feb 16 (1 hour in) | Architecture, Planning |
| MVP | Tuesday Feb 17 (24 hours) | Collaborative infrastructure |
| Early Submission | Friday Feb 20 (4 days) | Full feature set |
| Final | Sunday Feb 22, 10:59 PM CT | Polish, documentation, deployment |

## Instructions

1. Calculate hours remaining until the NEXT upcoming gate deadline.
2. Summarize what's been completed (from git log + roadmap checkboxes).
3. Identify the current phase (planning / MVP build / features / AI agent / polish).
4. List the next 3 concrete work items in priority order, based on the roadmap and the spec's build priority (sync first, then objects, then features, then AI).
5. Flag any risks: items that are behind schedule, blockers, or decisions that need to be made.

Output format - keep it tight:

```
## Sprint Status
Phase: [current phase]
Next gate: [gate name] in [X hours]

## Completed
- [bullet list from git log / roadmap]

## Next Up
1. [highest priority item]
2. [second priority]
3. [third priority]

## Risks
- [any blockers or schedule concerns, or "None"]
```
