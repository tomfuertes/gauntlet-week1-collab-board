/**
 * Genetic prompt tuner for scene-setup scenarios.
 *
 * Hill-climbs through prompt space (6 scene-setup × 5 tool-mandate genes = 30 combos)
 * to find language that makes claude-haiku-4.5 reliably call createFrame + createPerson x3.
 *
 * Usage:
 *   set -a && source .dev.vars && set +a
 *   npx tsx scripts/prompt-genetic.ts
 */

import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { writeFileSync } from "fs";
import path from "path";
import {
  SYSTEM_PROMPT,
  SCENE_SETUP_PROMPT,
  buildPersonaSystemPrompt,
  computeLifecyclePhase,
  buildLifecycleBlock,
} from "../src/server/prompts/index.js";
import { DEFAULT_PERSONAS } from "../src/shared/types.js";
import type { BoardStub, BoardObject, BoardMutation } from "../src/shared/types.js";
import { createSDKTools } from "../src/server/ai-tools-sdk.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCENARIO_PROMPT = "Set up a dentist office scene with a frame and 3 named characters inside it";
const MODEL_ID = "claude-haiku-4-5-20251001";
const ROUNDS = 30;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Run: set -a && source .dev.vars && set +a");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Prompt genes (mutation candidates)
// The first entry in each array is the current production prompt (gene index 0 = base).
// ---------------------------------------------------------------------------

// Extracted verbatim from system.ts TOOL RULES first bullet - used for string replacement
const BASE_TOOL_MANDATE =
  "- The canvas IS your stage. Every response MUST include at least one VISUAL tool call: createPerson for characters, drawScene for props/effects, or highlightObject/play_sfx for dramatic punctuation. Text-only responses with no visual tools are a failed performance.";

const TOOL_MANDATE_GENES: string[] = [
  BASE_TOOL_MANDATE, // 0: base (current)
  // 1: primary job framing
  "- YOUR PRIMARY JOB IS CALLING TOOLS. Before writing any chat text, call createPerson, createFrame, or drawScene. Your visual actions appear ON CANVAS; your words appear in chat. Text-only responses = failed performance.",
  // 2: hard cap - no exceptions
  "- CANVAS ALWAYS. Every response MUST call at least one canvas creation tool. createPerson (characters), createFrame (locations), drawScene (props). Text without any tool call is a failure mode - no exceptions.",
  // 3: anti-pattern explicit
  "- Text-only responses are PROHIBITED. Silent canvas = failed performance. ALWAYS call at least one of: createPerson, createFrame, drawScene, createShape before or alongside your in-character line. Canvas objects first, words second.",
  // 4: canvas-first role
  "- You are a CANVAS-FIRST improv partner. Your visual instinct fires before your verbal instinct. Every exchange: place an object (createPerson, drawScene, createFrame), THEN speak. Canvas objects are not optional.",
];

const SCENE_SETUP_GENES: string[] = [
  SCENE_SETUP_PROMPT, // 0: base (current)

  // 1: explicit numbered steps with tool names
  `SCENE SETUP - 4 MANDATORY TOOL CALLS on this first exchange:
1. createFrame(title="[location name]") - place the location container
2. createPerson(name="[character 1]") - first named character inside the frame
3. createPerson(name="[character 2]") - second named character inside the frame
4. createPerson(name="[character 3]") - third named character inside the frame
These 4 calls are REQUIRED. Do NOT skip them. Text-only = failed scene.`,

  // 2: with concrete example
  `SCENE SETUP: On this first exchange, build the world visually.
Example - "Set up a coffee shop with 2 baristas":
  -> createFrame(title="The Coffee Shop")
  -> createPerson(name="Barista Sam", color="#f87171")
  -> createPerson(name="Barista Jo", color="#60a5fa")
Follow this pattern for any scene setup: frame first, characters inside. Props optional.`,

  // 3: anti-pattern focus
  `SCENE SETUP: NEVER respond to a scene setup with text only.
First exchange REQUIRES:
- createFrame for the location (NOT optional)
- createPerson x2-3 for named characters (NOT optional)
Text narration comes AFTER the objects exist on canvas. Objects first, always.`,

  // 4: role framing (stage technician)
  `[SCENE SETUP MODE]: You are a stage technician setting up for the show.
Your first action: build the physical space.
- createFrame: deploy the location (frame title = venue name)
- createPerson x2-3: place the actors (name = character name)
No words until the stage is set. The canvas must have real objects before you speak.`,

  // 5: count-first checklist
  `SCENE SETUP: First exchange = minimum 3 canvas objects.
Required checklist:
[x] createFrame - the location/venue (title = the place name)
[x] createPerson - named character 1 (name = actual character name)
[x] createPerson - named character 2 (name = actual character name)
[ ] createPerson - named character 3 (optional, if scene warrants)
Check off each item. A canvas with no objects is not a scene.`,
];

