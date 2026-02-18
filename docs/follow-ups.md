# Improv Mode - Summary & Follow-ups

## What Was Done

### PART 1 - "Yes, And" System Prompt (`src/server/chat-agent.ts`)
- Replaced generic "whiteboard assistant" persona with improv scene partner
- Key behaviors: never say no, always "yes, and", escalate by one notch, contribute characters/props/complications, callbacks to earlier elements, short sticky text (5-15 words), spatial canvas use (proximity = relationship), match player energy
- Added instruction that messages come from different users (prep for multiplayer attribution)
- Kept all existing tool/layout/color rules intact
- Changed "BOARD GENERATION" -> "SCENE SETUP" with improv content guidance

### PART 2 - Scene Starter Templates (`src/shared/board-templates.ts`)
- Replaced 5 business templates (SWOT, Sprint Retro, Project Plan, Brainstorm, Kanban) with 7 improv scenes
- Each uses the same coord injection pattern (frame + 3 character stickies + 3 prop stickies)
- Scenes: Vampire Dentist, Moon Job Interview, Cat Restaurant, Alien Grocery, Time Travel Cafe, Superhero HOA, Pirate Therapy

### Overlay UI (`src/client/components/Board.tsx`)
- Heading: "What would you like to create?" -> "Set the scene"
- Placeholder: SWOT example -> "A detective who only solves crimes by smell"
- Hint: "add objects manually" -> "add props yourself"

### CLAUDE.md
- Documented worktree setup sequence (npm install, build, migrate, source ports)

## UAT Results (all PASS)
1. Empty state shows 4 improv scene chips (Vampire Dentist, Moon Job Interview, Cat Restaurant, Alien Grocery)
2. Clicking "Vampire Dentist" generates frame + 6 stickies with punchy creative text
3. Chat AI responds in "yes, and" style - escalates by one notch, creates new props on canvas

## Follow-ups

### Should Do
- **ChatPanel hardcoded suggestions**: The ChatPanel has hardcoded suggestion chips above the template bar ("What's on this board?", "Create a SWOT analysis", "Organize stickies by color", "Add 5 brainstorm ideas about AI"). These should be replaced with improv-appropriate suggestions (e.g. "Add a plot twist", "Introduce a new character", "What happens next?")
- **Username attribution in chat**: The system prompt says "messages come from different users" but username isn't actually attached to messages yet. Need to pass sender username in `useAgentChat` body so AI sees "Alice said: ..." not just "user: ..."
- **ChatPanel multiplayer UI**: Color-coded names per sender in chat messages

### Could Do
- Remove old business template references from any other files
- Add more scene templates (the system supports as many as wanted)
- Consider a "random scene" button that picks one at random
