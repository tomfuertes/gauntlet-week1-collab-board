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
    id: "vampire-dentist",
    label: "Vampire Dentist",
    icon: "\u{1F9DB}",
    displayText: "Set the scene: Vampire Dentist",
    description:
      "A dentist's office, but the dentist is a vampire. Dr. Fang nervously avoids mirrors and flinches at garlic mouthwash. The patient is suspiciously enthusiastic about the lack of windows. The dental chair reclines to a coffin-like angle. There's a sign saying 'No Garlic Gum Allowed', unusually opaque sunglasses on the counter, and a mirror turned face down.",
    objects: [
      frame("Dr. Fang's Dental Clinic", 50, 80, 900, 600),
      sticky("Dr. Fang - nervously avoids mirrors, flinches at garlic mouthwash", 60, 120, "#c084fc"),
      sticky("Patient - suspiciously enthusiastic about the lack of windows", 280, 120, "#fbbf24"),
      sticky("Dental chair - reclines to a coffin-like angle", 500, 120, "#60a5fa"),
      sticky("'No Garlic Gum Allowed'", 60, 350, "#f87171"),
      sticky("Unusually opaque sunglasses on the counter", 280, 350, "#fb923c"),
      sticky("A mirror - face down", 500, 350, "#4ade80"),
    ],
  },
  {
    id: "moon-job-interview",
    label: "Moon Job Interview",
    icon: "\u{1F311}",
    displayText: "Set the scene: Moon Job Interview",
    description:
      "A job interview taking place on the moon. The interviewer keeps floating out of their chair mid-question. The candidate brought a physical resume that won't stay on the table. HR is communicating via 4-second radio delay from Earth. There's a whiteboard that drifts away when you write on it, coffee in a squeeze pouch labeled 'Executive Blend', and a window with a very distracting Earth view.",
    objects: [
      frame("Lunar Corp - Interview Room 7", 50, 80, 900, 600),
      sticky("Interviewer - keeps floating out of their chair mid-question", 60, 120, "#60a5fa"),
      sticky("Candidate - brought a physical resume that won't stay on the table", 280, 120, "#fbbf24"),
      sticky("HR person - communicating via 4-second radio delay from Earth", 500, 120, "#c084fc"),
      sticky("A whiteboard that drifts away when you write on it", 60, 350, "#f87171"),
      sticky("Coffee in a squeeze pouch labeled 'Executive Blend'", 280, 350, "#fb923c"),
      sticky("Window with Earth view - very distracting", 500, 350, "#4ade80"),
    ],
  },
  {
    id: "cat-restaurant",
    label: "Cat Restaurant",
    icon: "\u{1F408}",
    displayText: "Set the scene: Cat Restaurant",
    description:
      "Two cats opening a restaurant. Chef Whiskers insists everything is better with tuna. Mittens runs front of house and pushes things off tables 'for ambiance'. The first customer is a very confused dog. The menu is all fish (the 'vegetarian option' is also fish), there's a cardboard box labeled 'VIP Seating', and the health inspector (a parrot) has arrived.",
    objects: [
      frame("Whiskers & Mittens' Bistro - Grand Opening", 50, 80, 900, 600),
      sticky("Chef Whiskers - insists everything is better with tuna", 60, 120, "#fb923c"),
      sticky("Mittens (front of house) - pushes things off tables 'for ambiance'", 280, 120, "#c084fc"),
      sticky("First customer - a very confused dog", 500, 120, "#fbbf24"),
      sticky("Menu: everything is fish. The 'vegetarian option' is also fish.", 60, 350, "#f87171"),
      sticky("A cardboard box labeled 'VIP Seating'", 280, 350, "#4ade80"),
      sticky("Health inspector (a parrot) arrives", 500, 350, "#60a5fa"),
    ],
  },
  {
    id: "alien-grocery",
    label: "Alien Grocery",
    icon: "\u{1F6F8}",
    displayText: "Set the scene: Alien Grocery",
    description:
      "An alien visiting a human grocery store for the first time. Zorblex has 6 arms but still can't figure out the self-checkout. The store employee is trying very hard to be helpful and not scream. A regular shopper is pretending nothing unusual is happening. There's a watermelon Zorblex thinks is an egg, a loyalty card he tries to eat, and a shopping cart with one wheel that squeaks interdimensionally.",
    objects: [
      frame("MegaMart - Aisle 7", 50, 80, 900, 600),
      sticky("Zorblex the alien - has 6 arms, still can't figure out the self-checkout", 60, 120, "#4ade80"),
      sticky("Store employee - trying very hard to be helpful and not scream", 280, 120, "#60a5fa"),
      sticky("Regular shopper - pretending nothing unusual is happening", 500, 120, "#fbbf24"),
      sticky("A watermelon - Zorblex thinks it's an egg", 60, 350, "#f87171"),
      sticky("Loyalty card - Zorblex tries to eat it", 280, 350, "#c084fc"),
      sticky("Shopping cart with one wheel that squeaks interdimensionally", 500, 350, "#fb923c"),
    ],
  },
  {
    id: "time-travel-cafe",
    label: "Time Travel Cafe",
    icon: "\u231A",
    displayText: "Set the scene: Time Travel Cafe",
    description:
      "A cafe where every customer is from a different time period. A Victorian gentleman is appalled by oat milk. The barista is from 2847 and confused by cash money. A medieval knight ordered a 'potion of wakefulness'. The menu has prices in 14 different currencies (and 3 barter options), the WiFi password is written in hieroglyphics, and the tip jar is also a time capsule.",
    objects: [
      frame("The Temporal Grind - Est. All Years", 50, 80, 900, 600),
      sticky("Victorian gentleman - appalled by oat milk", 60, 120, "#c084fc"),
      sticky("Barista from 2847 - confused by cash money", 280, 120, "#60a5fa"),
      sticky("Medieval knight - ordered a 'potion of wakefulness'", 500, 120, "#fbbf24"),
      sticky("A menu with prices in 14 different currencies (and 3 barter options)", 60, 350, "#f87171"),
      sticky("WiFi password written in hieroglyphics", 280, 350, "#4ade80"),
      sticky("A tip jar that's also a time capsule", 500, 350, "#fb923c"),
    ],
  },
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
