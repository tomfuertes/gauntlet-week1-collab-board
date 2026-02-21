/**
 * Improv challenge prompts for the daily challenge feature.
 * 63 entries, optional board template mapping, mixed game modes.
 *
 * KEY-DECISION 2026-02-20: Deterministic rotation via daysSinceEpoch % count - all users see the
 * same challenge every day without server state. Template IDs reference BOARD_TEMPLATES in
 * board-templates.ts to seed canvas objects before the AI responds.
 */

import type { GameMode } from "../shared/types";

export interface ChallengePromptDef {
  prompt: string;
  /** Optional: ties to a BoardTemplate ID for pre-seeded canvas objects */
  templateId?: string;
  gameMode: GameMode;
}

export interface ChallengePrompt extends ChallengePromptDef {
  /** Zero-based index into CHALLENGE_PROMPTS array */
  index: number;
}

export const CHALLENGE_PROMPTS: ChallengePromptDef[] = [
  // --- Template-backed scenes (pre-seeded canvas) ---
  {
    prompt: "A vampire is trying to run a respectable dental practice",
    gameMode: "freeform",
  },
  {
    prompt: "Job interviews in zero gravity on the moon",
    gameMode: "freeform",
  },
  {
    prompt: "Cats attempt to open a restaurant despite misunderstanding hospitality entirely",
    gameMode: "freeform",
  },
  {
    prompt: "An alien visits a grocery store and takes everything too literally",
    gameMode: "freeform",
  },
  {
    prompt: "A cafe where every customer is from a different era of history",
    gameMode: "freeform",
  },
  {
    prompt: "Superheroes navigate the mundane bureaucracy of a homeowners association",
    templateId: "superhero-hoa",
    gameMode: "freeform",
  },
  {
    prompt: "Retired pirates attend group therapy and refuse to do trust falls",
    templateId: "pirate-therapy",
    gameMode: "freeform",
  },

  // --- Workplace absurdity ---
  {
    prompt: "Things you should never say at a job interview but somehow say anyway",
    gameMode: "freeform",
  },
  {
    prompt: "The all-hands meeting where the CEO admits they have absolutely no idea what they're doing",
    gameMode: "freeform",
  },
  {
    prompt: "Performance review for someone whose job is to be a professional ghost",
    gameMode: "freeform",
  },
  {
    prompt: "If your office printer could voice its grievances at a union meeting",
    gameMode: "freeform",
  },
  {
    prompt: "The world's most passive-aggressive coworker has their retirement party",
    gameMode: "freeform",
  },
  {
    prompt: "A company that makes one thing terribly pivots to making everything else instead",
    gameMode: "freeform",
  },
  {
    prompt: "IT support for a haunted computer that is definitely not haunted",
    gameMode: "freeform",
  },
  {
    prompt: "The team building exercise nobody wanted becomes the thing everyone needed",
    gameMode: "yesand",
  },

  // --- Sci-fi / space ---
  {
    prompt: "Customer service at a space station that has a strict no-refunds policy",
    gameMode: "freeform",
  },
  {
    prompt: "The first Mars colony is exactly like Earth but with dramatically worse parking",
    gameMode: "freeform",
  },
  {
    prompt: "A robot therapist tries to understand human emotions using only a flowchart",
    gameMode: "freeform",
  },
  {
    prompt: "Galactic DMV: bureaucracy has spread to the stars and nobody is happy about it",
    gameMode: "freeform",
  },
  {
    prompt: "A time traveler gets stuck in the present and has to blend in without any modern skills",
    gameMode: "freeform",
  },
  {
    prompt: "First contact goes poorly because the alien communicates exclusively in corporate buzzwords",
    gameMode: "freeform",
  },
  {
    prompt: "The AI running the spaceship has developed very strong opinions about the interior decor",
    gameMode: "freeform",
  },
  {
    prompt: "Space pirates discover they have been accidentally recycling their loot to the wrong dimension",
    gameMode: "freeform",
  },

  // --- Fantasy / magic ---
  {
    prompt: "The worst wizard spells you would actually use in everyday life",
    gameMode: "freeform",
  },
  {
    prompt: "A dragon discovers there is a mortgage on their treasure hoard",
    gameMode: "freeform",
  },
  {
    prompt: "The enchanted forest is undergoing rapid gentrification and the woodland creatures are not pleased",
    gameMode: "freeform",
  },
  {
    prompt: "A curse turns everyone into their own LinkedIn profile headline",
    gameMode: "freeform",
  },
  {
    prompt: "Magic school has budget cuts and half the wands are malfunctioning",
    gameMode: "freeform",
  },
  {
    prompt: "The oracle gives vague predictions but has a Yelp page with very specific negative reviews",
    gameMode: "freeform",
  },
  {
    prompt: "A hero must defeat the villain but they went to school together and it is deeply awkward",
    gameMode: "freeform",
  },
  {
    prompt: "The fairy godmother misread the request form and now everything is subtly but irreversibly wrong",
    gameMode: "freeform",
  },

  // --- Animals / nature ---
  {
    prompt: "If animals had corporate jobs and took them extremely seriously",
    gameMode: "freeform",
  },
  {
    prompt: "A nature documentary about humans narrated by a deeply confused penguin",
    gameMode: "freeform",
  },
  {
    prompt: "The neighborhood raccoons form a union and negotiate for better trash can access",
    gameMode: "freeform",
  },
  {
    prompt: "A pet owner and their pet have switched bodies and must navigate each other's entire day",
    gameMode: "freeform",
  },
  {
    prompt: "The world's last great migration gets delayed because there is road construction on the highway",
    gameMode: "freeform",
  },
  {
    prompt: "A fish tank community builds a civilization while the humans are on a two-week vacation",
    gameMode: "freeform",
  },

  // --- Historical / time ---
  {
    prompt: "Things overheard at a pirate HR meeting about maritime harassment policy",
    gameMode: "freeform",
  },
  {
    prompt: "Historical figures get access to a group chat and immediately start unnecessary drama",
    gameMode: "freeform",
  },
  {
    prompt: "A time traveler tries to explain the present to someone from two hundred years ago",
    gameMode: "freeform",
  },
  {
    prompt: "Napoleon discovers he was actually just having a particularly good posture day",
    gameMode: "freeform",
  },
  {
    prompt: "The caveperson who invented fire immediately positions themselves as a consultant",
    gameMode: "freeform",
  },
  {
    prompt: "Ancient Romans leave increasingly passive-aggressive feedback on each other's construction projects",
    gameMode: "freeform",
  },

  // --- Relationship / social ---
  {
    prompt: "Bad ways to propose marriage",
    gameMode: "freeform",
  },
  {
    prompt: "Two strangers realize they have been accidentally living each other's calendar for an entire week",
    gameMode: "freeform",
  },
  {
    prompt: "The rejected greeting card message that somehow found its exact perfect recipient",
    gameMode: "freeform",
  },
  {
    prompt: "A first date at a restaurant where the waiter clearly knows too much about both of them",
    gameMode: "freeform",
  },
  {
    prompt: "The world's most aggressively literal matchmaking service finds you your perfect match",
    gameMode: "freeform",
  },
  {
    prompt: "Things you think but never say while stuck in an elevator",
    gameMode: "freeform",
  },
  {
    prompt: "Two nemeses discover they are each other's closest online friend",
    gameMode: "yesand",
  },
  {
    prompt: "A family reunion where everyone has accidentally brought the same secret to confess",
    gameMode: "freeform",
  },

  // --- Absurd / surreal ---
  {
    prompt: "Secret thoughts of a traffic cone who has seen far too much",
    gameMode: "freeform",
  },
  {
    prompt: "The person who invented the word moist is on trial and the courtroom has opinions",
    gameMode: "freeform",
  },
  {
    prompt: "A haunted house ghost is exhausted and files for a workplace accommodation",
    gameMode: "freeform",
  },
  {
    prompt: "The committee tasked with inventing the number eight cannot agree on its final shape",
    gameMode: "freeform",
  },
  {
    prompt: "Rejected theme park ride concepts from a theme park that is willing to take any risk",
    gameMode: "freeform",
  },
  {
    prompt: "The thing at the back of the refrigerator becomes sentient and demands recognition",
    gameMode: "freeform",
  },
  {
    prompt: "Everyone in the waiting room is waiting for something completely different and all brought snacks",
    gameMode: "freeform",
  },
  {
    prompt: "The floor is lava but it is also a mandatory workplace safety seminar",
    gameMode: "freeform",
  },

  // --- Yes-and chains ---
  {
    prompt: "Yes-and: The vending machine started talking back during the morning rush",
    gameMode: "yesand",
  },
  {
    prompt: "Yes-and: The elevator music turned out to be a distress signal",
    gameMode: "yesand",
  },
  {
    prompt: "Yes-and: The PowerPoint presentation achieved consciousness mid-meeting",
    gameMode: "yesand",
  },
  {
    prompt: "Yes-and: The fire drill was real but nobody told the dragon living in the basement",
    gameMode: "yesand",
  },
];

/**
 * Returns the challenge prompt for a given date string (YYYY-MM-DD UTC).
 * Deterministic: same date always returns same prompt across all workers.
 */
export function getDailyChallengePrompt(dateStr: string): ChallengePrompt {
  const dayMs = new Date(dateStr + "T00:00:00Z").getTime();
  const daysSinceEpoch = Math.floor(dayMs / 86400000);
  const index = ((daysSinceEpoch % CHALLENGE_PROMPTS.length) + CHALLENGE_PROMPTS.length) % CHALLENGE_PROMPTS.length;
  return { ...CHALLENGE_PROMPTS[index], index };
}
