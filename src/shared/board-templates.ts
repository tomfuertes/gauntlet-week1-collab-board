/** Scene starter templates - single source of truth for overlay chips + chat panel + server seeding.
 *
 *  KEY-DECISION 2026-02-19: Templates define typed BoardObject arrays instead of pseudocode text.
 *  The server seeds objects via Board DO RPC (guaranteed objects), then sends the AI a narrative
 *  description to react to. This replaced LLM-parsed pseudocode which produced 1-4 objects unreliably.
 *  KEY-DECISION 2026-02-22: Templates use person + text objects (not stickies in frames).
 *  Characters are persons, props/items are text labels. Stickies reserved for player use. */

import type { BoardObject } from "./types";

export interface BoardTemplate {
  id: string;
  label: string;
  icon: string;
  /** Friendly text shown in the user's chat bubble (e.g., "Set the scene: Vampire Dentist") */
  displayText: string;
  /** Narrative description sent to the AI after objects are seeded */
  description: string;
  /** Predefined objects seeded on the board. Server assigns id, createdBy, updatedAt at seed time. */
  objects: Omit<BoardObject, "id" | "createdBy" | "updatedAt">[];
}

/** Helper to define a person (stick figure character) for a template */
function person(
  name: string,
  x: number,
  y: number,
  color: string,
): Omit<BoardObject, "id" | "createdBy" | "updatedAt"> {
  return { type: "person", x, y, width: 80, height: 120, rotation: 0, props: { text: name, color } };
}

/** Helper to define a text label for a template */
function text(
  content: string,
  x: number,
  y: number,
  color = "#1a1a2e",
): Omit<BoardObject, "id" | "createdBy" | "updatedAt"> {
  const width = Math.max(40, content.length * 8 + 16);
  return { type: "text", x, y, width, height: 24, rotation: 0, props: { text: content, color } };
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "superhero-hoa",
    label: "Superhero HOA",
    icon: "\u{1F9B8}",
    displayText: "Set the scene: Superhero HOA",
    description:
      "A homeowners association meeting for superheroes. The HOA President has laser eyes and keeps accidentally melting the gavel. The Invisible Woman is here but nobody can tell. The weather-control guy is blamed for every bad BBQ. There's a noise complaint about someone breaking the sound barrier at 3am, an agenda item about 'capes in the pool filter AGAIN', and a parking dispute because the Batmobile takes up 4 spaces.",
    objects: [
      person("HOA President", 100, 150, "#f87171"),
      person("Invisible Woman", 250, 150, "#60a5fa"),
      person("Weather Guy", 400, 150, "#fbbf24"),
      text("Noise complaint: breaking the sound barrier at 3am", 80, 320, "#fb923c"),
      text("Agenda: capes in the pool filter AGAIN", 80, 360, "#c084fc"),
      text("Parking dispute: Batmobile takes 4 spaces", 80, 400, "#4ade80"),
    ],
  },
  {
    id: "pirate-therapy",
    label: "Pirate Therapy",
    icon: "\u{1F3F4}\u200D\u2620\uFE0F",
    displayText: "Set the scene: Pirate Therapy",
    description:
      "A group therapy session for retired pirates. The therapist keeps saying 'and how did that make you feel' to people who say 'ARRR'. Captain Blackbeard is having trouble with landlocked retirement. One-Eyed Peggy refuses to do trust falls. There's a comfort parrot that repeats your trauma back to you, a stress ball shaped like a cannonball, and a box of tissues with a treasure map to 'inner peace'.",
    objects: [
      person("Therapist", 100, 150, "#60a5fa"),
      person("Capt. Blackbeard", 250, 150, "#c084fc"),
      person("One-Eyed Peggy", 400, 150, "#fbbf24"),
      text("Comfort parrot that repeats your trauma", 80, 320, "#4ade80"),
      text("Stress ball shaped like a cannonball", 80, 360, "#f87171"),
      text("Tissues + treasure map to inner peace", 80, 400, "#fb923c"),
    ],
  },
];

/** Lookup a template by ID. Returns undefined if not found. */
export function getTemplateById(id: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((t) => t.id === id);
}
