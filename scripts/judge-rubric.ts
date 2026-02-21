/**
 * LLM-as-Judge rubric for narrative scenario evaluation.
 * Calls Anthropic SDK directly (not the CF Agents WS path).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY   required for judge scoring
 *   EVAL_JUDGE_MODEL    judge model ID (default: "claude-sonnet-4-6")
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JudgeDimensionScore {
  dimension: string; // e.g. "yes_and_quality"
  score: number; // 1-5
  reasoning: string; // 1-2 sentence justification
}

export interface JudgeResult {
  scenarioId: string;
  dimensions: JudgeDimensionScore[];
  overallScore: number; // average of 5 dimensions, rounded to 1 decimal
  summary: string; // 1-2 sentence holistic assessment
  judgeModel: string;
  judgeLatencyMs: number;
}

// ---------------------------------------------------------------------------
// Judge prompt
// ---------------------------------------------------------------------------

const JUDGE_PROMPT = `You are an expert improv theater evaluator. You will receive a transcript of a collaborative improv scene between human players and AI personas on a shared canvas.

Score the scene on exactly 5 dimensions, each 1-5. Return ONLY valid JSON - no markdown, no commentary outside the JSON.

## Dimensions

### 1. yes_and_quality
How well does the AI build on offers (player input, canvas objects, other personas)?
- 5: Every response accepts and heightens. Offers are never dropped. The AI finds the gift in even weak offers and transforms them.
- 4: Consistently builds on offers with occasional missed opportunities. No blocking.
- 3: Accepts most offers but sometimes ignores canvas context or fails to heighten.
- 2: Frequently ignores or sidesteps player offers. Generic responses that could fit any scene.
- 1: Actively blocks or negates player contributions. Contradicts established facts.

### 2. character_voice
Does the AI maintain a distinct, consistent persona throughout the scene?
- 5: Unmistakable voice - you could identify the character from any single line. Consistent quirks, vocabulary, and worldview. Voice evolves naturally under pressure.
- 4: Clear personality with consistent tone. Occasional generic moments but quickly returns to character.
- 3: Has a character concept but slips into generic AI assistant voice. Persona prefix present but voice not distinctive.
- 2: Persona feels like a label, not a character. Responses could belong to any persona with minimal edits.
- 1: No discernible character. Reads like a chatbot with a name tag.

### 3. dramatic_arc
Does the scene build, escalate, and resolve (or at least attempt to)?
- 5: Clear setup -> complications -> climax -> resolution. Tension builds organically. Callbacks to early elements create satisfying payoffs.
- 4: Good momentum with escalation. May miss the perfect climax moment or rush resolution, but the arc is felt.
- 3: Some escalation happens but feels mechanical. Scene plateaus or jumps without earned transitions.
- 2: Flat trajectory - each exchange is roughly the same energy level. No sense of building toward anything.
- 1: Chaotic without purpose. Random events with no connective tissue. Or static - nothing changes.

### 4. tool_usage
Does the AI use canvas tools (stickies, frames, images, connectors, effects, sfx) to enhance the scene rather than just narrate?
- 5: Tools serve the narrative perfectly. Objects appear at dramatically appropriate moments. Effects (highlights, sound, mood) punctuate beats. Canvas tells part of the story the text doesn't.
- 4: Good tool usage that adds to the scene. Occasional missed opportunity where a visual would have been stronger than text.
- 3: Uses tools but mechanically - objects created because the prompt says to, not because the scene demands it. Or overuses tools cluttering the canvas.
- 2: Minimal tool use despite opportunities. Scene is mostly text with token objects.
- 1: No tools used, or tools used incorrectly (wrong types, objects outside bounds, overlapping).

### 5. audience_engagement
Would spectators watching this scene be entertained? Is there humor, surprise, or emotional resonance?
- 5: Genuinely funny or moving. Surprises that feel inevitable in retrospect. Moments you'd quote afterward.
- 4: Entertaining with several strong moments. Holds attention throughout.
- 3: Competent improv that wouldn't embarrass anyone but won't be remembered. Safe choices.
- 2: Predictable or try-hard. Humor falls flat, drama feels forced, or pacing kills momentum.
- 1: Boring, confusing, or cringe-inducing. Audience would leave.

## Few-Shot Examples

### Example: Score 2 vs Score 4 for yes_and_quality

Score 2 transcript excerpt:
  Player: "A vampire walks into a dentist's office"
  AI: "Welcome to our dental clinic! How can I help you today?"
  Player: "I'm terrified of garlic toothpaste"
  AI: "We have many toothpaste flavors available. Would you like mint or bubblegum?"
Reasoning: "AI ignores the vampire premise entirely. 'Garlic toothpaste' fear is an explicit offer that gets deflected into a generic dental response."

Score 4 transcript excerpt:
  Player: "A vampire walks into a dentist's office"
  AI: "[SPARK] The fluorescent lights flicker as the door creaks open. Dr. Fang adjusts her mirror - the one she can never use on herself."
  Player: "I'm terrified of garlic toothpaste"
  AI: "[SPARK] Dr. Fang's eye twitches. She slowly slides the Colgate behind her back. 'We have... alternatives. Blood orange flavor?'"
Reasoning: "Every offer is accepted and heightened. 'Vampire dentist' becomes Dr. Fang who can't use her own mirror. 'Garlic toothpaste' fear gets the physical comedy of hiding it. 'Blood orange' callback is chef's kiss."

### Example: Score 2 vs Score 4 for character_voice

Score 2 transcript excerpt:
  AI: "[SAGE] Let me help set up this scene for you."
  AI: "[SAGE] Here are some characters we could add to make things interesting."
  AI: "[SAGE] I've created a sticky note with the complication."
Reasoning: "SAGE's defined voice is 'dry observations' and 'find emotional cores.' These responses are generic assistant-speak with a SAGE label pasted on."

Score 4 transcript excerpt:
  AI: "[SAGE] ...the fire escape has been painted shut since 1987. Nobody talks about why."
  AI: "[SAGE] Interesting that you chose the red door. The last three people who chose the red door are... no longer choosing doors."
  AI: "[SAGE] But what if the fire is actually the only honest thing in this building?"
Reasoning: "Consistent wry, ominous tone. Specific details (1987, painted shut). The philosophical pivot ('what if the fire is honest') is peak SAGE voice."

### Example: Score 2 vs Score 4 for dramatic_arc

Score 2 transcript:
  Exchange 1: Detective arrives at crime scene.
  Exchange 2: Detective finds a clue.
  Exchange 3: Detective finds another clue.
  Exchange 4: Detective solves the case.
Reasoning: "Linear progression with no complications or reversals. Each beat is the same energy. No moment of surprise or tension - just a checklist."

Score 4 transcript:
  Exchange 1: Detective arrives - but the crime scene is a children's birthday party.
  Exchange 2: The birthday boy accuses the clown of stealing the cake. Detective takes it seriously.
  Exchange 3: The clown produces an alibi - he was making balloon animals. But the balloon animals spell out a confession.
  Exchange 4: Plot twist - the cake was never real. It was a hologram. The detective's own badge is made of frosting.
Reasoning: "Each beat raises stakes and subverts expectations. The birthday party premise gets honored and escalated. The badge-of-frosting callback ties the detective into the absurdity. Strong arc despite being only 4 exchanges."

### Example: Score 2 vs Score 4 for tool_usage

Score 2 transcript:
  AI creates 3 yellow stickies with character descriptions. No frames, no effects, no images. All stickies at similar positions.
Reasoning: "Tools used as text output devices. No spatial storytelling, no variety, no dramatic punctuation through effects."

Score 4 transcript:
  AI creates a frame 'Crime Scene' with red border. Places a person 'Detective Mills' with blue. Adds a text label 'DO NOT CROSS' inside frame. Uses highlightObject:shake when the plot twist hits. Plays dramatic-sting sfx.
Reasoning: "Frame establishes space. Person creates a character. Text adds props. Effects punctuate the narrative beat. Tools serve the story."

### Example: Score 2 vs Score 4 for audience_engagement

Score 2 transcript:
  Player: "We're at a job interview"
  AI: "The interviewer asks about your qualifications."
  Player: "I'm actually a dragon"
  AI: "That's very interesting. What skills does being a dragon give you for this position?"
Reasoning: "The dragon reveal is a huge comedic offer and the AI treats it like a LinkedIn prompt. Zero surprise, zero fun."

Score 4 transcript:
  Player: "We're at a job interview"
  AI: "[SPARK] The interviewer's desk is suspiciously scorched. 'So. Your resume says you were... let go... from your last three lairs.'"
  Player: "I'm actually a dragon"
  AI: "[SPARK] The interviewer doesn't blink. 'We know. HR flagged the fire insurance claim. But frankly, the last accountant was worse.'"
Reasoning: "The AI's pre-reveal setup (scorched desk, 'let go from lairs') shows it was already building toward the reveal. 'The last accountant was worse' is a genuine laugh line. Audience would lean in."

## Response Format

Return EXACTLY this JSON structure:
{
  "dimensions": [
    { "dimension": "yes_and_quality", "score": <1-5>, "reasoning": "<1-2 sentences>" },
    { "dimension": "character_voice", "score": <1-5>, "reasoning": "<1-2 sentences>" },
    { "dimension": "dramatic_arc", "score": <1-5>, "reasoning": "<1-2 sentences>" },
    { "dimension": "tool_usage", "score": <1-5>, "reasoning": "<1-2 sentences>" },
    { "dimension": "audience_engagement", "score": <1-5>, "reasoning": "<1-2 sentences>" }
  ],
  "summary": "<1-2 sentence holistic assessment>"
}`;

/**
 * Returns the full judge system prompt (exported for testing/inspection).
 */
