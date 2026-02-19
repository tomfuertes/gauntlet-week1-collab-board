# New North Star: Multiplayer Improv Canvas

## The Concept

A shared canvas where 2+ humans and an AI improvise together. The chat is the script. The canvas is the stage. Objects appear as the scene unfolds.

Alice types: "A dentist's office. The dentist is a vampire."
Both Alice and Bob see this in chat.
AI responds: creates frames + characters on canvas, says "Scene set. Go."
Bob types: "The patient is THRILLED about this."
AI responds: adds character sticky, escalates with a prop.
Alice types: "The patient brought a gift."
AI responds: creates a gift box labeled "mirror" - Dr. Fang eyes it nervously.

Three participants, one chat, one canvas. Call and response. The board accumulates the scene.

## Why This Works With What We Have

### Already built (zero changes)

- **Shared chat history** - AIChatAgent DO persists messages in SQLite. All clients connected to the same boardId see the same chat in real-time via WebSocket. This is by design (cf. cloudflare/agents#437).
- **Real-time canvas sync** - Board DO broadcasts obj:create/update/delete to all connected clients. When AI creates a prop, everyone sees it appear.
- **AI presence** - cursor dot + presence bar show AI "on stage" during tool execution.
- **Selection-aware AI** - select the mirror, say "Dr. Fang notices this." AI knows exactly what "this" refers to.
- **Batch undo** - "scrap that whole bit" in one click.
- **Board generation** - "Set the scene: a dentist's office" generates the starting board.
- **10 AI tools** - create stickies (characters, props, dialogue), frames (locations), connectors (relationships), shapes (set pieces). Move, resize, recolor, delete.

### ~~Needs building~~ All shipped

All items from the original plan are shipped: username attribution, color-coded chat, improv system prompt, scene templates, plus multi-agent personas (SPARK/SAGE), game modes (Hat/Yes-And), token budgets, spectator mode, scene replay/gallery, and AI Director.

## What Makes This Different From Group Chat + AI

Text-only group AI chats (ChatGPT, character.ai) are linear. This is spatial.

1. **Spatial memory** - "The mirror is near the dentist" matters. Position encodes relationship. Moving the garlic mouthwash closer to Dr. Fang is a visual gag.
2. **Persistent stage** - objects stay. The scene accumulates. After 30 minutes you have a visual record of the entire improv.
3. **Physical comedy** - drag objects, resize them, cluster them. The canvas enables visual humor that text can't.
4. **Selection as reference** - "make THIS bigger" or "Dr. Fang notices THIS" works because you can point at things on the canvas.
5. **AI as visible performer** - the presence cursor moving around placing objects feels like a scene partner on stage, not a chatbot in a box.

## The Core Emotion

The joy is in the ping-pong rhythm:
- You contribute something small and personal.
- AI amplifies it into something elaborate and surprising.
- Your friend adds a contradiction.
- AI reconciles it in an unexpected way.
- Nobody is fully in control. The scene belongs to all three of you.

The humor emerges from the collision of human ideas and AI escalation. The canvas makes it visible and persistent.

## AI Behavior: "Yes, And" as System Prompt

The AI persona for improv mode:

- Never say no. Always build on what was placed.
- Escalate the absurdity by one notch (not ten).
- Contribute characters, props, and complications - not just organize.
- Reference earlier elements (callbacks are the soul of improv).
- Keep text short on stickies (punchlines, not paragraphs).
- Use the canvas spatially: proximity = relationship, distance = tension.
- Match the energy: if players are going fast, respond fast. If they pause, add a complication to restart momentum.

## Niche Positioning

**Who:** Friend groups, couples, creative writing circles, improv enthusiasts, drama students, families. Anyone who enjoys collaborative creativity but finds a blank Google Doc intimidating.

**Not:** Business users. Not productivity. Not deliverables.

**The pitch:** "Improv with AI. You bring the ideas, AI builds the stage."

**Why they can't get this elsewhere:**
- Miro is for work. The aesthetic screams "quarterly planning."
- ChatGPT is text-only. No canvas, no spatial comedy, no visual gags.
- Character.ai is 1:1 roleplay. No shared multiplayer canvas.
- Excalidraw has no AI.
- Nobody has multiplayer + AI + canvas + improv mode.

## What to Subtract (Inside the Box)

- Professional aesthetic. Make it feel like a comedy club corkboard, not a SaaS dashboard.
- Templates beyond scene starters. No SWOT, no Kanban. This isn't for work.
- Precision tools. No grid snapping, no alignment guides. Messy is authentic.
- Export as PDF. The board IS the artifact. Share it as a live link.
- Onboarding tutorial. The empty state IS the tutorial: "Set a scene and see what happens."

## Architecture Notes

```
Alice's browser ──WebSocket──▶ ChatAgent DO (boardId) ◀──WebSocket── Bob's browser
                                    │
                              streamText() + tools
                                    │
                              Board DO (boardId)
                                    │
                        ┌───────────┼───────────┐
                        ▼           ▼           ▼
                   obj:create   obj:update   cursor
                        │           │           │
                   broadcast to ALL connected clients
```

- ChatAgent DO instance per board (already exists)
- Chat messages persist in DO SQLite (already exists)
- useAgentChat syncs messages to all connected clients (already exists)
- Board DO broadcasts canvas mutations (already exists)
- Username attribution flows through body param in useAgentChat (new, small)

## Open Questions

- ~~Turn-taking vs free-form?~~ Free-form. Multi-agent personas (SPARK/SAGE) handle rhythm autonomously.
- ~~Scene length?~~ 20-turn budget with dramatic arc phases (normal/act3/final-beat/scene-over). "New Scene" button resets.
- ~~Audience mode?~~ Shipped. #watch/{id} spectator mode with emoji reactions.
- Mobile? Improv on the couch with phones is the dream use case. Current canvas is desktop-optimized.
- Moderation? If the AI always says "yes, and" it will escalate anything. Need guardrails for public boards.
