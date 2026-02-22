# YesAInd Demo Video Script

**Target:** 3-5 minutes | **Required beats:** Real-time collaboration, AI commands, architecture explanation

---

## COLD OPEN (0:00 - 0:20)

> "What if AI wasn't a tool you used, but a scene partner you performed with?"

Show the landing page at yesaind.com. Quick shot of the board list.

> "YesAInd is a multiplayer improv canvas. Players and AI personas improvise scenes together in real time - creating characters, locations, and drama on a shared stage."

---

## ACT 1: BOARD CREATION + AI SCENE SETUP (0:20 - 1:30)

**Create a new board:**

- Click "Create Board"
- Name it something fun: "Pirate Therapy Session"
- Select **Yes, And** mode (beginner) and the **Pirate Therapy** template
- Show the troupe setup: SPARK and SAGE personas, Haiku model selector

**First AI interaction:**

- Type: "Set the scene - a pirate captain walks into a therapy office"
- **Show the canvas updating live** - objects appear with the purple AI cursor animating to each placement
- Point out: frame for the location, character objects inside it, dialogue text
- Mention: "The AI doesn't choose coordinates. A server-side auto-layout engine called flowPlace shelf-packs objects with 16px gaps. LLMs can't do spatial reasoning - we learned that the hard way."

**Follow up with a complication:**

- Type: "The therapist is actually a kraken in disguise!"
- Show SAGE (reactive persona) automatically responding - a second round of objects appears without the player asking
- Point out: sound effects, highlight effects, the "yes and" behavior

---

## ACT 2: MULTIPLAYER SYNC (1:30 - 2:30)

**Open a second browser window** (or incognito):

- Register a second user
- Join the same board via invite link or board list
- Show both cursors moving in real time with name labels

**Demonstrate simultaneous interaction:**

- Player 2 types an AI command: "Add a treasure chest that's actually a mimic"
- Show objects appearing on BOTH screens simultaneously
- Player 1 drags an object - show the move syncing to Player 2's screen instantly

> "Every mutation - whether from a player or the AI - goes through the same Durable Object. Optimistic local updates, then the DO persists and broadcasts to everyone else. Last-write-wins, same path for human and AI."

**Show presence:**

- Point out the online user indicators
- Disconnect one browser (close tab), show the presence updating

---

## ACT 3: SPECTATOR MODE + AUDIENCE FEATURES (2:30 - 3:15)

**Open spectator view:**

- Open a third tab or incognito window (no login required)
- Navigate to the watch URL: `#watch/<boardId>`
- Show the read-only canvas updating live as the scene continues

> "Spectators connect via a separate read-only WebSocket. No auth required. They see every canvas mutation in real time."

**Audience interactions:**

- Send emoji reactions from the spectator view - show them appearing
- If a poll is active, vote from the spectator view

---

## ACT 4: AI SHOW - THE HEADLINE FEATURE (3:15 - 4:15)

**Navigate back to board list:**

- Click "Watch a Show"
- Show the ShowPickerModal with 6 premise cards
- Select: "A chef's souffle becomes sentient right before a Michelin judge arrives"
- Click "Start Show"

> "This is fully autonomous. Two AI personas - SPARK and SAGE - take turns creating the scene. No human input. The server uses Durable Object alarms to fire each turn every 10 seconds. 12 turns, about 2 minutes, and you get a complete improv scene."

**Watch the show unfold:**

- Show objects appearing on the canvas turn by turn
- Point out the alternating personas (different creation styles)
- The scene builds: setup, complication, crisis, resolution
- Final turn: curtain call with applause sound effect

> "After it ends, the whole thing is replayable. Every mutation was recorded as a replay event."

---

## ACT 5: ARCHITECTURE (4:15 - 4:45)

Quick diagram or verbal walkthrough (can show code or a whiteboard sketch):

> "The stack: React + Konva on the front end, Cloudflare Workers + Hono on the back, Durable Objects for real-time state."

Hit these points:

- **Board DO**: one per board, manages object storage + WS broadcast
- **ChatAgent DO**: handles AI chat, persona routing, tool execution
- **ShowAgent DO**: alarm-driven autonomous show loop
- **19 AI tools**: createPerson, drawScene, highlightObject, play_sfx, askAudience, etc.
- **flowPlace**: server-side auto-layout (LLM says _what_, code decides _where_)
- **Eval pipeline**: LLM-as-judge, 35 scenarios, 97% pass rate on Haiku

> "The prompt went through 27 versions. Every change was measured by an automated eval suite. The biggest lesson: code enforces what prompts only suggest."

---

## CLOSE (4:45 - 5:00)

> "YesAInd treats AI as an ensemble member, not a director. It yes-ands. It reacts. It performs. Built in 6 days with Claude Code and an army of AI agents - because the best way to build with AI is to build _like_ AI: delegate, measure, iterate."

Show the URL: **yesaind.com**

---

## FALLBACK PLAN

If AI is slow or errors during recording:

- **Pre-record the AI interactions** and screen-record the canvas populating. Voice over live.
- The AI Show feature is the most reliable segment (server-driven, no user input needed) - lead with that if interactive chat is flaky.
- Have a second board pre-loaded with a completed scene for the architecture walkthrough.

## RECORDING TIPS

- Use 1080p, browser at 90% zoom so UI isn't cramped
- Close all other tabs (notification sounds kill demos)
- For multiplayer, use side-by-side browser windows (50/50 split)
- Record on prod (yesaind.com), not localhost - avoids DO cold start flakiness
- The AI Show auto-plays so you can narrate freely while it runs
