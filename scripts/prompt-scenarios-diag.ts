/**
 * Scenario diagnostic: tests Haiku on non-scene-setup scenarios.
 *
 * Runs ITERATIONS_PER_SCENARIO iterations per scenario with the base production
 * prompt (no mutation) to identify failure modes. No hill-climbing - pure diagnosis.
 *
 * Scenarios tested (from team-lead mandate):
 *   complication      - "A giant spider crashes through the ceiling" (turn 3, pre-populated board)
 *   character-intro   - "Introduce a new character: Dr. Fang the vampire dentist" (turn 3)
 *   grid-2x2          - "Create a 2x2 grid of rooms: Kitchen, Bedroom, Bathroom, Living Room"
 *   color-variety     - "Create 4 stickies showing different emotions..."
 *   stakes-escalation - "The building is on fire! Everyone needs to evacuate!" (turn 3, expects mods)
 *   frame-budget-cap  - "Set up a courtroom: frame + 3 characters" (regression: phantom frame bug #277)
 *
 * Usage:
 *   set -a && source .dev.vars && set +a
 *   npx tsx scripts/prompt-scenarios-diag.ts
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

const MODEL_ID = "claude-haiku-4-5-20251001";
const ITERATIONS_PER_SCENARIO = 7;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Run: set -a && source .dev.vars && set +a");
  process.exit(1);
}

const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Pre-existing board objects for scenarios that need an established scene
// ---------------------------------------------------------------------------

const EXISTING_SCENE: BoardObject[] = [
  {
    id: "scene-frame",
    type: "frame",
    x: 100,
    y: 100,
    width: 500,
    height: 350,
    rotation: 0,
    props: { text: "Dentist Office" },
    createdBy: "player-1",
    updatedAt: Date.now() - 120000,
  } as BoardObject,
  {
    id: "person-1",
    type: "person",
    x: 160,
    y: 200,
    width: 80,
    height: 120,
    rotation: 0,
    props: { name: "Dr. Smith", color: "#f87171" },
    createdBy: "ai",
    updatedAt: Date.now() - 110000,
  } as BoardObject,
  {
    id: "person-2",
    type: "person",
    x: 300,
    y: 200,
    width: 80,
    height: 120,
    rotation: 0,
    props: { name: "Patient Bob", color: "#60a5fa" },
    createdBy: "player-1",
    updatedAt: Date.now() - 100000,
  } as BoardObject,
];

// ---------------------------------------------------------------------------
// Extended mock stub - tracks creates, reads, and updates separately
// ---------------------------------------------------------------------------

interface StubTracker {
  stub: BoardStub;
  getCreatedTypes: () => string[];
  getReadCalls: () => number;
  getUpdateCalls: () => string[];
}

function createMockStub(preObjects: BoardObject[]): StubTracker {
  const createdTypes: string[] = [];
  let readCalls = 0;
  const updateCalls: string[] = [];

  const stub: BoardStub = {
    readObjects: async () => {
      readCalls++;
      return preObjects;
    },
    readObject: async (id: string) => preObjects.find((o) => o.id === id) ?? null,
    mutate: async (msg: BoardMutation) => {
      if (msg.type === "obj:create") {
        createdTypes.push((msg as { type: "obj:create"; obj: BoardObject }).obj.type);
      } else if (msg.type === "obj:update") {
        updateCalls.push("obj:update");
      }
      return { ok: true };
    },
    injectCursor: async () => {},
    saveCriticReview: async () => {},
    createPoll: async () => ({ ok: true }),
  };

  return {
    stub,
    getCreatedTypes: () => [...createdTypes],
    getReadCalls: () => readCalls,
    getUpdateCalls: () => [...updateCalls],
  };
}

// ---------------------------------------------------------------------------
// System prompt builder - mirrors chat-agent.ts onChatMessage injection logic
// ---------------------------------------------------------------------------

function buildDiagSystemPrompt(humanTurns: number, injectSceneSetup: boolean): string {
  const [spark, sage] = DEFAULT_PERSONAS;
  const lifecyclePhase = computeLifecyclePhase(humanTurns);
  let systemPrompt = buildPersonaSystemPrompt(spark, sage, SYSTEM_PROMPT);
  systemPrompt += `\n\n${buildLifecycleBlock(lifecyclePhase)}`;
  if (injectSceneSetup) {
    systemPrompt += `\n\n${SCENE_SETUP_PROMPT}`;
  }
  return systemPrompt;
}

// ---------------------------------------------------------------------------
// Run result types
// ---------------------------------------------------------------------------

interface RunResult {
  toolCallNames: string[]; // All tools the LLM tried to call
  createdTypes: string[]; // Object types successfully created (from stub.mutate)
  updateCalls: string[]; // Object updates (from stub.mutate)
  readCalls: number; // getBoardState invocations (from stub.readObjects)
  totalToolCalls: number;
  score: number;
  pass: boolean;
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  prompt: string;
  humanTurns: number; // Determines lifecycle phase (turn 1 = establish, 3 = build)
  injectSceneSetup: boolean; // Only true for turn-1 fresh scenes
  prePopulate: boolean; // True = board has EXISTING_SCENE objects
  expectedBehavior: string;
  passThreshold: number; // Score >= this = pass
  scoreRun: (r: Omit<RunResult, "score" | "pass">) => number;
}

/** Tool names that are "creative effects" (not canvas object creation) */
const EFFECT_TOOLS = new Set(["highlightObject", "choreograph", "spotlight", "blackout", "setMood", "play_sfx"]);

