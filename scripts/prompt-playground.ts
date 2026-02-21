/**
 * Rapid prompt iteration playground - direct AI SDK call, no server needed.
 * Usage: npx tsx scripts/prompt-playground.ts [options] "your message here"
 *   --persona spark|sage    (default: spark)
 *   --mode freeform|hat|yesand|freezetag  (default: freeform)
 *   --model <AIModel id>    (default: claude-haiku-4.5)
 *   --turn <number>         (default: 1) simulated turn, affects lifecycle phase
 *
 * API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY
 */

import { parseArgs } from "node:util";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  SYSTEM_PROMPT,
  SCENE_SETUP_PROMPT,
  buildPersonaSystemPrompt,
  buildGameModePromptBlock,
  computeLifecyclePhase,
  buildLifecycleBlock,
  PROMPT_VERSION,
} from "../src/server/prompts.js";
import { DEFAULT_PERSONAS, AI_MODELS } from "../src/shared/types.js";
import type { GameMode, BoardStub } from "../src/shared/types.js";
import { createSDKTools } from "../src/server/ai-tools-sdk.js";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    persona: { type: "string", default: "spark" },
    mode: { type: "string", default: "freeform" },
    model: { type: "string", default: "claude-haiku-4.5" },
    turn: { type: "string", default: "1" },
  },
  allowPositionals: true,
});

const message = positionals.join(" ").trim();
if (!message) {
  console.error('Usage: npx tsx scripts/prompt-playground.ts [options] "your message"');
  process.exit(1);
}

const personaName = (values.persona as string).toLowerCase();
const mode = values.mode as GameMode;
const modelId = values.model as string;
const turn = parseInt(values.turn as string, 10);

// ---------------------------------------------------------------------------
// Resolve persona and model
// ---------------------------------------------------------------------------

const persona = DEFAULT_PERSONAS.find((p) => p.name.toLowerCase() === personaName);
if (!persona) {
  console.error(
    `Unknown persona: ${personaName}. Available: ${DEFAULT_PERSONAS.map((p) => p.name.toLowerCase()).join(", ")}`,
  );
  process.exit(1);
}
const otherPersona = DEFAULT_PERSONAS.find((p) => p.name.toLowerCase() !== personaName);

const modelEntry = AI_MODELS.find((m) => m.id === modelId);
if (!modelEntry) {
  console.error(`Unknown model: ${modelId}. Available: ${AI_MODELS.map((m) => m.id).join(", ")}`);
  process.exit(1);
}
if (modelEntry.provider === "workers-ai") {
  console.error(`workers-ai models require CF runtime. Use an anthropic or openai model.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Assemble system prompt (mirrors chat-agent.ts onChatMessage logic)
// ---------------------------------------------------------------------------

// KEY-DECISION 2026-02-21: Mirrors the 3-layer assembly in chat-agent.ts:
// (1) persona identity + optional game mode, (2) lifecycle block, (3) scene setup on turn 1.
// Omits template/intent/budget/heckle injections - playground targets core prompt behavior.
const gameModeBlock = mode !== "freeform" ? buildGameModePromptBlock(mode, {}) : undefined;
const lifecyclePhase = computeLifecyclePhase(turn);
let systemPrompt = buildPersonaSystemPrompt(persona, otherPersona, SYSTEM_PROMPT, gameModeBlock);
if (mode !== "hat") {
  systemPrompt += `\n\n${buildLifecycleBlock(lifecyclePhase)}`;
}
if (turn <= 1) {
  systemPrompt += `\n\n${SCENE_SETUP_PROMPT}`;
}

// ---------------------------------------------------------------------------
// Create model instance
// ---------------------------------------------------------------------------

const model =
  modelEntry.provider === "anthropic" ? createAnthropic()(modelEntry.modelId) : createOpenAI()(modelEntry.modelId);

// ---------------------------------------------------------------------------
// Mock BoardStub - any method returns success so tool schemas are real but mutations go nowhere
//
// KEY-DECISION 2026-02-21: Proxy approach avoids manually implementing the full BoardStub
// interface. The model gets real tool schemas (Zod-validated) and will attempt realistic
// tool calls, but canvas mutations are noops. generateImage will throw if called since
// ai binding is undefined - acceptable for text-focused prompt iteration.
// ---------------------------------------------------------------------------
const mockStub = new Proxy({} as BoardStub, {
  get: () => () => Promise.resolve({ ok: true, success: true, id: "playground-mock" }),
});

const tools = createSDKTools(mockStub);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`[${PROMPT_VERSION}] Model: ${modelId} | Persona: ${persona.name} | Mode: ${mode} | Turn: ${turn}`);
console.log(`System prompt: ${systemPrompt.length.toLocaleString()} chars`);
console.log("---");

const t0 = Date.now();
const { text, toolCalls, usage } = await generateText({
  model,
  system: systemPrompt,
  messages: [{ role: "user", content: message }],
  tools,
  stopWhen: stepCountIs(2),
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

if (text) console.log(text);
console.log("---");

if (toolCalls && toolCalls.length > 0) {
  const callsStr = toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.input)})`).join(", ");
  console.log(`Tool calls: ${callsStr}`);
}

const tokensIn = usage?.inputTokens ?? 0;
const tokensOut = usage?.outputTokens ?? 0;
console.log(`Tokens: ${tokensIn.toLocaleString()} in / ${tokensOut.toLocaleString()} out | ${elapsed}s`);
