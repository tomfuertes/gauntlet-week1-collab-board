# Tomorrow Sprint Plan (Feb 19, 2026)

Five AI-native features to transform CollabBoard from "whiteboard with chat sidebar" to "AI-collaborative canvas." Based on competitive research against Miro Sidekicks, FigJam selection-gated AI, tldraw Make Real, and MS Whiteboard Categorize.

---

## Execution Strategy

**Parallel worktrees for independent sprints.** Two worktrees run simultaneously, each with its own Claude session. Merge each PR to main before starting dependent work.

```
Morning block (parallel):
  Worktree A: Sprint 1 - AI Cursor Presence     (~6hrs)
  Worktree B: Sprint 2 - Contextual AI Actions   (~6hrs)

Afternoon block (after Sprint 1 merges):
  Worktree C: Sprint 3 - AI Batch Undo           (~4hrs)
  Main:       Sprint 5 - Board Generation         (~4hrs)

If time permits:
  Worktree D: Sprint 4 - Intent Preview           (~6hrs, depends on Sprint 1)
```

---

## Sprint 1: AI Cursor Presence ("AI as Collaborator")

**Branch:** `feat/ai-cursor`
**Worktree:** `scripts/worktree.sh create ai-cursor`
**Estimated:** 6 hours
**Dependencies:** None

### Goal
When AI creates/moves/modifies objects, its cursor appears on the canvas and animates to each creation point. AI shows in the presence bar. All connected users see the AI "working."

### Why
Miro's #1 headline feature. Research says cursor presence is the primary social signal in collaborative tools. Currently AI objects just "pop in" with no spatial narrative. This transforms "AI made stuff" into "AI is working alongside me."

### Implementation

**Server: Board DO (`src/server/board.ts`)**
- Add virtual AI user to presence when ChatAgent is actively running tools
- New method: `injectAiCursor(x: number, y: number)` - broadcasts a `cursor` message from the AI virtual user
- AI user identity: `{ userId: "ai-agent", username: "AI Assistant" }`
- Add/remove AI from presence list when tool execution starts/ends

**Server: AI tools (`src/server/ai-tools-sdk.ts`)**
- `createAndMutate()` calls `stub.injectAiCursor(obj.x, obj.y)` BEFORE `stub.mutate()`
- Add ~200ms delay between cursor move and object creation for visual effect
- `moveObject` tool also injects cursor at target position
- Pass board stub's cursor injection through tool context

**Server: ChatAgent (`src/server/chat-agent.ts`)**
- Before `streamText()`: call `boardStub.addAiPresence()` to add AI to presence list
- After `onFinish`: call `boardStub.removeAiPresence()` to remove AI from presence
- Handle abort signal to also remove presence on cancel