const SCENARIOS: Scenario[] = [
  {
    id: "complication",
    prompt: "A giant spider crashes through the ceiling",
    humanTurns: 3,
    injectSceneSetup: false,
    prePopulate: true,
    expectedBehavior: "1+ dramatic object (drawScene/createPerson for spider/destruction effect)",
    passThreshold: 100,
    scoreRun: (r) => {
      if (r.createdTypes.length >= 1) return 100;
      // Called effect tools but no creates - partial credit
      const effectCalls = r.toolCallNames.filter((n) => EFFECT_TOOLS.has(n));
      if (effectCalls.length >= 1) return 60;
      // Read board but did nothing with it
      if (r.readCalls >= 1) return 20;
      // Pure text response
      if (r.totalToolCalls === 0) return 0;
      return 10;
    },
  },
  {
    id: "character-intro",
    prompt: "Introduce a new character: Dr. Fang the vampire dentist",
    humanTurns: 3,
    injectSceneSetup: false,
    prePopulate: true,
    expectedBehavior: "createPerson called with Dr. Fang character",
    passThreshold: 100,
    scoreRun: (r) => {
      const personCount = r.createdTypes.filter((t) => t === "person").length;
      if (personCount >= 1) return 100;
      // Created something but not a person
      if (r.createdTypes.length >= 1) return 40;
      // Tried to do something
      if (r.totalToolCalls >= 1) return 20;
      return 0;
    },
  },
  {
    id: "grid-2x2",
    prompt: "Create a 2x2 grid of rooms: Kitchen, Bedroom, Bathroom, Living Room",
    humanTurns: 2,
    injectSceneSetup: false,
    prePopulate: false,
    expectedBehavior: "4 createFrame calls for room containers",
    passThreshold: 100,
    scoreRun: (r) => {
      const frameCount = r.createdTypes.filter((t) => t === "frame").length;
      if (frameCount >= 4) return 100;
      if (frameCount === 3) return 75;
      if (frameCount === 2) return 50;
      if (frameCount === 1) return 25;
      // Created non-frames (persons, stickies, etc.)
      if (r.createdTypes.length >= 4) return 20; // right count, wrong type
      if (r.createdTypes.length >= 1) return 10;
      return 0;
    },
  },
  {
    id: "color-variety",
    prompt:
      "Create 4 stickies showing different emotions: joy (yellow), danger (red), hope (green), and mystery (purple)",
    humanTurns: 2,
    injectSceneSetup: false,
    prePopulate: false,
    expectedBehavior: "4 createStickyNote calls (type=sticky)",
    passThreshold: 100,
    scoreRun: (r) => {
      const stickyCount = r.createdTypes.filter((t) => t === "sticky").length;
      if (stickyCount >= 4) return 100;
      if (stickyCount === 3) return 75;
      if (stickyCount === 2) return 50;
      if (stickyCount === 1) return 25;
      // Maybe created rects or text instead of stickies?
      if (r.createdTypes.length >= 4) return 15; // wrong type, right count
      if (r.createdTypes.length >= 1) return 10;
      return 0;
    },
  },
  {
    id: "stakes-escalation",
    prompt: "The building is on fire! Everyone needs to evacuate!",
    humanTurns: 3,
    injectSceneSetup: false,
    prePopulate: true,
    expectedBehavior: "Effect tools (highlightObject/play_sfx/setMood) and/or 0-2 creates - NOT mass creation",
    passThreshold: 80,
    scoreRun: (r) => {
      const createCount = r.createdTypes.length;
      const effectCalls = r.toolCallNames.filter((n) => EFFECT_TOOLS.has(n));
      const readBoard = r.readCalls >= 1;

      // Ideal: some effects + 0-2 creates
      if (effectCalls.length >= 1 && createCount <= 2) return 100;
      // Good: effects only, no creates
      if (effectCalls.length >= 1 && createCount === 0) return 100;
      // Acceptable: 1-2 creates (fire/smoke effects) + effects
      if (createCount <= 2 && effectCalls.length >= 1) return 90;
      // OK: few creates + checked board state
      if (createCount <= 2 && readBoard) return 60;
      // Mediocre: few creates, no effects
      if (createCount <= 2) return 40;
      // Failure: spamming new objects
      if (createCount >= 5) return 0;
      // Degraded: 3-4 creates (over-creating)
      return Math.max(0, 30 - (createCount - 3) * 10);
    },
  },
  {
    id: "frame-budget-cap",
    // Regression scenario for the phantom frame bug (commit 85c47b9):
    // createFrame near the budget cap (maxCreates=4) would silently set currentFrame
    // even when the frame was capped, causing subsequent objects to land at phantom
    // frame coordinates and overlap each other. This scenario pushes toward the cap
    // by requesting 3 characters + a frame container, total 4 objects.
    prompt:
      "Set up a busy courtroom scene: create a frame called 'Courtroom' and put a judge, a defendant, and a lawyer inside it",
    humanTurns: 2,
    injectSceneSetup: true,
    prePopulate: false,
    expectedBehavior:
      "createFrame + 3 createPerson calls (4 total = at budget cap). " +
      "If frame is capped, persons should still be created without error (not at phantom coords). " +
      "Regression: pre-fix, capped frame set currentFrame -> persons overlapped at phantom position.",
    passThreshold: 75,
    scoreRun: (r) => {
      const frameCount = r.createdTypes.filter((t) => t === "frame").length;
      const personCount = r.createdTypes.filter((t) => t === "person").length;
      const totalCreates = r.createdTypes.length;

      // Ideal: frame + 3 persons (4 total, all within cap)
      if (frameCount >= 1 && personCount >= 3) return 100;
      // Good: frame + 2 persons (1 person capped at 4-object budget boundary)
      if (frameCount >= 1 && personCount >= 2) return 90;
      // Good: frame + 1 person (budget partially exhausted by frame)
      if (frameCount >= 1 && personCount >= 1) return 75;
      // Acceptable: frame only (3 persons capped - regression guard: no phantom frame)
      if (frameCount >= 1 && totalCreates === 1) return 60;
      // Acceptable: 3 persons, no frame (frame capped but persons placed correctly)
      // Pre-fix regression: this would have produced 0 visible persons (placed at phantom coords = origin overlap)
      if (personCount >= 3 && frameCount === 0) return 70;
      // Partial: 1-2 persons, no frame (budget issues but not a phantom-frame crash)
      if (personCount >= 2) return 50;
      if (personCount >= 1) return 30;
      // Only non-person creates (wrong type)
      if (totalCreates >= 2) return 20;
      if (totalCreates >= 1) return 10;
      return 0;
    },
  },
];

