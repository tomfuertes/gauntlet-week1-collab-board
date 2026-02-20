# Plan: Quality Exploration Swarm - UX Feel + AI Output Audit

## Context

All major features are code-shipped but only lightly verified. The bottleneck is manual playtesting - the user has to play scenes, notice quality gaps, then queue feedback piecemeal. Goal: parallelize this with a team of exploration agents that play through real scenes, evaluate the *feel* of the experience (not just functional correctness), and report structured findings the user can scan and prioritize.

This is product exploration, not pass/fail testing. Each agent evaluates engagement, momentum, and coherence - not just "did it create a frame."

## Prerequisites

1. Dev server running on localhost:5173 (main repo, `npm run dev`)
2. All agents use `dangerouslyDisableSandbox: true` for playwright-cli and wrangler d1
3. All agents namespace sessions: `-s=<agent-name>`
4. Screenshots to `.playwright-cli/<agent-name>-*.png`

## Shared Agent Preamble (prepend to every agent prompt)

Every agent gets these common instructions:

```
You are a quality exploration agent for CollabBoard, a multiplayer improv canvas.
Your job is NOT pass/fail testing - it's deep research into the UX quality of the
AI-powered improv experience. You iterate, form hypotheses, and test them.

## Tools at your disposal

1. **playwright-cli** - browser automation (auth, navigate, interact, snapshot, screenshot)
   - Namespace sessions: -s=<your-agent-name>
   - Screenshots to .playwright-cli/<your-agent-name>-*.png
   - dangerouslyDisableSandbox: true for all playwright-cli commands
   - After navigating to a board, WAIT for [data-state="connected"] before interacting

2. **Eval API** - structured board object data + quality metrics
   scripts/localcurl.sh http://localhost:5173/api/boards/<id>/objects | jq .
   Returns: { objects: [{id, type, x, y, width, height, props: {text, color, fill}, createdBy}], metrics: {total, overlapScore, outOfBounds} }
   Use jq to analyze: jq '[.objects[] | {type, text: .props.text, color: .props.color, x, y}]'

3. **D1 Traces** - what prompt was assembled, what tools were called
   npm run traces -- board <board_id>    # all traces for a board
   npm run traces -- prompt <trace_id>   # full assembled system prompt for one trace
   npm run traces -- tools               # tool call frequency
   Use dangerouslyDisableSandbox: true for wrangler d1 commands

4. **playwright-cli snapshots** - YAML accessibility trees (cheaper than screenshots)
   Use for all content verification. Screenshots only for visual layout checks.

## Auth flow
1. Open http://localhost:5173
2. Click "Need an account? Sign up"
3. Fill username: explore-<your-name>-<timestamp>, password: password123
4. Click "Sign Up" -> redirected to BoardList

## Iteration Protocol (MANDATORY - do NOT skip)

Round 1: EXPLORE
  - Play a scene (template or freeform prompt)
  - After AI responds, get structured data:
    a. Board ID from URL hash (#board/<id>)
    b. Eval API: scripts/localcurl.sh http://localhost:5173/api/boards/<id>/objects | jq .
    c. Traces: npm run traces -- board <id>
  - Identify 2-3 specific quality issues (not vague - exact text, positions, colors)

Round 2: HYPOTHESIZE + TEST
  - For each issue, form a hypothesis about WHY
  - Check the assembled prompt: npm run traces -- prompt <trace_id>
  - Create a NEW board and change one variable to test your hypothesis
  - Compare eval metrics between boards (overlap, object count, outOfBounds)

Round 3: EVIDENCE + RECOMMEND
  - For each finding: the issue, the root cause (with trace evidence), and a specific fix
  - Fixes must be one of:
    a. Prompt text change (include the exact old text → new text)
    b. Code/architectural change (describe what needs to change and why)
    c. Model recommendation (which model handles this better, with comparison data)
  - Flag your top 3 screenshots with [KEY SCREENSHOT] tag

## Reporting format

Send your report via SendMessage to team-lead. Structure:

## <Agent Name> Quality Report

### Finding 1: <one-line summary>
- **What I saw:** <specific observation with object texts/colors>
- **Root cause:** <trace evidence - what prompt was injected, what tools were called>
- **Comparison:** <board A vs board B metrics from eval API>
- **Recommended fix:** <exact prompt change OR code change OR model recommendation>

### Finding 2: ...

### Top 3 Screenshots
1. .playwright-cli/<name>.png - <what it shows>
2. ...

### Raw Data
- Board IDs tested: <list>
- Trace IDs referenced: <list>
- Eval metrics summary: <table>
```