**Client: Cursors.tsx**
- Detect AI cursor by userId === "ai-agent"
- Render distinct cursor shape: robot/sparkle icon instead of arrow pointer
- Different color: use purple (#a78bfa) from theme accent
- Add subtle particle trail or glow effect on AI cursor movement

**Client: Board.tsx presence bar**
- Show AI in the presence avatars when active
- Sparkle icon + "AI" label instead of user initial
- Pulsing animation while AI is actively creating

### Files to Change
- `src/server/board.ts` - AI presence + cursor injection methods
- `src/server/ai-tools-sdk.ts` - cursor injection in createAndMutate + moveObject
- `src/server/chat-agent.ts` - presence lifecycle around streamText
- `src/client/components/Cursors.tsx` - AI cursor rendering
- `src/client/components/Board.tsx` - AI presence indicator
- `src/shared/types.ts` - AI cursor message type if needed

### Verification
- Start dev server, open two browser tabs
- Send "create a yellow sticky" in chat
- Both tabs should see: AI cursor animate to position -> brief pause -> sticky appears with glow
- AI should appear/disappear in presence bar during chat interaction
- Run SWOT template: AI cursor should zip between all 12 creation points

### Prompt for Worktree Agent
```
Read CLAUDE.md and src/server/board.ts, src/server/ai-tools-sdk.ts, src/server/chat-agent.ts, src/client/components/Cursors.tsx, src/client/components/Board.tsx, src/shared/types.ts.

Implement AI cursor presence: when the AI agent creates or moves objects, its cursor should appear on the canvas and animate to those positions. AI should show in the presence bar while active.

Key approach:
1. Board DO: add injectAiCursor(x,y) method that broadcasts a cursor message from userId="ai-agent", username="AI Assistant". Add addAiPresence/removeAiPresence methods.
2. ai-tools-sdk.ts: createAndMutate calls stub.injectAiCursor(obj.x, obj.y) BEFORE stub.mutate(). moveObject also injects cursor.
3. chat-agent.ts: add AI to presence before streamText, remove after onFinish and on abort.
4. Cursors.tsx: detect userId==="ai-agent", render a distinct cursor (robot/sparkle icon, purple #a78bfa, particle trail).
5. Board.tsx: show AI in presence avatars with sparkle icon while active.

Source worktree.ports && VITE_PORT=$VITE_PORT WRANGLER_PORT=$WRANGLER_PORT npm run dev to start. Use playwright-cli -s=ai-cursor for testing. Verify with SWOT template - cursor should zip between all 12 creation points.
```

---

## Sprint 2: Contextual AI Actions (Right-Click Menu)

**Branch:** `feat/ai-context-menu`
**Worktree:** `scripts/worktree.sh create ai-context-menu`
**Estimated:** 6 hours
**Dependencies:** None

### Goal
Right-click on selected objects shows AI-powered actions: Cluster by Theme, Summarize, Restyle, Generate More Like This. No chat required.

### Why
FigJam's dominant pattern. Miro's #1 praised feature is sticky clustering via selection. Puts AI where attention already is instead of forcing everything through chat sidebar.

### Implementation

**Client: Board.tsx context menu**
- Existing context menu has Copy/Paste/Delete etc.
- Add "AI" submenu section when 1+ objects are selected
- Actions vary by selection:
  - 1 object: "Explain", "Restyle", "Generate Similar"
  - 2+ stickies/text: "Cluster by Theme", "Summarize", "Restyle All"
  - Any selection: "Generate More Like This"
- Each action sends a pre-built prompt + selectedIds to ChatAgent via the existing `useAIChat.sendMessage()`

**Client: ChatPanel.tsx integration**
- Context menu AI actions auto-open the chat panel if closed
- The pre-built prompt appears as the user's message (so they can see what happened)
- AI response streams normally with tool calls

**Server: System prompt enhancement (`src/server/chat-agent.ts`)**
- Add clustering instructions to SYSTEM_PROMPT:
  ```
  CLUSTERING: When asked to cluster/organize stickies:
  1. getBoardState with the provided IDs to read all text
  2. Group by semantic theme (3-5 groups typical)
  3. Create one frame per group with a descriptive title
  4. Move each sticky into its frame using moveObject
  5. Space frames in a row: x=50, x=510, x=970 etc.
  ```

**Prompt templates for each action:**
- Cluster: "Organize these {n} selected objects by theme. Create labeled frames and move objects into them."
- Summarize: "Read the text of these {n} selected objects and create a new sticky note summarizing the key themes."
- Restyle: "Change the colors of these {n} objects to use a cohesive color palette that matches their content themes."
- Generate Similar: "Look at these {n} objects and create {n} more with similar style but new content related to the same topic."

### Files to Change
- `src/client/components/Board.tsx` - context menu AI actions
- `src/server/chat-agent.ts` - clustering/summarize instructions in system prompt
- Possibly `src/client/components/ChatPanel.tsx` - auto-open on context menu action

### Verification
- Create 8+ stickies with mixed topics (e.g., 3 about marketing, 3 about engineering, 2 about design)
- Select all, right-click -> "Cluster by Theme"
- AI should create 3 frames and move stickies into them
- Select 5 stickies, right-click -> "Summarize" -> new text object appears with summary
- Two-browser test: both users see the clustering happen in real-time

### Prompt for Worktree Agent
```
Read CLAUDE.md and src/client/components/Board.tsx (especially the context menu section), src/server/chat-agent.ts, src/client/components/ChatPanel.tsx, src/client/hooks/useAIChat.ts.

Implement contextual AI actions on the right-click context menu. When objects are selected, the context menu should show AI actions: "Cluster by Theme" (2+ objects), "Summarize" (2+ objects), "Restyle" (any), "Generate Similar" (any).

Key approach:
1. Board.tsx: add an "AI" section to the existing context menu. Each action sends a pre-built prompt string + selectedIds to useAIChat.sendMessage. Auto-open ChatPanel if closed.
2. chat-agent.ts: add CLUSTERING instructions to SYSTEM_PROMPT explaining the multi-step flow (getBoardState -> create frames -> moveObject into frames).
3. Prompt templates: "Organize these N selected objects by theme..." etc.

Source worktree.ports && VITE_PORT=$VITE_PORT WRANGLER_PORT=$WRANGLER_PORT npm run dev to start. Use playwright-cli -s=ai-context for testing. Create 8+ stickies with mixed topics, select all, right-click -> Cluster. Verify frames created with stickies moved inside.
```

---

## Sprint 3: AI Batch Undo

**Branch:** `feat/ai-batch-undo`
**Worktree:** `scripts/worktree.sh create ai-batch-undo`
**Estimated:** 4 hours
**Dependencies:** None (nice-to-have: Sprint 1 for visual polish)

### Goal
Single button/shortcut undoes ALL objects from the AI's last response as a batch. "Undo AI" as a first-class operation.

### Why
Every competitive research paper flagged multi-object undo as unsolved. Current undo is per-object - AI creates 12 objects (SWOT), you undo 12 times. Nobody does batch AI undo.

### Implementation

**Shared: Types (`src/shared/types.ts`)**
- Add optional `batchId?: string` to `BoardObject`

**Server: AI tools (`src/server/ai-tools-sdk.ts`)**
- `createSDKTools(stub, batchId?: string)` - accept optional batchId
- `makeObject()` stamps `batchId` on every created object
- `createAndMutate()` result includes batchId

**Server: ChatAgent (`src/server/chat-agent.ts`)**
- Generate a unique `batchId = crypto.randomUUID()` per `streamText()` call
- Pass batchId to `createSDKTools(stub, batchId)`

**Server: Board DO (`src/server/board.ts`)**
- New RPC method: `undoBatch(batchId: string)` - deletes all objects with matching batchId, broadcasts `obj:delete` for each
- New WS message type: `ai:undo-batch` (client -> server)

**Client: ChatPanel.tsx**
- After each AI response that created objects, show "Undo AI" button in the chat message
- Button sends `ai:undo-batch` with the batchId from the response
- Also add keyboard shortcut: Cmd+Shift+Z when chat panel is focused

**Client: Board.tsx**
- "Undo AI" button in toolbar (near existing undo/redo) - active only when AI objects exist
- Button undoes the most recent batch

### Files to Change
- `src/shared/types.ts` - batchId on BoardObject
- `src/server/ai-tools-sdk.ts` - batchId stamping
- `src/server/chat-agent.ts` - batchId generation
- `src/server/board.ts` - undoBatch RPC + WS handler
- `src/client/components/ChatPanel.tsx` - undo button per AI message
- `src/client/components/Board.tsx` - toolbar undo AI button

### Verification
- Send "Create a SWOT analysis" -> 12 objects appear
- Click "Undo AI" -> all 12 objects disappear in one action
- Undo only affects the last AI batch, not user-created objects
- Two-browser test: undo in browser 1, objects disappear in browser 2

### Prompt for Worktree Agent
```
Read CLAUDE.md and src/shared/types.ts, src/server/ai-tools-sdk.ts, src/server/chat-agent.ts, src/server/board.ts, src/client/components/ChatPanel.tsx, src/client/components/Board.tsx.

Implement AI batch undo: a single action that undoes ALL objects from the AI's last response.

Key approach:
1. types.ts: add optional batchId?: string to BoardObject
2. ai-tools-sdk.ts: createSDKTools accepts batchId, makeObject stamps it, results include it
3. chat-agent.ts: generate batchId = crypto.randomUUID() per streamText call, pass to createSDKTools
4. board.ts: add undoBatch(batchId) RPC that deletes all objects with that batchId + broadcasts obj:delete. Add "ai:undo-batch" WS message handler.
5. ChatPanel.tsx: show "Undo AI" button after AI responses that created objects. Board.tsx: toolbar "Undo AI" button.

Source worktree.ports && VITE_PORT=$VITE_PORT WRANGLER_PORT=$WRANGLER_PORT npm run dev to start. Use playwright-cli -s=ai-undo for testing. Create SWOT -> Undo AI -> verify all 12 objects gone.
```

---

## Sprint 4: Intent Preview (Ghost Objects)

**Branch:** `feat/intent-preview`
**Worktree:** `scripts/worktree.sh create intent-preview`
**Estimated:** 6 hours
**Dependencies:** Sprint 1 (AI cursor makes previews feel connected)

### Goal
Before AI materializes complex layouts (3+ objects), show translucent "ghost" previews. User approves or cancels. Simple actions (1-2 objects) execute directly.

### Why
Smashing Magazine "Intent Preview" pattern. Nobody does this in whiteboards. Transforms "AI did something I didn't want" into "AI is proposing something I can adjust."

### Implementation

**Two-phase tool execution:**
- Phase 1 (Plan): Tools compute positions and return them WITHOUT creating objects
- Phase 2 (Commit): After user approval, create all objects at once

**Server: AI tools (`src/server/ai-tools-sdk.ts`)**
- Add `previewMode: boolean` parameter to `createSDKTools`
- In preview mode: `createAndMutate` skips `stub.mutate()`, returns planned positions only
- Collect all planned objects in an array

**Server: ChatAgent (`src/server/chat-agent.ts`)**
- For complex requests (detected by template chips or multi-tool responses):
  - First pass: run streamText in preview mode, collect planned objects
  - Send preview objects to client via chat response metadata
  - Wait for approval message from client
  - Second pass: execute for real with the confirmed positions

**Client: Board.tsx**
- New rendering layer for preview objects: 40% opacity, dashed border, pulsing animation
- Preview objects are NOT in the regular objects Map - separate state
- Show "Apply Layout" / "Cancel" floating buttons when previews are active

**Client: ChatPanel.tsx**
- Detect preview response from AI
- Show "Apply" / "Adjust" / "Cancel" buttons inline
- "Adjust" lets user drag ghost objects before confirming
- "Apply" sends confirmation message to ChatAgent

### Files to Change
- `src/server/ai-tools-sdk.ts` - preview mode flag
- `src/server/chat-agent.ts` - two-phase execution
- `src/client/components/Board.tsx` - ghost object rendering + approve/cancel UI
- `src/client/components/ChatPanel.tsx` - preview controls
- `src/shared/types.ts` - preview message types

### Verification
- Send "Create a SWOT analysis" -> ghost frames + stickies appear at 40% opacity
- Click "Apply" -> objects solidify to full opacity
- Click "Cancel" -> ghosts disappear, nothing created
- Drag a ghost frame -> it moves -> "Apply" creates at the adjusted position
- Simple request "create a sticky" -> executes directly, no preview

---

## Sprint 5: AI Board Generation from Description

**Branch:** `feat/ai-board-gen`
**Run on:** Main or worktree
**Estimated:** 4 hours
**Dependencies:** None

### Goal
On blank boards, prominent "Generate Board" sparkle input. User describes what they want -> AI generates a complete structured board.

### Why
FigJam's primary AI onboarding moment. Solves the "blank canvas problem." Our 4 template chips are hardcoded; this is free-form.

### Implementation

**Client: Board.tsx empty state**
- Detect `objects.size === 0 && initialized`
- Show centered overlay: sparkle icon + text input + placeholder suggestions
- Suggestions: "Product roadmap for Q2", "User journey map", "Sprint retrospective", "Competitive analysis"
- On submit: send prompt to ChatAgent with enhanced context
- Overlay dismisses when first object appears

**Client: ChatPanel.tsx**
- Board generation prompts auto-open chat panel
- Enhanced prompt wrapping: "Generate a complete board layout for: {user input}. Create frames for each section, add labeled stickies with relevant content, and connect related items."

**Server: ChatAgent system prompt**
- Add board generation instructions:
  ```
  BOARD GENERATION: When asked to generate a complete board:
  1. Plan the layout structure first (what frames/sections needed)
  2. Use grid layout: up to 3 frames per row, 460px wide, 20px gap
  3. Create frames first, then populate with stickies
  4. Use color coding: different sticky color per frame/theme
  5. Add connectors between related sections if appropriate
  6. Target: 4-8 frames with 2-4 stickies each
  ```

### Files to Change
- `src/client/components/Board.tsx` - empty state overlay with sparkle input
- `src/server/chat-agent.ts` - board generation system prompt section
- `src/client/styles/animations.css` - sparkle animation for the input

### Verification
- Create a new empty board -> sparkle input appears centered
- Type "Design sprint board for a fintech app" -> AI generates structured board
- Verify: multiple frames, color-coded stickies, no overlaps
- After board populates, sparkle overlay is gone
- Existing boards with objects: no sparkle overlay shown
