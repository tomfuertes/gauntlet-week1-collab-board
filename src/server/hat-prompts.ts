/**
 * Curated scene prompts for "Scenes From a Hat" game mode.
 * Each prompt is a short improv scenario players and AI riff on for ~5 exchanges.
 */

export const HAT_PROMPTS: string[] = [
  // Workplace
  "Things you shouldn't say at a job interview",
  "Worst reasons to call in sick",
  "If your boss was a supervillain",
  "Awkward things to overhear in the break room",
  "The worst motivational posters",

  // Relationships
  "Bad ways to propose",
  "Things you wish you could say to your neighbor",
  "The world's worst dating profile",
  "Rejected greeting card messages",
  "Things you shouldn't say at a wedding",

  // Sci-fi / Fantasy
  "Complaints at a space station customer service desk",
  "Rejected superhero origin stories",
  "Things a time traveler should never do",
  "The worst wizard spells",
  "If aliens judged Earth by its TV shows",

  // Absurd
  "Secret thoughts of a traffic cone",
  "If animals had corporate jobs",
  "The world's least useful invention",
  "Things a haunted house ghost is tired of",
  "Rejected theme park rides",

  // Historical
  "Deleted scenes from history",
  "If historical figures had social media",
  "The worst advice from a fortune cookie",
  "Things overheard at a pirate HR meeting",
  "If Shakespeare wrote your grocery list",

  // Everyday
  "Things you think but never say in an elevator",
  "The worst thing to say when meeting your partner's parents",
  "Unlikely things to hear on a nature documentary",
  "If your pet could talk back",
  "Things a GPS would say if it had feelings",
  "Bad things to say to a dentist mid-procedure",
  "Rejected children's book titles",
];

/** Pick a random hat prompt, optionally excluding one index to avoid repeats */
export function getRandomHatPrompt(excludeIndex?: number): { prompt: string; index: number } {
  const available = HAT_PROMPTS.map((prompt, index) => ({ prompt, index })).filter((_, i) => i !== excludeIndex);
  if (available.length === 0) {
    return { prompt: HAT_PROMPTS[0], index: 0 };
  }
  return available[Math.floor(Math.random() * available.length)];
}
