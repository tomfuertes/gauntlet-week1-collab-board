# UX Intents Exploration

## Current State

- 4 static suggestion chips: "Add a plot twist", "Introduce a new character", "What happens next?", "The health inspector arrives"
- Chips only shown when messages.length === 0 (empty state)
- 7 scene starter templates in bottom bar (always visible)
- System prompt teaches improv "yes, and" behavior but has no awareness of dramatic structure

## Intent Brainstorm (10 patterns)

### Scene Structure
1. **"Plot twist!"** - Subvert the current scene. AI should take an existing element and flip its meaning. The mirror was a portal all along. The patient IS the real dentist.
2. **"Meanwhile, elsewhere..."** - Create a PARALLEL scene in a new frame. Second location running simultaneously. Cuts between scenes = comedy gold.
3. **"Fast forward 10 years"** - Time skip. AI shows consequences of current scene. The restaurant is now a franchise. The vampire dentist went corporate.
4. **"Flashback to..."** - Callback to earlier elements with new context. Recontextualize something from the beginning.

### Character
5. **"A stranger walks in"** - Add an unexpected character that doesn't belong. A food critic at the pirate therapy session. An IRS agent at the superhero HOA.
6. **"Give someone a secret"** - AI picks a character and adds a hidden motivation. The therapist is actually a pirate too. The store employee IS an alien.
7. **"Two characters swap roles"** - Role reversal. The patient becomes the dentist. The interviewer becomes the candidate. Chaos.

### Game Mechanics (Chaos)
8. **"Complicate everything"** - Murphy's Law. AI adds 2-3 obstacles/problems at once. Power goes out, someone faints, the building is sinking.
9. **"The stakes just got higher"** - Escalation without chaos. Whatever's happening becomes MORE important. The interview is for President. The therapy session is court-ordered.
10. **"Add a ticking clock"** - Urgency. Something must happen before time runs out. Health inspector in 5 minutes. Lunar eclipse approaching. Last day before retirement.

### Meta (bonus, lower priority)
11. **"Narrator voice"** - AI speaks as omniscient narrator, adding dramatic irony
12. **"Audience reaction"** - Fourth wall break, AI describes audience gasps/laughter

## Selected for Implementation (top 5)

| Intent | Category | Why |
|--------|----------|-----|
| "Plot twist!" | Scene | Universal fun. Every improv benefits from reversals. Maps to updateText + new stickies. |
| "Meanwhile, elsewhere..." | Scene | Creates spatial storytelling (new frame). Unique to canvas medium - can't do this in text-only chat. |
| "A stranger walks in" | Character | Reliable comedy engine. New character = new energy. Simple for AI (one sticky). |
| "Complicate everything" | Chaos | Pure improv fuel. Multiple small additions. High visual payoff on canvas. |
| "The stakes just got higher" | Chaos | Escalation is the soul of improv. Modifies existing elements rather than creating new ones - uses updateText/changeColor. |

### Honorable mentions (could add later)
- "Add a ticking clock" - great but overlaps with "stakes"
- "Give someone a secret" - fun but hard for AI to execute spatially
- "Fast forward 10 years" - great for longer sessions

## Dynamic Chip Strategy

Instead of static chips, chips rotate based on conversation phase:

| Phase | Message count | Chip set |
|-------|--------------|----------|
| **Empty** | 0 | Scene starters via templates (existing behavior) |
| **Scene set** | 1-3 | "What happens next?", "A stranger walks in", "Plot twist!" |
| **Mid-scene** | 4-7 | "Complicate everything", "Meanwhile, elsewhere...", "The stakes just got higher" |
| **Deep scene** | 8+ | "Plot twist!", "Meanwhile, elsewhere...", "Complicate everything", "The stakes just got higher" |

Chips show above the input area (where empty-state suggestions currently are) as a persistent, scrollable row with category labels.

## System Prompt Additions

Add an INTENT PATTERNS section that teaches the AI:
- "Plot twist!" -> find an existing element and subvert it. Use getBoardState + updateText.
- "Meanwhile, elsewhere..." -> create a new frame in unused canvas space. New location, 2-3 new characters/props.
- "A stranger walks in" -> create one character sticky with a fish-out-of-water description. Place near existing action.
- "Complicate everything" -> add 2-3 red stickies with problems. Scatter across the scene.
- "The stakes just got higher" -> modify existing stickies (updateText) to escalate. Change a frame title to something more dramatic.

Also: after 3+ consecutive AI-user exchanges, AI should end its response with a provocative question or complication suggestion to keep momentum.

## UI Changes

1. Replace static `SUGGESTED_PROMPTS` with dynamic function
2. Show chips in a persistent row (not just empty state) with category pills: Scene / Character / Chaos
3. Category pills are small labels above grouped chips
4. Chips gently animate in when the set changes (CSS transition on opacity)
