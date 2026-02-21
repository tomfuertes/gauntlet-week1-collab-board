/**
 * Dramatic arc machinery - scene phases, lifecycle, and turn budget.
 * Three overlapping systems that create natural scene structure:
 *
 * 1. ScenePhase (director): setup -> escalation -> complication -> climax -> callback
 *    Used for proactive AI director nudges.
 *
 * 2. SceneLifecycle (AI-directed): establish -> build -> peak -> resolve -> curtain
 *    AI can advance explicitly via advanceScenePhase tool; auto-advance is fallback.
 *    "More advanced wins" merge: stored phase honored unless auto caught up.
 *
 * 3. BudgetPhase (turn count): normal -> act3 -> final-beat -> scene-over
 *    Counts human turns only. Creates natural endings via countdown pressure.
 */

import type { SceneLifecyclePhase } from "../../shared/types";

// ---------------------------------------------------------------------------
// Scene phases (director system)
// ---------------------------------------------------------------------------

export type ScenePhase = "setup" | "escalation" | "complication" | "climax" | "callback";

export function computeScenePhase(userMessageCount: number): ScenePhase {
  if (userMessageCount <= 2) return "setup";
  if (userMessageCount <= 5) return "escalation";
  if (userMessageCount <= 8) return "complication";
  if (userMessageCount <= 11) return "climax";
  return "callback";
}

export const DIRECTOR_PROMPTS: Record<ScenePhase, string> = {
  setup:
    "The scene needs an establishment detail. Use drawScene for new characters/props (visual shapes), or createText for dialogue/narration. Punchy, specific details.",
  escalation:
    "Raise the stakes. Introduce a complication - use drawScene for a new character or threatening object, or createText for dialogue. Use RED stickies (#f87171) only for exclamations/warnings that need visual pop.",
  complication:
    "Things should go wrong in an unexpected way. Subvert an existing element - use getBoardState to find something to twist. Add createText that recontextualizes what's already there.",
  climax:
    "Maximum tension. Everything should converge. Reference callbacks from earlier in the scene. Use getBoardState to find early elements and bring them back at the worst possible moment.",
  callback:
    "Full circle. Reference the very first elements of the scene. Create a callback that ties everything together with a twist. Check getBoardState for the oldest objects.",
};

// ---------------------------------------------------------------------------
// Turn budget
// ---------------------------------------------------------------------------

export type BudgetPhase = "normal" | "act3" | "final-beat" | "scene-over";

export function computeBudgetPhase(humanTurns: number, budget: number): BudgetPhase {
  const pct = humanTurns / budget;
  if (pct < 0.6) return "normal";
  if (pct < 0.8) return "act3";
  if (pct < 0.95) return "final-beat";
  return "scene-over";
}

export const BUDGET_PROMPTS: Record<Exclude<BudgetPhase, "normal">, string> = {
  act3:
    `[SCENE BUDGET: ACT 3] The scene is entering its final act. ` +
    `Pull threads together. Callback to earlier moments. Begin resolving tensions. ` +
    `The audience can feel the ending approaching.`,
  "final-beat":
    `[SCENE BUDGET: FINALE] This is the last few lines before the bow. ` +
    `Wrap up. Deliver punchlines, resolve the main tension. Reference the very first elements. ` +
    `Make every line count.`,
  "scene-over":
    `[SCENE BUDGET: FINAL BOW] ONE closing line - a callback to the very first element of the scene. ` +
    `Then deliver a brief scene summary (2-3 sentences) of the whole arc. Take a bow.`,
};

// ---------------------------------------------------------------------------
// Scene lifecycle (AI-directed with auto-advance fallback)
// ---------------------------------------------------------------------------

/** Human-turn thresholds for auto-advance (fallback when AI doesn't call advanceScenePhase) */
const LIFECYCLE_THRESHOLDS: [SceneLifecyclePhase, number][] = [
  ["curtain", 17],
  ["resolve", 13],
  ["peak", 9],
  ["build", 4],
  ["establish", 0],
];

const LIFECYCLE_PHASE_ORDER: SceneLifecyclePhase[] = ["establish", "build", "peak", "resolve", "curtain"];

/** Compute effective lifecycle phase - returns the MORE advanced of auto vs stored.
 *  This ensures AI-directed advances are respected AND auto-advance catches up when unused. */
export function computeLifecyclePhase(humanTurns: number, storedPhase?: SceneLifecyclePhase): SceneLifecyclePhase {
  let autoPhase: SceneLifecyclePhase = "establish";
  for (const [phase, threshold] of LIFECYCLE_THRESHOLDS) {
    if (humanTurns >= threshold) {
      autoPhase = phase;
      break;
    }
  }
  if (!storedPhase) return autoPhase;
  const autoIdx = LIFECYCLE_PHASE_ORDER.indexOf(autoPhase);
  const storedIdx = LIFECYCLE_PHASE_ORDER.indexOf(storedPhase);
  return autoIdx >= storedIdx ? autoPhase : storedPhase;
}

const LIFECYCLE_GUIDANCE: Record<SceneLifecyclePhase, string> = {
  establish:
    "Ground the world right now. Who is here? Where are we? What is the situation? " +
    "Create 1-2 characters and a clear location. Build the playground the audience will inhabit. " +
    "Call advanceScenePhase('build') once core characters and setting are established.",
  build:
    "Deepen what exists. Add wants, relationships, and complications. " +
    "Every character needs something they desperately can't have. Raise the pressure. " +
    "Call advanceScenePhase('peak') when tensions are clearly defined and colliding.",
  peak:
    "Maximum pressure. Everything is colliding. Wants crash against each other, relationships strain, chaos peaks. " +
    "This is the point of no return - nothing can stay the same after this. " +
    "Call advanceScenePhase('resolve') when the climactic moment has landed.",
  resolve:
    "Things must land now. Pull every thread together. Deliver on promises made in the establish phase. " +
    "Emotional truth over plot logic. Callbacks to early moments pay off here. " +
    "Call advanceScenePhase('curtain') when the scene has found its ending.",
  curtain:
    "Final bow. One last callback to the very first thing established in this scene. " +
    "Wrap with grace, surprise, and inevitability. Make the audience feel it was always going to end this way. " +
    "This is your last line - make it land.",
};

/** Build a lifecycle phase prompt block for injection into the system prompt.
 *  Returns empty string for hat mode (scene lifecycle doesn't apply to rapid-fire hat scenes). */
export function buildLifecycleBlock(phase: SceneLifecyclePhase): string {
  return `[SCENE LIFECYCLE: ${phase.toUpperCase()}]\n${LIFECYCLE_GUIDANCE[phase]}`;
}
