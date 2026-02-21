/**
 * Game mode prompt blocks - injected between base prompt and persona identity.
 * Each mode (yesand, harold) has its own rules and state.
 */

import type { GameMode } from "../../shared/types";

export interface GameModeState {
  yesAndCount?: number;
  haroldTurns?: number;
}

/** Build mode-specific system prompt block for injection into persona prompt */
export function buildGameModePromptBlock(mode: GameMode, state: GameModeState): string {
  if (mode === "yesand") {
    return (
      `[GAME MODE: YES-AND CHAIN]\n` +
      `Beat ${state.yesAndCount ?? 0} of 10.\n` +
      `RULES:\n` +
      `- Every response MUST start with "Yes, and..." (after your [NAME] prefix).\n` +
      `- Build directly on the last thing said. No tangents.\n` +
      `- Each beat should escalate or add a new detail. Small steps, not giant leaps.\n` +
      `- If someone breaks the chain (doesn't "yes, and"), gently redirect: "Let's get back on the chain!"\n` +
      `- The chain ends at beat 10 with a callback to beat 1.`
    );
  }
  if (mode === "harold") {
    const turns = state.haroldTurns ?? 0;
    let phase: string;
    let coaching: string;
    if (turns <= 3) {
      phase = "Opening";
      coaching =
        "Establish themes through group discovery. Find the game of the scene - the unusual thing that can be repeated and heightened.";
    } else if (turns <= 8) {
      phase = "First Beats";
      coaching =
        "Create 2-3 distinct scenes inspired by opening themes. Each in a different location with different characters. Plant seeds for callbacks.";
    } else if (turns <= 13) {
      phase = "Second Beats";
      coaching =
        "Return to first-beat scenes. Heighten the pattern - same game, bigger stakes. Characters have evolved since we last saw them.";
    } else {
      phase = "Third Beats";
      coaching =
        "Weave scenes together. Cross-pollinate characters between scenes. Callbacks to the opening. Build to a unified climax that ties all threads.";
    }
    return `[GAME MODE: HAROLD - ${phase}]\nTurn ${turns} of 20.\nCOACHING: ${coaching}`;
  }
  return "";
}

/** Mode-specific director prompts (override phase-based defaults) */
export const DIRECTOR_PROMPTS_HAROLD: Record<string, string> = {
  active:
    "Coach the Harold structure. If players are in first beats, encourage distinct scenes. In second beats, prompt them to revisit. In third beats, find connections.",
  wrapup:
    "The Harold is reaching its conclusion. Weave remaining threads into a unified ending. Callback to the opening moment.",
};

export const DIRECTOR_PROMPTS_YESAND: Record<string, string> = {
  active:
    "The yes-and chain needs momentum. Add the next beat that builds on the previous one. " +
    "Start with 'Yes, and...' and escalate by one notch.",
  wrapup: "The chain is at 10+ beats. Bring it full circle - reference beat 1 with a twist.",
};
