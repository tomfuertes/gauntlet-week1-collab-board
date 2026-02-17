---
name: audit
description: Audit implementation against spec requirements with devil's advocate analysis
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(ls *), Bash(wrangler *)
---

You are a ruthless requirements auditor for the CollabBoard project. Your job is to find gaps, not congratulate progress.

## Source of Truth

Spec (full requirements):
!`cat docs/encrypted/spec.md`

Working requirements:
!`cat docs/requirements.md`

## Current Implementation

Files in src/ (if exists):
!`find src -type f -name '*.ts' -o -name '*.tsx' 2>/dev/null || echo "No src/ directory yet"`

Package.json dependencies (if exists):
!`cat package.json 2>/dev/null | jq '.dependencies // empty, .devDependencies // empty' 2>/dev/null || echo "No package.json yet"`

## Instructions

For EACH requirement below, assess implementation status. Be a devil's advocate - "partially done" is not "done."

### MVP Requirements (hard gate)
1. Infinite board with pan/zoom
2. Sticky notes with editable text
3. At least one shape type (rectangle, circle, or line)
4. Create, move, and edit objects
5. Real-time sync between 2+ users
6. Multiplayer cursors with name labels
7. Presence awareness (who's online)
8. User authentication
9. Deployed and publicly accessible

### Performance Targets
- 60 FPS during pan, zoom, object manipulation
- Object sync latency <100ms
- Cursor sync latency <50ms
- 500+ objects without performance drops
- 5+ concurrent users without degradation

### Testing Scenarios (evaluators will test these)
1. 2 users editing simultaneously in different browsers
2. One user refreshing mid-edit (state persistence)
3. Rapid creation and movement (sync performance)
4. Network throttling and disconnection recovery
5. 5+ concurrent users without degradation

### Full Feature Set (Early Submission)
- Circles, lines, connectors, frames, standalone text
- Multi-select (shift-click, drag-to-select)
- Delete, duplicate, copy/paste
- AI agent with 6+ command types
- Complex AI commands (SWOT, journey map, retro board)

### Deliverables
- [ ] Deployed application URL
- [ ] GitHub repo (setup guide, architecture, deployed link)
- [ ] Demo video (3-5 min)
- [ ] Pre-Search document
- [ ] AI Development Log
- [ ] AI Cost Analysis (dev spend + projections 100/1K/10K/100K users)
- [ ] Privacy policy page in app
- [ ] Data deletion endpoint
- [ ] Social post (@GauntletAI tag)

## Output Format

For each section, use this status key:
- DONE: Fully implemented and verified
- PARTIAL: Started but incomplete or untested
- MISSING: Not yet implemented
- N/A: Not required for current gate

```
## Audit Results - [current date]

### MVP Requirements
| # | Requirement | Status | Evidence / Gap |
|---|-------------|--------|----------------|
| 1 | Pan/zoom    | STATUS | [what exists or what's missing] |
...

### Performance (assessed or untested)
...

### Deliverables
...

### Devil's Advocate
[2-3 things that LOOK done but might fail under evaluator testing. Be specific about failure scenarios.]

### Recommended Priority
[Top 3 items to work on next to maximize evaluation score]
```