## Agent Type

**Do NOT use the `uat` agent type.** It's optimized for pass/fail functional testing (haiku model, "PASS/FAIL" reporting). These exploration agents need to evaluate creative output quality, narrative coherence, and UX feel - that requires `general-purpose` with `model: "sonnet"`.

Each agent gets the playwright-cli mechanics in its prompt (auth flow, snapshot usage, session namespacing) plus the specific exploration questions and reporting format.

## Team: `quality-exploration`

### Agent 1: `first-impression` (sonnet)
**Question:** What does a brand-new user experience in the first 60 seconds?

Flow:
1. Signup with fresh user
2. See BoardList - what's the first impression? Is it inviting or empty?
3. Create a board - does it feel seamless or clunky?
4. OnboardModal appears - is the game mode / character / model choice overwhelming or exciting?
5. Pick Freeform + SPARK + GLM 4.7 Flash (defaults)
6. Click "Vampire Dentist" template chip
7. Watch the scene set up - does it feel like a curtain rising or a loading screen?
8. Evaluate: how long until something interesting is on the canvas? Does the board feel alive?
9. Screenshot the scene setup result

**Report focus:** Time-to-delight. First impression friction. Does the onboarding flow build anticipation?

### Agent 2: `scene-arc` (sonnet)
**Question:** Does a full scene feel like improv or like talking to a chatbot?

Flow:
1. Auth, create board, Freeform + Anyone + GLM
2. Click "Cat Restaurant" template - let scene set up
3. Play 12+ exchanges using intent chips in order:
   - Exchange 1-2: type a response ("The cat waiter brings a menu written in paw prints")
   - Exchange 3: click "What happens next?"
   - Exchange 5: click "A stranger walks in"
   - Exchange 7: click "Plot twist!"
   - Exchange 9: click "Complicate everything"
   - Exchange 11: click "The stakes just got higher"
   - Exchange 13+: click "Meanwhile, elsewhere..."
4. At each step evaluate:
   - Does the AI build on what came before or start fresh?
   - Do intent chips feel like improv moves or random generators?
   - Is there a sense of escalation / momentum building?
   - Does the board tell a visual story or just accumulate clutter?
5. Continue to 18+ exchanges - observe Act 3 / Finale badges
6. Reach scene-over - evaluate: does the ending feel like a bow or an abrupt stop?
7. Click "New Scene" - does it feel like a fresh start or a reset?
8. Screenshot at exchanges 1, 5, 10, 15, scene-over

**Report focus:** Narrative momentum. Does the arc feel shaped or random? Where does engagement peak/drop? Does the board become cluttered or stay readable?

### Agent 3: `persona-chemistry` (sonnet)
**Question:** Do SPARK and SAGE feel like distinct improv partners, or interchangeable chatbots?

Flow:
1. Auth, create board, Freeform + claim SPARK + GLM
2. Click "Superhero HOA" template
3. Play 4 exchanges as SPARK's partner - note SPARK's voice, object colors, escalation style
4. Wait for reactive SAGE response (2nd+ exchange, wait 45-60s) - note contrast
5. Screenshot the board showing both personas' contributions
6. New board - claim SAGE instead, same template
7. Play 4 exchanges - compare SAGE's approach to SPARK's
8. Evaluate:
   - Are their voices distinct in chat text? (SPARK: punchy vs SAGE: wry)
   - Do they create different types of objects? (SPARK: red stickies, chaos vs SAGE: green/blue, connections)
   - Does reactive persona add to the scene or just clutter it?
   - Does claiming a persona feel like choosing an improv partner or a skin?
9. New board - create custom persona via gear icon:
   - Name: "CHAOS", Trait: "You are CHAOS, a reckless wildcard who breaks the fourth wall and talks directly to the audience", Color: purple
   - Play 3 exchanges - does the custom persona feel distinct from defaults?
   - Delete custom persona - verify defaults return

**Report focus:** Character distinctness. Reactive persona value-add. Custom persona expressiveness. Does the persona system enhance improv or just add names?

