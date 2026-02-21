/**
 * Event-driven reactive prompts - injected in response to player/audience actions.
 * Each function builds a per-message system prompt injection for a specific event type.
 */

import type { CanvasAction, PollResult } from "../../shared/types";

// ---------------------------------------------------------------------------
// Plot twist pool
// ---------------------------------------------------------------------------

/** Curated dramatic complications for the [PLOT TWIST] mechanic.
 *  One random entry is selected per trigger. Genre-agnostic for any improv scenario. */
export const PLOT_TWISTS: readonly string[] = [
  "A health inspector walks in with a clipboard and a look of horror",
  "The lights suddenly go out - complete darkness",
  "Someone's phone rings - it's their mom calling at the worst possible moment",
  "A long-lost twin appears in the doorway",
  "A time skip - it's now 10 years later",
  "The floor starts flooding with a mysterious liquid",
  "A celebrity nobody expected walks through the door",
  "Everyone suddenly can only speak in rhyme",
  "A mysterious package arrives addressed to the last person who should receive it",
  "The building starts shaking - something enormous is approaching outside",
  "A newspaper headline reveals a shocking secret about someone in the room",
  "The fire alarm goes off - but the sprinklers dispense something other than water",
  "A lawyer bursts in with an urgent envelope marked 'OPEN IMMEDIATELY'",
  "The door locks from the outside - someone doesn't want them to leave",
  "A live TV news crew storms in with cameras rolling",
  "A time traveler bursts in warning everyone to stop what they're doing",
  "The room begins to slowly tilt to one side",
  "Every mirror in the room shatters simultaneously",
  "A trained bear in a tuxedo enters and takes a seat",
  "The ceiling opens and it starts raining glitter and fish",
];

/** Injected when a [PLOT TWIST] trigger fires. */
export function buildPlotTwistPrompt(twist: string): string {
  return (
    `[PLOT TWIST EVENT] A dramatic complication has just occurred: "${twist}"\n` +
    `RULES:\n` +
    `- This is REAL - treat it as an objective fact that just happened in the scene right now.\n` +
    `- React IN CHARACTER immediately. Your first line acknowledges the twist.\n` +
    `- Create a red sticky note (#f87171) on canvas with a short dramatic label (5 words max).\n` +
    `- Apply 'shake' effect to that sticky for impact.\n` +
    `- Then "yes, and" it - build on the complication, don't resolve it instantly.`
  );
}

// ---------------------------------------------------------------------------
// Canvas reaction
// ---------------------------------------------------------------------------

/** Summarizes player canvas mutations for the AI's in-character reaction. */
export function buildCanvasReactionPrompt(actions: CanvasAction[]): string {
  const summaries = actions
    .map((a) => {
      const who = a.username;
      if (a.type === "obj:create") {
        const what = a.objectType ?? "something";
        const label = a.text ? ` ('${a.text}')` : "";
        return `${who} placed a ${what}${label} on stage`;
      } else if (a.type === "obj:delete") {
        return `${who} removed something from the stage`;
      } else if (a.type === "obj:update" && a.text) {
        return `${who} changed text to '${a.text}'`;
      }
      return null;
    })
    .filter((s): s is string => s !== null);

  const summary = summaries.length > 0 ? summaries.join("; ") : "edited the canvas";
  return (
    `[CANVAS REACTION] The player just changed the scene: ${summary}. ` +
    `React IN CHARACTER with 1 sentence - what your character notices, says, or does in response. ` +
    `Optionally place 1 canvas object that builds on these changes. Brief and punchy. ` +
    `Do NOT use batchExecute.`
  );
}

// ---------------------------------------------------------------------------
// Tag-out
// ---------------------------------------------------------------------------

/** Injected when a player switches their persona claim mid-scene. */
export function buildTagOutPrompt(oldPersonaName: string, newPersonaName: string, playerName: string): string {
  return (
    `[TAG-OUT] ${playerName} just tagged out - switching from ${oldPersonaName} to ${newPersonaName}. ` +
    `Open your response with a 1-sentence theatrical handoff (e.g. "${oldPersonaName} exits stage left as ${newPersonaName} bursts through the door..."). ` +
    `Then continue the scene AS ${newPersonaName}. Brief and dramatic - keep the scene moving.`
  );
}

// ---------------------------------------------------------------------------
// Heckle
// ---------------------------------------------------------------------------

/** Injected when audience heckles have been buffered since the last AI response. */
export function buildHecklePrompt(heckles: string[]): string {
  const lines = heckles.map((h) => `"${h}"`).join("; ");
  return (
    `[HECKLE from audience] The audience just shouted: ${lines}\n` +
    `RULES:\n` +
    `- These are gifts from the spectators watching your scene. Treat them as "yes, and" offers.\n` +
    `- Acknowledge the audience participation briefly and in character - one sentence, then continue.\n` +
    `- Do NOT break the fourth wall or address "the audience" directly; weave it into the scene organically.\n` +
    `- Example: if heckled "your hat is on fire", a character might notice their hat smoking mid-sentence.`
  );
}

