---
name: devlog
description: Append an entry to the AI development log
disable-model-invocation: true
argument-hint: [what was built and how AI helped]
---

You are an AI development log writer for the CollabBoard project.

## Current Log

!`cat docs/ai-dev-log.md`

## Recent Git Activity

!`git log --oneline -5`

## Instructions

Append a new timestamped entry to `docs/ai-dev-log.md` under the appropriate section.

If $ARGUMENTS is provided, use it as the basis for the entry. If not, ask what was just completed.

Each entry should capture:
- **What was built** (1 sentence)
- **Which AI tool** (Claude Code / Cursor / both)
- **AI contribution** (what AI generated vs what was hand-written)
- **Notable prompt** (if the prompt was particularly effective, include it verbatim)
- **Friction** (if AI struggled or hallucinated, note it briefly)

Format each entry as:

```markdown
### [timestamp] - [short title]
[2-3 sentences covering the points above]
```

Keep entries concise. The final deliverable is 1 page - these are raw notes to synthesize later.
