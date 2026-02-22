export interface QualitySignalContext {
  userMessage: string;
  aiResponse: string;
  toolCalls: string[];
  personas: string[];
  gameMode: string;
}

export interface QualitySignalScores {
  yesAnd: number;
  characterConsistency: number;
  sceneAdvancement: number;
  toolAppropriateness: number;
  reasoning: string;
}

/**
 * Build a compact prompt for per-turn quality scoring.
 * Returns JSON with 4 dimensions scored 0-3 each.
 * Kept under 500 tokens to minimize judge cost.
 */
export function buildQualitySignalPrompt(ctx: QualitySignalContext): string {
  const toolList = ctx.toolCalls.length > 0 ? ctx.toolCalls.join(", ") : "none";
  const personaList = ctx.personas.length > 0 ? ctx.personas.join(", ") : "unknown";

  return `You are a concise improv quality judge. Score this AI response on 4 dimensions (0-3 each).

SCORING RUBRIC:
- 0 = fails, 1 = weak, 2 = good, 3 = excellent

DIMENSIONS:
1. yesAnd: Did the AI accept and build on the player's offer? (0=blocked/ignored, 3=fully accepted+expanded)
2. characterConsistency: Did the active persona stay in character? (0=broke character, 3=strongly in character)
3. sceneAdvancement: Did the response move the scene forward with new information or action? (0=stalled, 3=clear forward momentum)
4. toolAppropriateness: Were tools used well? (createPerson/drawScene for visual content, createText only for dialogue; 0=wrong tools or none when needed, 3=ideal tool choices)

CONTEXT:
- Game mode: ${ctx.gameMode}
- Personas: ${personaList}
- Tools called: ${toolList}

PLAYER MESSAGE:
${ctx.userMessage.slice(0, 300)}

AI RESPONSE:
${ctx.aiResponse.slice(0, 400)}

Respond with ONLY valid JSON, no markdown:
{"yesAnd":0,"characterConsistency":0,"sceneAdvancement":0,"toolAppropriateness":0,"reasoning":"one sentence"}`;
}