// ---------------------------------------------------------------------------
// Audience wave
// ---------------------------------------------------------------------------

const WAVE_DESCRIPTIONS: Record<string, string> = {
  "\uD83D\uDC4F": "erupted in applause", // 👏
  "\uD83D\uDE02": "burst out laughing", // 😂
  "\uD83D\uDD25": "lit up with fire energy", // 🔥
  "\u2764\uFE0F": "showered the stage with hearts", // ❤️
  "\uD83D\uDE2E": "gasped in collective surprise", // 😮
  "\uD83C\uDFAD": "roared with theatrical appreciation", // 🎭
};

/** Injected when 3+ spectators send the same emoji within 5s (audience wave). */
export function buildWavePrompt(emoji: string, count: number): string {
  const description = WAVE_DESCRIPTIONS[emoji] ?? "reacted strongly";
  return (
    `[AUDIENCE WAVE] ${count} spectators just ${description}!\n` +
    `RULES:\n` +
    `- This is atmospheric context, not a command. Let the audience energy color your next line.\n` +
    `- One brief in-character acknowledgment at most - then continue the scene naturally.\n` +
    `- Don't break the fourth wall or announce "the audience". Stay in the world of the scene.`
  );
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------

/** Injected when player-triggered sound effects need an in-character reaction. */
export function buildSfxReactionPrompt(sfxLabels: string[]): string {
  const cues = sfxLabels.join(", ");
  return (
    `[SOUND EFFECT: ${cues}] A player just triggered a sound effect on stage.\n` +
    `RULES:\n` +
    `- React IN CHARACTER immediately - 1 sentence acknowledging what the sound means in context.\n` +
    `- rimshot = a joke just landed; record-scratch = something surprising happened; thunder = drama arriving;\n` +
    `  sad-trombone = failure or disappointment; applause = triumph or bow; doorbell = visitor coming;\n` +
    `  dramatic-sting = plot twist moment; crickets = awkward silence.\n` +
    `- Optionally use play_sfx to respond with your own sound cue, or place 1 canvas object for emphasis.\n` +
    `- Brief and punchy - keep the scene moving.`
  );
}

// ---------------------------------------------------------------------------
// Director note
// ---------------------------------------------------------------------------

/** Injected when a user message starts with "note:" prefix. */
export function buildDirectorNotePrompt(username: string, noteContent: string): string {
  return (
    `[DIRECTOR NOTE from ${username}] "${noteContent}"\n` +
    `RULES:\n` +
    `- This is out-of-character guidance from a player-director, NOT scene dialogue.\n` +
    `- Acknowledge briefly IN CHARACTER (1 short sentence max), then adjust your performance accordingly.\n` +
    `- Do NOT treat this as a player action within the scene.`
  );
}

// ---------------------------------------------------------------------------
// Audience poll
// ---------------------------------------------------------------------------

/** Injected when an audience poll concludes with results. */
export function buildPollResultPrompt(result: PollResult): string {
  const pct = result.totalVotes > 0 ? Math.round(((result.votes[result.winner.id] ?? 0) / result.totalVotes) * 100) : 0;
  const breakdown = Object.entries(result.votes)
    .map(([optionId, count]) => {
      const label = optionId === result.winner.id ? result.winner.label : optionId;
      return `  ${label}: ${count} vote${count !== 1 ? "s" : ""}`;
    })
    .join("\n");
  return (
    `[AUDIENCE POLL RESULT] The audience has voted on: "${result.question}"\n` +
    `Winner: "${result.winner.label}" with ${pct}% of ${result.totalVotes} vote${result.totalVotes !== 1 ? "s" : ""}.\n` +
    `Vote breakdown:\n${breakdown}\n` +
    `RULES:\n` +
    `- The audience has spoken - honor their choice. Incorporate "${result.winner.label}" into the scene naturally.\n` +
    `- One brief in-character acknowledgment of the audience choice, then advance the scene with their decision.\n` +
    `- This is a yes-and offer from the audience. Build on it, don't explain it.`
  );
}

// ---------------------------------------------------------------------------
// QA command
// ---------------------------------------------------------------------------

/** Injected when a user message starts with "qa:" prefix. */
export function buildQACommandPrompt(command: string): string {
  return (
    `[QA TEST COMMAND] The user wants to test: "${command}"\n` +
    `RULES:\n` +
    `- Execute the appropriate tool call(s) directly to fulfill this request.\n` +
    `- Skip improv framing - minimal text, focus on tool execution.\n` +
    `- Confirm briefly after completing the action.`
  );
}