// ---------------------------------------------------------------------------
// Single run executor
// ---------------------------------------------------------------------------

async function runScenario(scenario: Scenario): Promise<Omit<RunResult, "score" | "pass">> {
  const preObjects = scenario.prePopulate ? EXISTING_SCENE : [];
  const { stub, getCreatedTypes, getReadCalls, getUpdateCalls } = createMockStub(preObjects);
  const tools = createSDKTools(stub);
  const systemPrompt = buildDiagSystemPrompt(scenario.humanTurns, scenario.injectSceneSetup);

  const { toolCalls = [] } = await generateText({
    model: anthropic(MODEL_ID),
    system: systemPrompt,
    messages: [{ role: "user", content: `Tom: ${scenario.prompt}` }],
    tools,
    stopWhen: stepCountIs(2),
  });

  return {
    toolCallNames: toolCalls.map((tc) => tc.toolName),
    createdTypes: getCreatedTypes(),
    updateCalls: getUpdateCalls(),
    readCalls: getReadCalls(),
    totalToolCalls: toolCalls.length,
  };
}

// ---------------------------------------------------------------------------
// Failure mode analysis
// ---------------------------------------------------------------------------

function analyzeFailures(scenario: Scenario, results: RunResult[]): string[] {
  const failures = results.filter((r) => !r.pass);
  if (failures.length === 0) return ["All runs passed"];

  const modes: string[] = [];

  const textOnlyCount = failures.filter((r) => r.totalToolCalls === 0).length;
  if (textOnlyCount > 0) {
    modes.push(`TEXT-ONLY in ${textOnlyCount}/${failures.length} failures (no tools called)`);
  }

  const wrongTypeCount = failures.filter((r) => r.totalToolCalls > 0 && r.createdTypes.length > 0).length;
  if (wrongTypeCount > 0) {
    const typesUsed = new Set(failures.flatMap((r) => r.createdTypes));
    modes.push(`WRONG TYPE in ${wrongTypeCount} failures - used: [${[...typesUsed].join(", ")}]`);
  }

  const noCreatesCount = failures.filter((r) => r.totalToolCalls > 0 && r.createdTypes.length === 0).length;
  if (noCreatesCount > 0) {
    const effectsUsed = new Set(
      failures.filter((r) => r.totalToolCalls > 0 && r.createdTypes.length === 0).flatMap((r) => r.toolCallNames),
    );
    modes.push(`EFFECTS-ONLY in ${noCreatesCount} failures - called: [${[...effectsUsed].join(", ")}]`);
  }

  if (scenario.id === "stakes-escalation") {
    const overCreateCount = failures.filter((r) => r.createdTypes.length >= 5).length;
    if (overCreateCount > 0) {
      modes.push(`OVER-CREATION in ${overCreateCount} failures (5+ new objects, expected modifications)`);
    }
  }

  if (scenario.id === "grid-2x2") {
    const underCreateCount = failures.filter((r) => r.createdTypes.filter((t) => t === "frame").length < 4).length;
    const frameTotal = failures.reduce((sum, r) => sum + r.createdTypes.filter((t) => t === "frame").length, 0);
    if (underCreateCount > 0) {
      modes.push(
        `UNDER-CREATION in ${underCreateCount} failures (avg ${(frameTotal / underCreateCount).toFixed(1)} frames, need 4)`,
      );
    }
  }

  if (scenario.id === "frame-budget-cap") {
    // Regression detection: persons without any frame likely means frame was capped.
    // Pre-fix: capped frame still set currentFrame -> persons overlapped at phantom coords.
    // Post-fix: persons are still created, laid out independently from frame.
    const noFramePersons = failures.filter(
      (r) => r.createdTypes.filter((t) => t === "frame").length === 0 && r.createdTypes.filter((t) => t === "person").length >= 1,
    ).length;
    if (noFramePersons > 0) {
      modes.push(`FRAME-CAPPED in ${noFramePersons} failures (frame at cap boundary, persons still created - check for overlap regression)`);
    }
    const noPersons = failures.filter((r) => r.createdTypes.filter((t) => t === "person").length === 0).length;
    if (noPersons > 0) {
      modes.push(`NO-PERSONS in ${noPersons} failures (expected 1+ createPerson for characters)`);
    }
  }

  return modes.length > 0 ? modes : ["Unknown failure mode"];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ScenarioReport {
  scenarioId: string;
  prompt: string;
  expectedBehavior: string;
  passRate: number;
  avgScore: number;
  toolFrequency: Record<string, number>;
  failureModes: string[];
  iterations: RunResult[];
}

async function main() {
  console.log(`\nScenario diagnostic - ${ITERATIONS_PER_SCENARIO} iterations per scenario on ${MODEL_ID}`);
  console.log(`Scenarios: ${SCENARIOS.map((s) => s.id).join(", ")}\n`);

  const reports: ScenarioReport[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`SCENARIO: ${scenario.id}`);
    console.log(`Prompt: "${scenario.prompt}"`);
    console.log(`Expected: ${scenario.expectedBehavior}`);
    console.log(`Board: ${scenario.prePopulate ? `${EXISTING_SCENE.length} pre-existing objects` : "empty"}`);
    console.log(`Turn: ${scenario.humanTurns} (lifecycle: ${computeLifecyclePhase(scenario.humanTurns)})`);
    console.log("");

    const results: RunResult[] = [];
    const toolFrequency: Record<string, number> = {};

    for (let i = 1; i <= ITERATIONS_PER_SCENARIO; i++) {
      const rawResult = await runScenario(scenario);
      const score = scenario.scoreRun(rawResult);
      const pass = score >= scenario.passThreshold;
      const result: RunResult = { ...rawResult, score, pass };
      results.push(result);

      // Track tool frequency
      for (const tool of rawResult.toolCallNames) {
        toolFrequency[tool] = (toolFrequency[tool] ?? 0) + 1;
      }

      const marker = pass ? "✓" : "✗";
      console.log(
        `  Run ${String(i).padStart(2)}: ${marker} score=${String(score).padStart(3)} ` +
          `creates=[${rawResult.createdTypes.join(",")}] ` +
          `reads=${rawResult.readCalls} ` +
          `updates=${rawResult.updateCalls.length} ` +
          `tools=[${rawResult.toolCallNames.join(",")}]`,
      );
    }

    const passCount = results.filter((r) => r.pass).length;
    const passRate = passCount / ITERATIONS_PER_SCENARIO;
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / ITERATIONS_PER_SCENARIO;
    const failureModes = analyzeFailures(scenario, results);

    console.log(`\n  Pass rate: ${passCount}/${ITERATIONS_PER_SCENARIO} (${(passRate * 100).toFixed(0)}%)`);
    console.log(`  Avg score: ${avgScore.toFixed(1)}/100`);
    console.log(`  Tool frequency: ${JSON.stringify(toolFrequency)}`);
    console.log(`  Failure modes: ${failureModes.join(" | ")}`);

    reports.push({
      scenarioId: scenario.id,
      prompt: scenario.prompt,
      expectedBehavior: scenario.expectedBehavior,
      passRate,
      avgScore,
      toolFrequency,
      failureModes,
      iterations: results,
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Iterations per scenario: ${ITERATIONS_PER_SCENARIO}\n`);

  const sorted = [...reports].sort((a, b) => a.passRate - b.passRate);
  for (const r of sorted) {
    const bar = passRateBar(r.passRate);
    const status = r.passRate >= 0.8 ? "SOLVED" : r.passRate >= 0.4 ? "PARTIAL" : "BROKEN";
    console.log(
      `  ${status.padEnd(8)} ${r.scenarioId.padEnd(20)} ${bar} ${(r.passRate * 100).toFixed(0)}% (avg ${r.avgScore.toFixed(0)}/100)`,
    );
  }

  console.log("\nTop failure modes:");
  for (const r of sorted.filter((r) => r.passRate < 1.0)) {
    console.log(`  ${r.scenarioId}: ${r.failureModes.join(" | ")}`);
  }

  // ---------------------------------------------------------------------------
  // Write JSON report
  // ---------------------------------------------------------------------------

  const tmpDir = process.env.TMPDIR ?? "/private/tmp/claude-501";
  const outPath = path.join(tmpDir, `scenario-diag-${Date.now()}.json`);
  const report = {
    model: MODEL_ID,
    iterationsPerScenario: ITERATIONS_PER_SCENARIO,
    timestamp: new Date().toISOString(),
    scenarios: reports.map(({ iterations, ...rest }) => ({
      ...rest,
      iterationScores: iterations.map((i) => ({
        score: i.score,
        pass: i.pass,
        createdTypes: i.createdTypes,
        toolCallNames: i.toolCallNames,
        readCalls: i.readCalls,
        updateCalls: i.updateCalls.length,
      })),
    })),
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${outPath}`);
}

function passRateBar(rate: number): string {
  const filled = Math.round(rate * 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + "]";
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