### Agent 4: `game-modes` (sonnet)
**Question:** Do Hat and Yes-And modes feel like different improv games, or just different labels?

Flow:
1. Auth, create board
2. **Hat mode:** Select "Scenes From a Hat" in OnboardModal, click "Draw from the hat"
   - Observe: what prompt was drawn? Does the scene setup match it?
   - Play 3 exchanges responding to the prompt
   - Click "Next prompt" (sends [NEXT-HAT-PROMPT]) - does the transition feel like a host pulling a new slip, or a jarring reset?
   - Play 2 more exchanges on new prompt
   - Does the 5-exchange limit per prompt feel right? Too short? Too long?
   - Screenshot each prompt's scene
3. **Yes-And mode:** New board, select "Yes-And Chain"
   - Does the AI actually start with "Yes, and..."?
   - Play 6 exchanges - does each beat genuinely build on the last?
   - Does the beat counter (X of 10) create useful pressure or anxiety?
   - Does "Escalate!" chip feel different from normal "Yes, and..."?
   - Screenshot at beat 1, 5, and the chain end
4. **Compare to Freeform:** New board, Freeform, same opening prompt
   - Same template, compare the feeling - is Freeform more freeing or less guided?

**Report focus:** Mode distinctness. Does each mode create a different energy? Are the constraints fun or frustrating? Does Hat mode feel like a party game?

### Agent 5: `visual-storytelling` (sonnet)
**Question:** Does the canvas tell a visual story, or is it just a dump of cards?

Flow:
1. Auth, create board, Freeform + Anyone + GLM
2. Click "Time Travel Cafe" template
3. Observe the initial layout:
   - Is there a frame? Does it feel like a stage?
   - Are characters placed inside the frame or scattered?
   - Do the sticky colors convey meaning (character types, emotions)?
   - Is there visual hierarchy (frame > characters > props)?
4. Play 5 exchanges with typed prompts that test spatial awareness:
   - "The medieval knight knocks over a table"
   - "A portal opens in the back corner of the cafe"
   - Click "Meanwhile, elsewhere..." - does the new frame land in empty space?
   - "The Victorian lady storms out through the portal"
5. Evaluate the board at each step:
   - Does the AI place new objects in contextually appropriate positions?
   - Does "Meanwhile elsewhere" create a visually separate area?
   - Are connectors/arrows used to show relationships?
   - Does the board read left-to-right or top-to-bottom as a narrative?
   - Is there a sense of spatial storytelling or just random placement?
6. Try "draw a penguin" and 2 other image prompts - do images enhance the scene or distract?
7. Screenshot at setup, mid-scene, and "cluttered" state

**Report focus:** Spatial coherence. Visual narrative. Object placement quality. Does the canvas feel like a stage or a whiteboard? Where does clutter begin?

### Agent 6: `cross-model-feel` (sonnet)
**Question:** Do different AI models produce noticeably different improv experiences?

Flow:
1. Auth, create 3 boards with same template ("Pirate Therapy") but different models:
   - Board 1: GLM 4.7 Flash (cheapest, current default)
   - Board 2: GPT-4o Mini
   - Board 3: Claude Haiku 4.5 (if ANTHROPIC_API_KEY set; skip if not)
2. On each board, play the exact same 5-exchange script:
   - Template: "Pirate Therapy"
   - Exchange 1: "The therapist asks Captain Blackbeard about his feelings"
   - Exchange 2: click "What happens next?"
   - Exchange 3: "Another pirate bursts in crying about their parrot"
   - Exchange 4: click "Plot twist!"
   - Exchange 5: click "Complicate everything"
3. Compare across boards:
   - Response quality: which model produces the best improv text?
   - Tool usage: which model creates the most interesting objects?
   - Object placement: which model places things most coherently?
   - Response time: which feels responsive vs sluggish?
   - Voice: which model best embodies the persona?
   - batchExecute usage: which model uses it for multi-object creation?
4. Screenshot each board's final state side by side

**Report focus:** Model comparison matrix. Which model produces the best improv experience? Is the cheapest model good enough? Is paying more noticeably better?

### Agent 7: `mobile-experience` (sonnet)
**Question:** Does mobile feel like a first-class experience or a cramped desktop?

