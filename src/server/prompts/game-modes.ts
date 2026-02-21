/**
 * Game mode prompt blocks - injected between base prompt and persona identity.
 * Each mode (hat, yesand, freezetag) has its own rules and state.
 */

import type { GameMode } from "../../shared/types";

export interface GameModeState {
  hatPrompt?: string;
  hatExchangeCount?: number;
  hatPromptOffset?: number; // x-offset for new hat scene frame (avoids piling on previous scenes)
  yesAndCount?: number;
  freezeIsFrozen?: boolean; // freeze tag: whether scene is currently frozen
  freezeTakenCharacter?: string; // freeze tag: name of character taken over after freeze
}

// KEY-DECISION 2026-02-19: Spatial offset on new hat prompts. When hatExchangeCount is 1,
// a new prompt just started. Offset x by 600*promptNumber so scenes don't pile on each other.
// Guard: only fire for 2nd+ prompt (offset > 50). First prompt already gets SCENE_SETUP_PROMPT;
// injecting spatialBlock there too would create conflicting instructions.

/** Build mode-specific system prompt block for injection into persona prompt */
export function buildGameModePromptBlock(mode: GameMode, state: GameModeState): string {
  if (mode === "hat") {
    const exchangeCount = state.hatExchangeCount ?? 0;
    const isNewPrompt = exchangeCount === 1 && (state.hatPromptOffset ?? 50) > 50;
    const spatialBlock = isNewPrompt
      ? `\n- NEW SCENE AREA: This is a fresh prompt. Clear a new area - create a NEW frame at ` +
        `x=${state.hatPromptOffset ?? 650} y=100 width=500 height=380. Place stickies INSIDE this new frame.`
      : "";
    return (
      `[GAME MODE: SCENES FROM A HAT]\n` +
      `Current prompt: "${state.hatPrompt ?? ""}"\n` +
      `Exchange ${exchangeCount} of 5.\n` +
      `RULES:\n` +
      `- Stay on the current prompt. Every response must relate to it.\n` +
      `- Keep scenes short and punchy - this is a quick-fire format.\n` +
      `- After 5 exchanges, the scene ends. Wrap up with a callback.\n` +
      `- If a user sends [NEXT-HAT-PROMPT], acknowledge the prompt change and start fresh on the new prompt.` +
      spatialBlock
    );
  }
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
  if (mode === "freezetag") {
    if (state.freezeIsFrozen) {
      return (
        `[GAME MODE: FREEZE TAG - SCENE FROZEN]\n` +
        `The scene has been frozen. Announce dramatically: "FREEZE! Everything stops." ` +
        `A player is about to take over a character. Wait for their [TAKEOVER: name] message.\n` +
        `RULES:\n` +
        `- Respond with a theatrical freeze announcement (1-2 sentences max).\n` +
        `- Do NOT advance the scene. Everything is suspended mid-action.\n` +
        `- Do NOT create canvas objects while frozen.`
      );
    }
    if (state.freezeTakenCharacter) {
      return (
        `[GAME MODE: FREEZE TAG - TAKEOVER: ${state.freezeTakenCharacter}]\n` +
        `A player just stepped into ${state.freezeTakenCharacter}'s shoes.\n` +
        `RULES:\n` +
        `- Open with exactly 1 sentence: "The scene shifts... [player] steps into ${state.freezeTakenCharacter}'s shoes."\n` +
        `- Update ${state.freezeTakenCharacter}'s sticky/person label on canvas to reflect the new player direction (use updateText).\n` +
        `- Then continue improv in a new direction while keeping the setting and other characters intact.\n` +
        `- Yes-And with full energy. The freeze is over - scene is live again.`
      );
    }
    return (
      `[GAME MODE: FREEZE TAG]\n` +
      `RULES:\n` +
      `- Any player can yell FREEZE to stop the scene (they click the FREEZE button, sending [FREEZE]).\n` +
      `- After a freeze, the freezing player takes over any character on stage ([TAKEOVER: name]).\n` +
      `- After a takeover, do a brief "The scene shifts..." narration, update the character on canvas, then continue improv.\n` +
      `- Between freezes, play normally with Yes-And energy.`
    );
  }
  return "";
}

/** Mode-specific director prompts (override phase-based defaults) */
export const DIRECTOR_PROMPTS_HAT: Record<string, string> = {
  active:
    "The hat scene is going well. Add a complication related to the current prompt. " +
    "Keep it on-topic - something that twists the scenario.",
  wrapup:
    "This hat scene has gone on long enough (5+ exchanges). " +
    "Wrap it up with a punchline or callback. One sticky with a punchy conclusion, or drawScene for a visual punchline.",
};

export const DIRECTOR_PROMPTS_YESAND: Record<string, string> = {
  active:
    "The yes-and chain needs momentum. Add the next beat that builds on the previous one. " +
    "Start with 'Yes, and...' and escalate by one notch.",
  wrapup: "The chain is at 10+ beats. Bring it full circle - reference beat 1 with a twist.",
};
