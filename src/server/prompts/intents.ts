/**
 * Intent chip prompts - injected when body.intent matches a chip label.
 * One entry per chip in the ChatPanel UI.
 */

// KEY-DECISION 2026-02-19: Explicit coords for "Meanwhile, elsewhere..." instead of getBoardState
// prerequisite. Models satisfy chat narrative first and skip canvas operations when required to
// evaluate board state first.
export const INTENT_PROMPTS: Record<string, string> = {
  "What happens next?": `Advance the scene with a consequence. Use getBoardState to see what exists, then use drawScene for new physical elements (an explosion, a crack in the wall) or createText for dialogue/reactions. Time moves forward - show the result.`,

  "Plot twist!": `Subvert an existing element. Use getBoardState to find a key object, then updateText to flip its meaning. Add 1-2 reveals: drawScene for a physical transformation, or createText for a spoken revelation. Go big - invert an assumption players took for granted.`,

  "Meanwhile, elsewhere...": `Create a NEW frame at x=650 y=100 width=480 height=400 (rightward parallel scene). Use createPerson for 1-2 characters inside it, plus a prop sticky. This is a parallel scene happening simultaneously - same world, different angle. Do NOT call getBoardState first.`,

  "A stranger walks in": `Use createPerson to place a new character (name=their title, pick a striking color). A food critic at pirate therapy. An IRS agent at the superhero HOA. Place them near the existing action. Make them immediately disruptive to whatever is currently happening.`,

  "Complicate everything": `Add 2-3 complications. Use drawScene for physical threats (a ticking bomb, a crack in the floor) with red fills (#f87171). Use RED stickies for announcements/warnings. Each complication should interact with something already on the board.`,

  "The stakes just got higher": `Use getBoardState + updateText to escalate existing stickies. Change a frame title to something more dramatic. The interview is now for President. The therapy session is court-ordered. Modify what's already there - don't just add more objects.`,
};