Flow:
1. Auth at mobile viewport (375x812, iPhone-sized)
2. Create board - does BoardList work on mobile?
3. OnboardModal - does it fit? Are tap targets big enough (44px)?
4. Scene starts - verify:
   - Chat is primary (full-width), canvas preview strip at top
   - Can you see what's on the canvas from the preview strip?
   - Is the preview strip useful or just decoration?
   - Can you tap to expand canvas? Does it feel natural?
5. Play 4 exchanges - evaluate:
   - Is the chat input comfortable to type in?
   - Do intent chips scroll horizontally? Are they easy to tap?
   - Can you read AI responses without squinting?
   - Does the persona claim picker work on mobile?
6. Switch to landscape - does it adapt?
7. Screenshot portrait chat, portrait canvas expanded, landscape

**Report focus:** Mobile-first feel. Touch target quality. Is the canvas preview useful? Does mobile chat feel like texting with an improv partner?

### Agent 8: `prompt-eval-harness` (atomic background Bash)
**Separate from team.** Run `npx tsx scripts/prompt-eval.ts` against the dev server. Report inBounds/overlap scores as a baseline for v6 prompts.

## Cross-Agent Communication

Agents should message the team when findings affect other agents' work:
- "SPARK uses yellow stickies instead of red" → broadcast so all agents can check persona colors
- "getBoardState not called before Plot Twist tool calls" → message scene-arc and visual-storytelling
- "GPT-4o Mini produces dramatically better improv than GLM" → message team-lead immediately

The orchestrator can also redirect agents mid-run: "Agent 3, your persona finding is interesting - can you test whether custom personas are better than defaults at maintaining voice?"

## Execution - Phase 1: Explore

1. Start dev server: `npm run dev` (background) + `npm run health`
2. `TeamCreate("quality-exploration")`
3. `TaskCreate` for each of the 7 agents + 1 background task
4. Spawn all agents simultaneously - each creates their own boards
5. Each agent iterates through 2-3 boards (Round 1 → Round 2 → Round 3 per the protocol)
6. Agents report findings via `SendMessage` as they go (not just at the end)
7. Orchestrator reads incoming findings, cross-pollinates between agents, redirects if needed
8. Orchestrator synthesizes into three buckets:
   - **Prompt fixes** (quick - exact text changes with trace evidence)
   - **Architectural gaps** (need design)
   - **Feature proposals** (new ideas)
9. Surface key screenshots to user for visual triage
10. Shutdown exploration team

## Execution - Phase 2: Fix + Verify (post-exploration)

After user reviews Phase 1 findings:

1. For each approved prompt fix: spawn a worktree agent (`scripts/worktree.sh create prompt-fix-<name>`)
   - Agent modifies prompts.ts with the specific text change
   - Runs typecheck + lint
   - Starts dev server on worktree port
   - Replays the same scenario that revealed the issue
   - Gets eval API metrics + traces on the fix
   - Reports: "before: overlapScore 0.35, after: overlapScore 0.12"
2. Orchestrator merges fixes that improve metrics
3. Optional Phase 3: re-run targeted exploration agents against merged main to confirm fixes stuck

## Key Files (read-only for agents, via snapshots)

- `src/shared/board-templates.ts` - 7 template prompts
- `src/server/prompts.ts` - v6 modular prompts, scene phases, budget phases
- `src/server/chat-agent.ts` - game mode logic, hat/yesand handlers, reactive persona
- `src/client/components/ChatPanel.tsx` - intent chips, persona picker, v6 intent body
- `src/client/components/OnboardModal.tsx` - game mode / character / model selection
- `src/shared/types.ts` - DEFAULT_PERSONAS (SPARK/SAGE), AI_MODELS (8 models)

## Auth Details (for agent prompts)

- Signup: fill username + password on login page, click "Need an account? Sign up", fill fields, click "Sign Up"
- Login: fill username + password, click "Sign In"
- Each agent uses unique username: `explore-<agent-name>-{timestamp}` / `password123`

## What Success Looks Like

The user gets a quality map they can scan in 5 minutes - specific findings like "scene setup on Cat Restaurant felt like a loading screen because all 6 stickies appeared at once with no visual hierarchy" or "SPARK and SAGE both created yellow stickies despite different color specs" or "Hat mode prompt transition was jarring - felt like a page refresh not a host pulling a new slip." Each finding is actionable: prompt change, code change, or new feature.
