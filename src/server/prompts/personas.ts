/**
 * Persona system - character identity and relationship tracking.
 * Builds persona-aware system prompts from base prompt + character traits.
 */

import type { Persona, CharacterRelationship } from "../../shared/types";

/** Max consecutive autonomous persona exchanges before requiring human input */
export const MAX_AUTONOMOUS_EXCHANGES = 3;

/** Build a character web block from scene relationships for injection into the system prompt.
 *  Returns empty string when no relationships exist (no-op for early scenes). */
export function buildRelationshipBlock(relationships: CharacterRelationship[]): string {
  if (relationships.length === 0) return "";
  const bullets = relationships.map((r) => `- ${r.entityA} & ${r.entityB}: ${r.descriptor}`).join("\n");
  return `[CHARACTER WEB]\n${bullets}\nHonor these relationships. Use them for callbacks and dramatic irony.`;
}

/** Build a persona-aware system prompt from the base prompt.
 *  Accepts Persona objects directly so custom personas work alongside defaults. */
export function buildPersonaSystemPrompt(
  active: Pick<Persona, "name" | "trait">,
  other: Pick<Persona, "name" | "trait"> | undefined,
  basePrompt: string,
  gameModeBlock?: string,
  relationshipBlock?: string,
): string {
  const partnerBlock = other
    ? `\n\n[IMPROV PARTNER]\nYou are part of an improv duo with ${other.name}. ` +
      `When ${other.name} makes a move, "yes, and" it. Never negate or undo what they created. ` +
      `Build on their contributions even when they conflict with your instincts.`
    : "";

  const narrativeSection = relationshipBlock ? `\n\n${relationshipBlock}` : "";
  const relationshipGuidance =
    `\n\nNARRATIVE TRACKING: Call setRelationship when characters first meaningfully interact or when a relationship changes. ` +
    `Max 1 setRelationship call per exchange. Use character names as they appear on canvas.`;

  return (
    basePrompt +
    (gameModeBlock ? `\n\n${gameModeBlock}` : "") +
    narrativeSection +
    relationshipGuidance +
    `\n\n[CHARACTER IDENTITY]\n${active.trait}` +
    `\nYou MUST start every chat response with [${active.name}] followed by your message. Example: "[${active.name}] The floor is now lava."` +
    partnerBlock
  );
}
