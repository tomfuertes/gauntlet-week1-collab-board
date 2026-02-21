/** Scene starter templates - single source of truth for overlay chips + chat panel + server seeding.
 *
 *  KEY-DECISION 2026-02-19: Templates define typed BoardObject arrays instead of pseudocode text.
 *  The server seeds objects via Board DO RPC (guaranteed 7 objects), then sends the AI a narrative
 *  description to react to. This replaced LLM-parsed pseudocode which produced 1-4 objects unreliably. */

import type { BoardObject } from "./types";

export interface BoardTemplate {
  id: string;
  label: string;
  icon: string;
  /** Friendly text shown in the user's chat bubble (e.g., "Set the scene: Vampire Dentist") */
  displayText: string;
  /** Narrative description sent to the AI after objects are seeded */
  description: string;
  /** Predefined objects: 1 frame + 6 stickies. Server assigns id, createdBy, updatedAt at seed time. */
  objects: Omit<BoardObject, "id" | "createdBy" | "updatedAt">[];
}

/** Helper to define a sticky for a template (positions are relative to the frame) */
function sticky(
  text: string,
  x: number,
  y: number,
  color: string,
): Omit<BoardObject, "id" | "createdBy" | "updatedAt"> {
  return { type: "sticky", x, y, width: 200, height: 200, rotation: 0, props: { text, color } };
}

/** Helper to define a frame for a template */
function frame(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Omit<BoardObject, "id" | "createdBy" | "updatedAt"> {
  return { type: "frame", x, y, width, height, rotation: 0, props: { text } };
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
      frame("Heroes' Landing HOA - Monthly Meeting", 50, 80, 900, 600),
      sticky("HOA President (laser eyes) - keeps accidentally melting the gavel", 60, 120, "#f87171"),
      sticky("The Invisible Woman - nobody can tell if she's here", 280, 120, "#60a5fa"),
      sticky("Guy who controls weather - blamed for every bad BBQ", 500, 120, "#fbbf24"),
      sticky("Noise complaint: 'Someone keeps breaking the sound barrier at 3am'", 60, 350, "#fb923c"),
      sticky("Agenda item: 'Capes in the pool filter AGAIN'", 280, 350, "#c084fc"),
      sticky("Parking dispute - the Batmobile takes up 4 spaces", 500, 350, "#4ade80"),
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
      frame("Anchors Aweigh Wellness Center", 50, 80, 900, 600),
      sticky("Therapist - keeps saying 'and how did that make you feel' to people who say 'ARRR'", 60, 120, "#60a5fa"),
      sticky("Captain Blackbeard - having trouble with landlocked retirement", 280, 120, "#c084fc"),
      sticky("One-Eyed Peggy - refuses to do trust falls", 500, 120, "#fbbf24"),
      sticky("A comfort parrot that repeats your trauma back to you", 60, 350, "#4ade80"),
      sticky("Stress ball shaped like a cannonball", 280, 350, "#f87171"),
      sticky("Box of tissues and a treasure map to 'inner peace'", 500, 350, "#fb923c"),
    ],
  },
];

/** Lookup a template by ID. Returns undefined if not found. */
export function getTemplateById(id: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((t) => t.id === id);
}