// ---------------------------------------------------------------------------
// Genome = pair of gene indices
// ---------------------------------------------------------------------------

type Genome = {
  sceneSetupIdx: number; // index into SCENE_SETUP_GENES
  toolMandateIdx: number; // index into TOOL_MANDATE_GENES
};

const BASE_GENOME: Genome = { sceneSetupIdx: 0, toolMandateIdx: 0 };

function describeGenome(g: Genome): string {
  const sceneLabels = [
    "base",
    "explicit-4-steps",
    "with-example",
    "anti-pattern",
    "stage-tech-role",
    "count-checklist",
  ];
  const toolLabels = ["base", "primary-job", "hard-cap", "anti-pattern", "canvas-first-role"];
  return `scene[${g.sceneSetupIdx}:${sceneLabels[g.sceneSetupIdx]}] + tool[${g.toolMandateIdx}:${toolLabels[g.toolMandateIdx]}]`;
}

// Mutate: 80% hill-climb (change one gene), 20% random restart
function mutate(g: Genome): { child: Genome; mutationType: string } {
  if (Math.random() < 0.2) {
    const child: Genome = {
      sceneSetupIdx: Math.floor(Math.random() * SCENE_SETUP_GENES.length),
      toolMandateIdx: Math.floor(Math.random() * TOOL_MANDATE_GENES.length),
    };
    return { child, mutationType: `random-restart(s${child.sceneSetupIdx}t${child.toolMandateIdx})` };
  }

  if (Math.random() < 0.5) {
    const newIdx = Math.floor(Math.random() * SCENE_SETUP_GENES.length);
    return {
      child: { ...g, sceneSetupIdx: newIdx },
      mutationType: `scene_setup[${newIdx}]`,
    };
  } else {
    const newIdx = Math.floor(Math.random() * TOOL_MANDATE_GENES.length);
    return {
      child: { ...g, toolMandateIdx: newIdx },
      mutationType: `tool_mandate[${newIdx}]`,
    };
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildSystemPrompt(genome: Genome): string {
  const [spark, sage] = DEFAULT_PERSONAS;

  // Apply tool mandate mutation: replace first TOOL RULES bullet in SYSTEM_PROMPT
  const mutatedSystemPrompt = SYSTEM_PROMPT.replace(
    BASE_TOOL_MANDATE,
    TOOL_MANDATE_GENES[genome.toolMandateIdx],
  );

  // Assemble full system prompt (mirrors chat-agent.ts onChatMessage logic, turn=1)
  const lifecyclePhase = computeLifecyclePhase(1);
  let systemPrompt = buildPersonaSystemPrompt(spark, sage, mutatedSystemPrompt);
  systemPrompt += `\n\n${buildLifecycleBlock(lifecyclePhase)}`;
  systemPrompt += `\n\n${SCENE_SETUP_GENES[genome.sceneSetupIdx]}`;

  return systemPrompt;
}

// ---------------------------------------------------------------------------
// Mock BoardStub - logs obj:create calls to track what the model actually created
// ---------------------------------------------------------------------------

function createMockStub(): { stub: BoardStub; getCreatedTypes: () => string[] } {
  const createdTypes: string[] = [];

  const stub: BoardStub = {
    readObjects: async () => [],
    readObject: async () => null,
    mutate: async (msg: BoardMutation) => {
      if (msg.type === "obj:create") {
        createdTypes.push((msg as { type: "obj:create"; obj: BoardObject }).obj.type);
      }
      return { ok: true };
    },
    injectCursor: async () => {},
    saveCriticReview: async () => {},
    createPoll: async () => ({ ok: true }),
  };

  return { stub, getCreatedTypes: () => [...createdTypes] };
}

// ---------------------------------------------------------------------------
// Scoring (0-100)
// ---------------------------------------------------------------------------

interface ScoreDetails {
  frameCreated: boolean;
  personCount: number;
  objectCount: number;
  totalToolCalls: number;
  score: number;
}

function computeScore(createdTypes: string[], totalToolCalls: number): ScoreDetails {
  const frameCreated = createdTypes.includes("frame");
  const personCount = createdTypes.filter((t) => t === "person").length;
  const objectCount = createdTypes.length;

  let score = 0;

  // Frame (35 pts) - required for scene-setup
  if (frameCreated) score += 35;

  // Persons (15 pts each, max 3×15=45)
  score += Math.min(personCount, 3) * 15;

  // Has any visual objects (5 pts bonus)
  if (objectCount > 0) score += 5;

  // Object count bonus (10 pts for 4+ = frame + 3 chars)
  if (objectCount >= 4) score += 10;
  else if (objectCount >= 3) score += 5;

  // Penalty: no tool calls at all
  if (totalToolCalls === 0) score = Math.max(0, score - 15);

  score = Math.min(100, score);

  return { frameCreated, personCount, objectCount, totalToolCalls, score };
}

// ---------------------------------------------------------------------------
// Run Haiku against the scenario
// ---------------------------------------------------------------------------

const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY });

interface RunResult {
  details: ScoreDetails;
  toolCallNames: string[];
  createdTypes: string[];
  tokenCount: number;
}

async function runHaiku(genome: Genome): Promise<RunResult> {
  const systemPrompt = buildSystemPrompt(genome);
  const { stub, getCreatedTypes } = createMockStub();
  const tools = createSDKTools(stub);

  const { toolCalls = [], usage } = await generateText({
    model: anthropic(MODEL_ID),
    system: systemPrompt,
    messages: [{ role: "user", content: `Tom: ${SCENARIO_PROMPT}` }],
    tools,
    stopWhen: stepCountIs(2),
  });

  const createdTypes = getCreatedTypes();
  const details = computeScore(createdTypes, toolCalls.length);
  const toolCallNames = toolCalls.map((tc) => tc.toolName);

  return {
    details,
    toolCallNames,
    createdTypes,
    tokenCount: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Main genetic loop
// ---------------------------------------------------------------------------

type ScoredRound = {
  round: number;
  genome: Genome;
  details: ScoreDetails;
  mutationType: string;
  toolCallNames: string[];
  createdTypes: string[];
};

async function main() {
  console.log(`\nGenetic prompt tuner - ${ROUNDS} rounds on ${MODEL_ID}`);
  console.log(`Scenario: "${SCENARIO_PROMPT}"`);
  console.log(
    `Search space: ${SCENE_SETUP_GENES.length} scene-setup genes × ${TOOL_MANDATE_GENES.length} tool-mandate genes = ${SCENE_SETUP_GENES.length * TOOL_MANDATE_GENES.length} combos\n`,
  );

  const allRounds: ScoredRound[] = [];

  // Round 0: score the base prompt
  console.log("Round 0: Scoring base prompt...");
  const baseRun = await runHaiku(BASE_GENOME);
  const baseRound: ScoredRound = {
    round: 0,
    genome: BASE_GENOME,
    details: baseRun.details,
    mutationType: "base",
    toolCallNames: baseRun.toolCallNames,
    createdTypes: baseRun.createdTypes,
  };
  allRounds.push(baseRound);

  console.log(`  Score: ${baseRun.details.score}/100`);
  console.log(
    `  frame=${baseRun.details.frameCreated} persons=${baseRun.details.personCount} objects=${baseRun.details.objectCount} toolCalls=${baseRun.details.totalToolCalls}`,
  );
  console.log(`  Tools: [${baseRun.toolCallNames.join(", ")}]`);
  console.log(`  Created: [${baseRun.createdTypes.join(", ")}]\n`);

  let currentBest = baseRound;

  // Genetic hill-climbing loop
  for (let round = 1; round <= ROUNDS; round++) {
    const { child: childGenome, mutationType } = mutate(currentBest.genome);
    const result = await runHaiku(childGenome);

    const improved = result.details.score >= currentBest.details.score;
    if (improved) {
      currentBest = {
        round,
        genome: childGenome,
        details: result.details,
        mutationType,
        toolCallNames: result.toolCallNames,
        createdTypes: result.createdTypes,
      };
    }

    allRounds.push({
      round,
      genome: childGenome,
      details: result.details,
      mutationType,
      toolCallNames: result.toolCallNames,
      createdTypes: result.createdTypes,
    });

    const marker = improved ? "✓" : " ";
    const bestScore = currentBest.details.score;
    console.log(
      `Round ${String(round).padStart(2)}: ${marker} ` +
        `score=${String(result.details.score).padStart(3)}/100 ` +
        `(best=${bestScore}) ` +
        `[${mutationType}] ` +
        `frame=${result.details.frameCreated ? "Y" : "N"} ` +
        `persons=${result.details.personCount} ` +
        `created=[${result.createdTypes.join(",")}]`,
    );
  }

  // Build leaderboard (deduplicate: keep best score per unique genome combo)
  const seen = new Map<string, ScoredRound>();
  for (const r of allRounds) {
    const key = `s${r.genome.sceneSetupIdx}t${r.genome.toolMandateIdx}`;
    const existing = seen.get(key);
    if (!existing || r.details.score > existing.details.score) {
      seen.set(key, r);
    }
  }
  const leaderboard = [...seen.values()].sort((a, b) => b.details.score - a.details.score);

  console.log("\n====== LEADERBOARD (Top 5 unique genomes) ======");
  for (const [i, entry] of leaderboard.slice(0, 5).entries()) {
    console.log(`\n#${i + 1} Score: ${entry.details.score}/100 [Round ${entry.round}]`);
    console.log(`  Mutation type: ${entry.mutationType}`);
    console.log(`  Genome: ${describeGenome(entry.genome)}`);
    console.log(
      `  frame=${entry.details.frameCreated} persons=${entry.details.personCount} objects=${entry.details.objectCount}`,
    );
    console.log(`  Tools called: [${entry.toolCallNames.join(", ")}]`);
    console.log(`  Objects created: [${entry.createdTypes.join(", ")}]`);
  }

  // Best prompt to file
  const best = leaderboard[0];
  const bestSystemPrompt = buildSystemPrompt(best.genome);
  const bestSceneSetup = SCENE_SETUP_GENES[best.genome.sceneSetupIdx];
  const bestToolMandate = TOOL_MANDATE_GENES[best.genome.toolMandateIdx];

  const tmpDir = process.env.TMPDIR ?? "/tmp";
  const outPath = path.join(tmpDir, "best-prompt-v24.txt");
  const fileContent = [
    `# Best Prompt Variant (Score: ${best.details.score}/100)`,
    `# Genome: ${describeGenome(best.genome)}`,
    `# Rounds run: ${ROUNDS} | Unique genomes tested: ${seen.size}`,
    "",
    "## SCENE_SETUP gene:",
    bestSceneSetup,
    "",
    "## TOOL_MANDATE gene (first TOOL RULES bullet):",
    bestToolMandate,
    "",
    "## Full assembled system prompt:",
    bestSystemPrompt,
  ].join("\n");

  writeFileSync(outPath, fileContent);
  console.log(`\nBest prompt written to ${outPath}`);

  // Final summary for team-lead report
  console.log("\n====== SUMMARY ======");
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Rounds: ${ROUNDS} | Unique genomes tested: ${seen.size}/${SCENE_SETUP_GENES.length * TOOL_MANDATE_GENES.length}`);
  console.log(`Base score: ${allRounds[0].details.score}/100`);
  console.log(`Best score: ${best.details.score}/100`);
  console.log(`Best genome: ${describeGenome(best.genome)}`);
  console.log("\nTop 5 by score:");
  for (const [i, entry] of leaderboard.slice(0, 5).entries()) {
    console.log(
      `  ${i + 1}. ${entry.details.score}/100 - ${describeGenome(entry.genome)} [mutation: ${entry.mutationType}]`,
    );
  }

  if (best.details.score > allRounds[0].details.score) {
    console.log("\nBEST SCENE_SETUP:");
    console.log("---");
    console.log(bestSceneSetup);
    console.log("---");
    if (best.genome.toolMandateIdx !== BASE_GENOME.toolMandateIdx) {
      console.log("\nBEST TOOL_MANDATE (first TOOL RULES bullet):");
      console.log("---");
      console.log(bestToolMandate);
      console.log("---");
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