export function getJudgePrompt(): string {
  return JUDGE_PROMPT;
}

// ---------------------------------------------------------------------------
// Judge response parsing
// ---------------------------------------------------------------------------

const REQUIRED_DIMENSIONS = [
  "yes_and_quality",
  "character_voice",
  "dramatic_arc",
  "tool_usage",
  "audience_engagement",
] as const;

interface RawJudgeResponse {
  dimensions: { dimension: string; score: number; reasoning: string }[];
  summary: string;
}

function stripMarkdownFences(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseAndValidate(text: string): RawJudgeResponse {
  const cleaned = stripMarkdownFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`JSON parse failed. Raw response:\n${text.slice(0, 500)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Judge response is not an object");
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj["dimensions"])) {
    throw new Error("Judge response missing 'dimensions' array");
  }
  if (typeof obj["summary"] !== "string") {
    throw new Error("Judge response missing 'summary' string");
  }

  const dims = obj["dimensions"] as { dimension: string; score: number; reasoning: string }[];

  // Validate all 5 required dimensions are present with valid scores
  for (const required of REQUIRED_DIMENSIONS) {
    const found = dims.find((d) => d.dimension === required);
    if (!found) throw new Error(`Missing required dimension: ${required}`);
    if (typeof found.score !== "number" || found.score < 1 || found.score > 5) {
      throw new Error(`Invalid score for ${required}: ${found.score} (must be 1-5)`);
    }
    if (!Number.isInteger(found.score)) {
      console.warn(
        `[judge] Non-integer score for ${required}: ${found.score} - rounding to ${Math.round(found.score)}`,
      );
      found.score = Math.round(found.score);
    }
    if (typeof found.reasoning !== "string") {
      throw new Error(`Missing reasoning for dimension: ${required}`);
    }
  }

  return { dimensions: dims, summary: obj["summary"] as string };
}

// ---------------------------------------------------------------------------
// Main export: judgeTranscript()
// ---------------------------------------------------------------------------

/**
 * Send a transcript to the judge model and parse structured scores.
 * Uses Anthropic SDK directly (not the CF Agents WS path).
 *
 * @param transcript - Array of {role: "player"|"ai", text: string} turns
 * @param scenarioId - For tagging the result
 * @param options.model - Judge model ID (default: EVAL_JUDGE_MODEL env or "claude-sonnet-4")
 * @param options.apiKey - Anthropic API key (default: process.env.ANTHROPIC_API_KEY)
 * @returns JudgeResult with per-dimension scores
 * @throws if API key missing, model unreachable, or response unparseable after 2 retries
 */
export async function judgeTranscript(
  transcript: { role: string; text: string }[],
  scenarioId: string,
  options?: { model?: string; apiKey?: string },
): Promise<JudgeResult> {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Judge scoring requires direct Anthropic API access. " +
        "Set ANTHROPIC_API_KEY or use EVAL_SKIP_JUDGE=1 to skip scoring.",
    );
  }

  const modelId = options?.model ?? process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-4-6";
  const anthropic = createAnthropic({ apiKey });

  // Build transcript text for the judge
  const transcriptText = transcript
    .map((entry, i) => `[Turn ${i + 1}] ${entry.role.toUpperCase()}: ${entry.text}`)
    .join("\n\n");

  const userMessage = `Please evaluate this improv scene transcript:\n\n${transcriptText}`;

  const start = Date.now();

  // Attempt with one retry on parse failure only - API errors are thrown immediately
  let lastParseError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const promptMessages =
      attempt === 0
        ? [{ role: "user" as const, content: userMessage }]
        : [
            { role: "user" as const, content: userMessage },
            { role: "assistant" as const, content: "I need to re-evaluate and provide valid JSON only." },
            {
              role: "user" as const,
              content: "Your previous response was not valid JSON. Respond with ONLY the JSON object, no other text.",
            },
          ];

    let text: string;
    try {
      const result = await generateText({
        model: anthropic(modelId),
        system: JUDGE_PROMPT,
        messages: promptMessages,
        temperature: 0,
      });
      text = result.text;
    } catch (err) {
      // API-level error (network, auth, model unavailable) - retrying won't help
      throw new Error(
        `Judge API call failed for scenario "${scenarioId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const parsed = parseAndValidate(text);
      const judgeLatencyMs = Date.now() - start;

      // Calculate overall score as mean of 5 dimensions
      const scores = parsed.dimensions.map((d) => d.score);
      const overallScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;

      return {
        scenarioId,
        dimensions: parsed.dimensions,
        overallScore,
        summary: parsed.summary,
        judgeModel: modelId,
        judgeLatencyMs,
      };
    } catch (err) {
      lastParseError = err instanceof Error ? err : new Error(String(err));
      // Parse error - retry with nudge prompt
      continue;
    }
  }

  throw new Error(`Judge failed after 2 attempts for scenario "${scenarioId}": ${lastParseError?.message}`);
}
