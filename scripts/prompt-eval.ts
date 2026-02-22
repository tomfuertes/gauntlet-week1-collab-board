/**
 * Prompt evaluation harness for YesAInd AI tools.
 * Run: npx tsx scripts/prompt-eval.ts
 * Requires a running dev server (npm run dev + npm run health).
 *
 * Env vars:
 *   EVAL_USERNAME      login username (default: "eval")
 *   EVAL_PASSWORD      login password (default: "eval1234")
 *   EVAL_MODEL         AI model ID (default: "glm-4.7-flash")
 *   EVAL_PORT          override server port (default: 8787)
 *   EVAL_JUDGE_MODEL   judge model ID (default: "claude-sonnet-4")
 *   EVAL_SKIP_JUDGE    set to "1" to skip judge scoring (transcript-only mode)
 *   EVAL_SKIP_LAYOUT   set to "1" to skip layout scenarios
 *   EVAL_SKIP_NARRATIVE set to "1" to skip narrative scenarios
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
// ws is a transitive dep (playwright, wrangler) - no new dependency added
import { WebSocket } from "ws";
// langfuse is a direct dependency (already in package.json)
import { Langfuse } from "langfuse";
import { judgeTranscript, type JudgeResult } from "./judge-rubric.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.EVAL_PORT ?? 8787);
const BASE_URL = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;
const USERNAME = process.env.EVAL_USERNAME ?? "eval";
const PASSWORD = process.env.EVAL_PASSWORD ?? "eval1234";
const MODEL = process.env.EVAL_MODEL ?? "glm-4.7-flash";
const SCENARIO_TIMEOUT_MS = 30_000;
const NARRATIVE_TURN_TIMEOUT_MS = 45_000;

// Cloudflare Agents SDK WS message types (from @cloudflare/ai-chat/dist/types.js)
const CF_AGENT_USE_CHAT_REQUEST = "cf_agent_use_chat_request";
const CF_AGENT_USE_CHAT_RESPONSE = "cf_agent_use_chat_response";
const CF_AGENT_CHAT_CLEAR = "cf_agent_chat_clear";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  prompt: string;
  expectedMinObjects?: number;
  expectedTypes?: string[];
  description?: string;
  tags?: string[];
}

interface BoardMetrics {
  total: number;
  overlapScore: number;
  outOfBounds: number;
}

interface ScenarioResult {
  id: string;
  description: string;
  pass: boolean;
  overlapScore: number;
  outOfBounds: number;
  objectCount: number;
  expectedMinObjects: number;
  typesMatch: boolean | null;
  latencyMs: number;
  error?: string;
}

interface NarrativeScenario {
  id: string;
  description: string;
  gameMode: string;
  personaId?: string;
  turns: {
    text: string;
    intent?: string;
    waitForToolCalls: boolean;
  }[];
  primaryDimensions: string[];
  minExpectedObjects: number;
  notes?: string;
  tags?: string[];
}

interface TranscriptEntry {
  role: "player" | "ai";
  text: string;
  toolCalls?: string[];
  turnIndex: number;
  timestampMs: number;
}

interface NarrativeScenarioResult {
  id: string;
  description: string;
  transcript: TranscriptEntry[];
  judgeResult: JudgeResult | null; // null if judge call failed or skipped
  layoutMetrics: {
    objectCount: number;
    overlapScore: number;
    outOfBounds: number;
  };
  latencyMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function login(): Promise<string> {
  const resp = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (resp.ok) {
    const cookie = resp.headers.get("set-cookie") ?? "";
    const m = cookie.match(/session=([^;]+)/);
    if (m) return m[1];
    throw new Error("Login ok but no session cookie in response");
  }
  if (resp.status === 401) {
    // User doesn't exist - try to create it
    const signupResp = await fetch(`${BASE_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: "Eval" }),
    });
    if (!signupResp.ok && signupResp.status !== 409) {
      throw new Error(`Signup failed: ${signupResp.status} ${await signupResp.text()}`);
    }
    // Retry login (signup succeeded, or user already exists with this password)
    const retry = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    if (!retry.ok) throw new Error(`Login failed after signup: ${retry.status}. Set EVAL_USERNAME/EVAL_PASSWORD.`);
    const cookie = retry.headers.get("set-cookie") ?? "";
    const m = cookie.match(/session=([^;]+)/);
    if (m) return m[1];
    throw new Error("Login ok but no session cookie in retry response");
  }
  throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
}

// ---------------------------------------------------------------------------
// Board management
// ---------------------------------------------------------------------------

async function createBoard(cookie: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${cookie}` },
    body: JSON.stringify({ name: "prompt-eval" }),
  });
  if (!resp.ok) throw new Error(`Create board failed: ${resp.status}`);
  const { id } = (await resp.json()) as { id: string };
  return id;
}

async function clearBoard(cookie: string, boardId: string): Promise<void> {
  const resp = await fetch(`${BASE_URL}/api/board/${boardId}/clear`, {
    method: "POST",
    headers: { Cookie: `session=${cookie}` },
  });
  if (!resp.ok) throw new Error(`Clear board failed: ${resp.status}`);
}

async function getBoardObjects(
  cookie: string,
  boardId: string,
): Promise<{ objects: { type: string }[]; metrics: BoardMetrics }> {
  const resp = await fetch(`${BASE_URL}/api/boards/${boardId}/objects`, {
    headers: { Cookie: `session=${cookie}` },
  });
  if (!resp.ok) throw new Error(`Get objects failed: ${resp.status}`);
  return resp.json() as Promise<{ objects: { type: string }[]; metrics: BoardMetrics }>;
}

// ---------------------------------------------------------------------------
// Type match scoring (multiset subset: expected types must be present in actuals)
// ---------------------------------------------------------------------------

function checkTypesMatch(objects: { type: string }[], expectedTypes: string[]): boolean {
  const actual: Record<string, number> = {};
  for (const { type } of objects) actual[type] = (actual[type] ?? 0) + 1;

  const expected: Record<string, number> = {};
  for (const t of expectedTypes) expected[t] = (expected[t] ?? 0) + 1;

  for (const [type, count] of Object.entries(expected)) {
    if ((actual[type] ?? 0) < count) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// ChatAgent WS interaction
// ---------------------------------------------------------------------------

function nanoid8(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function runScenario(cookie: string, boardId: string, scenario: Scenario): Promise<ScenarioResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const requestId = nanoid8();
    let settled = false;

    const settle = (result: ScenarioResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result); // resolve before close so a ws.close() throw can't hang the promise
      try {
        ws.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("already closed") && !msg.includes("WebSocket was closed")) {
          console.warn("[eval] Unexpected ws.close error:", err);
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      settle({
        id: scenario.id,
        description: scenario.description ?? "",
        pass: false,
        overlapScore: 0,
        outOfBounds: 0,
        objectCount: 0,
        expectedMinObjects: scenario.expectedMinObjects ?? 1,
        typesMatch: null,
        latencyMs: Date.now() - start,
        error: "timeout (30s)",
      });
    }, SCENARIO_TIMEOUT_MS);

    // KEY-DECISION 2026-02-20: partyserver maps env bindings via camelCaseToKebabCase()
    // so CHAT_AGENT -> "chat-agent". useAgent() applies the same transform client-side.
    // Using PascalCase "ChatAgent" causes map lookup to miss -> 400 "Invalid request".
    const ws = new WebSocket(`${WS_BASE}/agents/chat-agent/${boardId}`, {
      headers: { Cookie: `session=${cookie}` },
    });

    ws.on("open", () => {
      // Clear chat history so each scenario starts fresh
      ws.send(JSON.stringify({ type: CF_AGENT_CHAT_CLEAR }));

      // Send the scenario prompt as a user message
      const userMessage = {
        id: nanoid8(),
        role: "user",
        parts: [{ type: "text", text: scenario.prompt }],
        createdAt: new Date().toISOString(),
      };
      ws.send(
        JSON.stringify({
          id: requestId,
          init: {
            method: "POST",
            body: JSON.stringify({
              messages: [userMessage],
              gameMode: "freeform",
              model: MODEL,
            }),
          },
          type: CF_AGENT_USE_CHAT_REQUEST,
        }),
      );
    });

    ws.on("message", async (raw: Buffer) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        // Non-JSON frames are normal during CF Agents SDK handshake.
        // Log if the frame looked like JSON to surface real malformed responses.
        const str = raw.toString();
        if (str.startsWith("{") || str.startsWith("[")) {
          console.warn(`[eval] Unparseable JSON frame (${scenario.id}): ${str.slice(0, 200)}`);
        }
        return;
      }

      if (data["type"] !== CF_AGENT_USE_CHAT_RESPONSE) return;
      if (data["id"] !== requestId) return;
      if (!data["done"]) return;

      // Stream complete - fetch board state and score
      try {
        const { metrics, objects } = await getBoardObjects(cookie, boardId);
        const latencyMs = Date.now() - start;

        const expectedMin = scenario.expectedMinObjects ?? 1;
        const typesMatch = scenario.expectedTypes?.length ? checkTypesMatch(objects, scenario.expectedTypes) : null;

        const pass =
          metrics.overlapScore === 0 &&
          metrics.outOfBounds === 0 &&
          metrics.total >= expectedMin &&
          (typesMatch === null || typesMatch);

        settle({
          id: scenario.id,
          description: scenario.description ?? "",
          pass,
          overlapScore: metrics.overlapScore,
          outOfBounds: metrics.outOfBounds,
          objectCount: metrics.total,
          expectedMinObjects: expectedMin,
          typesMatch,
          latencyMs,
        });
      } catch (err) {
        settle({
          id: scenario.id,
          description: scenario.description ?? "",
          pass: false,
          overlapScore: 0,
          outOfBounds: 0,
          objectCount: 0,
          expectedMinObjects: scenario.expectedMinObjects ?? 1,
          typesMatch: null,
          latencyMs: Date.now() - start,
          error: String(err),
        });
      }
    });

    ws.on("error", (err: Error) => {
      settle({
        id: scenario.id,
        description: scenario.description ?? "",
        pass: false,
        overlapScore: 0,
        outOfBounds: 0,
        objectCount: 0,
        expectedMinObjects: scenario.expectedMinObjects ?? 1,
        typesMatch: null,
        latencyMs: Date.now() - start,
        error: `WS error: ${err.message}`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Read PROMPT_VERSION from source (dev tool - reading source is acceptable)
// ---------------------------------------------------------------------------

function readPromptVersion(): string {
  try {
    const src = readFileSync(join(__dirname, "..", "src", "server", "prompts", "index.ts"), "utf8");
    const m = src.match(/PROMPT_VERSION\s*=\s*["']([^"']+)["']/);
    if (!m) {
      console.warn("[eval] WARNING: PROMPT_VERSION not found in prompts/index.ts - reports will have version=unknown");
      return "unknown";
    }
    return m[1];
  } catch (err) {
    const isNotFound = err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
    if (isNotFound) {
      console.warn(
        "[eval] WARNING: prompts/index.ts not found - run from repo root so src/server/prompts/index.ts is reachable.",
      );
    } else {
      console.warn(`[eval] WARNING: Could not parse PROMPT_VERSION from prompts.ts: ${err}`);
    }
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Narrative scenario runner (multi-turn)
// ---------------------------------------------------------------------------

/**
 * Run a multi-turn narrative scenario. Sends messages sequentially,
 * collecting the full AI response text + tool calls for each turn.
 *
 * Key differences from single-turn runScenario():
 * - Does NOT clear chat between turns (multi-turn conversation)
 * - Captures AI response text from CF_AGENT_USE_CHAT_RESPONSE frames
 * - Waits for done:true between turns when waitForToolCalls is true
 * - Accumulates transcript for judge submission
 * - Clears chat only at scenario START (fresh conversation)
 */
async function runNarrativeScenario(
  cookie: string,
  boardId: string,
  scenario: NarrativeScenario,
): Promise<NarrativeScenarioResult> {
  const scenarioStart = Date.now();
  const transcript: TranscriptEntry[] = [];

  // Build up the messages array across turns (mirrors how ChatPanel.tsx accumulates history)
  const accumulatedMessages: {
    id: string;
    role: string;
    parts: { type: string; text: string }[];
    createdAt: string;
  }[] = [];

  let scenarioError: string | undefined;

  // Process each turn sequentially via a single persistent WS connection
  const ws = new WebSocket(`${WS_BASE}/agents/chat-agent/${boardId}`, {
    headers: { Cookie: `session=${cookie}` },
  });

  try {
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const openTimeout = setTimeout(() => rejectOpen(new Error("WS open timeout (10s)")), 10_000);
      ws.on("open", () => {
        clearTimeout(openTimeout);
        // Clear chat history at scenario start for fresh conversation
        ws.send(JSON.stringify({ type: CF_AGENT_CHAT_CLEAR }));
        resolveOpen();
      });
      ws.on("error", (err: Error) => {
        clearTimeout(openTimeout);
        rejectOpen(err);
      });
    });

    for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex++) {
      const turn = scenario.turns[turnIndex];
      const turnStart = Date.now();
      const requestId = nanoid8();

      // Build the user message for this turn
      const userMessage = {
        id: nanoid8(),
        role: "user",
        parts: [{ type: "text", text: turn.text }],
        createdAt: new Date().toISOString(),
      };
      accumulatedMessages.push(userMessage);

      // Record player transcript entry
      transcript.push({
        role: "player",
        text: turn.text,
        turnIndex,
        timestampMs: turnStart - scenarioStart,
      });

      // Send the turn
      const requestBody: Record<string, unknown> = {
        messages: accumulatedMessages,
        gameMode: scenario.gameMode,
        model: MODEL,
      };
      if (scenario.personaId) requestBody["personaId"] = scenario.personaId;
      if (turn.intent) requestBody["intent"] = turn.intent;

      ws.send(
        JSON.stringify({
          id: requestId,
          init: {
            method: "POST",
            body: JSON.stringify(requestBody),
          },
          type: CF_AGENT_USE_CHAT_REQUEST,
        }),
      );

      // For turns that don't wait for tool calls, skip listening for response
      if (!turn.waitForToolCalls) {
        continue;
      }

      // Wait for the done frame, collecting text deltas and tool calls
      const { aiText, toolCallNames } = await new Promise<{
        aiText: string;
        toolCallNames: string[];
      }>((resolveTurn, rejectTurn) => {
        let textBuffer = "";
        const toolNames: string[] = [];
        let turnSettled = false;

        const turnTimeout = setTimeout(() => {
          if (!turnSettled) {
            turnSettled = true;
            rejectTurn(new Error(`Turn ${turnIndex} timeout (45s)`));
          }
        }, NARRATIVE_TURN_TIMEOUT_MS);

        const onMessage = (raw: Buffer) => {
          if (turnSettled) return;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(raw.toString());
          } catch {
            const str = raw.toString();
            if (str.startsWith("{") || str.startsWith("[")) {
              console.warn(`[eval] Unparseable JSON frame (turn ${turnIndex}): ${str.slice(0, 200)}`);
            }
            return;
          }

          if (data["type"] !== CF_AGENT_USE_CHAT_RESPONSE) return;
          if (data["id"] !== requestId) return;

          // Collect text deltas from streaming response
          const body = data["body"];
          if (typeof body === "string") {
            try {
              const bodyParsed = JSON.parse(body) as Record<string, unknown>;
              // Text delta - CF Agents SDK uses AI SDK Data Stream Protocol: { type: "text-delta", delta: "..." }
              if (bodyParsed["type"] === "text-delta" && typeof bodyParsed["delta"] === "string") {
                textBuffer += bodyParsed["delta"];
              }
              // Tool call name - expand batchExecute inner ops so judge sees real tools
              if (typeof bodyParsed["toolName"] === "string") {
                const toolName = bodyParsed["toolName"] as string;
                if (toolName === "batchExecute") {
                  // Extract inner operation names from args.operations[].tool
                  const rawArgs = bodyParsed["args"] ?? bodyParsed["input"];
                  const argsObj =
                    typeof rawArgs === "string"
                      ? (() => {
                          try {
                            return JSON.parse(rawArgs) as Record<string, unknown>;
                          } catch {
                            return null;
                          }
                        })()
                      : (rawArgs as Record<string, unknown> | null);
                  const ops = Array.isArray(argsObj?.["operations"]) ? argsObj["operations"] : null;
                  if (ops && ops.length > 0) {
                    // Remove any fallback "batchExecute" entry recorded before args arrived
                    const fallbackIdx = toolNames.indexOf("batchExecute");
                    if (fallbackIdx !== -1) toolNames.splice(fallbackIdx, 1);
                    // List inner tools with "(via batchExecute)" suffix instead of the wrapper name
                    for (const op of ops as { tool?: string }[]) {
                      if (typeof op.tool === "string" && !toolNames.includes(`${op.tool} (via batchExecute)`)) {
                        toolNames.push(`${op.tool} (via batchExecute)`);
                      }
                    }
                  } else {
                    // Args not yet available in this frame - fall back to recording batchExecute
                    if (!toolNames.includes(toolName)) toolNames.push(toolName);
                  }
                } else {
                  if (!toolNames.includes(toolName)) toolNames.push(toolName);
                }
              }
            } catch {
              if (body.startsWith("{") || body.startsWith("[")) {
                console.warn(`[eval] Unparseable JSON body (turn ${turnIndex}): ${body.slice(0, 200)}`);
              }
            }
          }

          if (!data["done"]) return;

          // Turn complete
          clearTimeout(turnTimeout);
          turnSettled = true;
          ws.off("message", onMessage);
          resolveTurn({ aiText: textBuffer, toolCallNames: toolNames });
        };

        ws.on("message", onMessage);
      });

      // Record AI transcript entry
      transcript.push({
        role: "ai",
        text: aiText,
        toolCalls: toolCallNames.length > 0 ? toolCallNames : undefined,
        turnIndex,
        timestampMs: Date.now() - scenarioStart,
      });

      // Add AI response to accumulated messages for next turn context
      accumulatedMessages.push({
        id: nanoid8(),
        role: "assistant",
        parts: [{ type: "text", text: aiText }],
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    scenarioError = String(err);
  } finally {
    try {
      ws.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already closed") && !msg.includes("WebSocket was closed")) {
        throw err;
      }
    }
  }

  // Fetch board state for layout metrics
  let layoutMetrics = { objectCount: 0, overlapScore: 0, outOfBounds: 0 };
  try {
    const { metrics } = await getBoardObjects(cookie, boardId);
    layoutMetrics = {
      objectCount: metrics.total,
      overlapScore: metrics.overlapScore,
      outOfBounds: metrics.outOfBounds,
    };
  } catch (error) {
    console.warn("[eval] Failed to fetch board objects:", error);
  }

  // Judge the transcript (unless skipped)
  let judgeResult: JudgeResult | null = null;
  if (!scenarioError && process.env.EVAL_SKIP_JUDGE !== "1" && transcript.length > 0) {
    try {
      judgeResult = await judgeTranscript(
        transcript.map((t) => ({ role: t.role, text: t.text })),
        scenario.id,
      );
    } catch (err) {
      console.warn(`\n[eval] Judge failed for ${scenario.id}: ${err}`);
    }
  }

  return {
    id: scenario.id,
    description: scenario.description,
    transcript,
    judgeResult,
    layoutMetrics,
    latencyMs: Date.now() - scenarioStart,
    error: scenarioError,
  };
}

// ---------------------------------------------------------------------------
// Narrative result console output
// ---------------------------------------------------------------------------

function printNarrativeResult(result: NarrativeScenarioResult): void {
  const status = result.error ? "ERROR" : result.judgeResult ? "JUDGED" : "TRANSCRIPT";
  const overall = result.judgeResult ? `overall=${result.judgeResult.overallScore.toFixed(1)}` : "no-judge";
  const errStr = result.error ? ` (${result.error})` : "";

  console.log(`\n  ${result.id}`);
  console.log(
    `    ${status}  ${overall}  objects=${result.layoutMetrics.objectCount}` +
      `  ${(result.latencyMs / 1000).toFixed(1)}s${errStr}`,
  );

  if (result.judgeResult) {
    for (const dim of result.judgeResult.dimensions) {
      console.log(`    ${dim.dimension.padEnd(22)} ${dim.score}/5  ${dim.reasoning}`);
    }
    console.log(`    summary: ${result.judgeResult.summary}`);
  }

  console.log(`    turns: ${result.transcript.filter((t) => t.role === "player").length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenario filtering
// ---------------------------------------------------------------------------

function matchesFilter(
  id: string,
  tags: string[] | undefined,
  filterIds: Set<string>,
  filterTags: Set<string>,
): boolean {
  if (filterIds.size === 0 && filterTags.size === 0) return true;
  if (filterIds.size > 0 && filterIds.has(id)) return true;
  if (filterTags.size > 0 && tags?.some((t) => filterTags.has(t))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const promptVersion = readPromptVersion();

  // Parse scenario/tag filters from env
  const filterIds = new Set(
    (process.env.EVAL_SCENARIO ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const filterTags = new Set(
    (process.env.EVAL_TAG ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  console.log(`[eval] Prompt eval harness (PROMPT_VERSION=${promptVersion}, model=${MODEL}, port=${PORT})`);
  if (filterIds.size > 0) console.log(`[eval] Filtering by scenario IDs: ${[...filterIds].join(", ")}`);
  if (filterTags.size > 0) console.log(`[eval] Filtering by tags: ${[...filterTags].join(", ")}`);

  // Initialize Langfuse for pushing eval scores to traces (optional - skipped if env vars absent)
  const langfuse =
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
      ? new Langfuse({
          publicKey: process.env.LANGFUSE_PUBLIC_KEY,
          secretKey: process.env.LANGFUSE_SECRET_KEY,
          baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
        })
      : null;
  if (langfuse) {
    console.log("[eval] Langfuse enabled - scores will be pushed to traces");
  }

  // Auth
  let cookie: string;
  try {
    cookie = await login();
    console.log(`[eval] Authenticated as "${USERNAME}"`);
  } catch (err) {
    console.error(`[eval] Auth failed: ${err}`);
    process.exit(1);
  }

  // Create a dedicated eval board
  let boardId: string;
  try {
    boardId = await createBoard(cookie);
    console.log(`[eval] Created eval board: ${boardId}`);
  } catch (err) {
    console.error(`[eval] Failed to create board: ${err}`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Layout scenarios
  // ---------------------------------------------------------------------------

  const layoutResults: ScenarioResult[] = [];

  if (process.env.EVAL_SKIP_LAYOUT !== "1") {
    const scenariosPath = join(__dirname, "scenarios.json");
    if (!existsSync(scenariosPath)) {
      console.error(`[eval] scenarios.json not found at: ${scenariosPath}`);
      console.error("[eval] Create scripts/scenarios.json with an array of Scenario objects.");
      process.exit(1);
    }
    let scenarios: Scenario[];
    try {
      scenarios = JSON.parse(readFileSync(scenariosPath, "utf8")) as Scenario[];
    } catch (err) {
      console.error(`[eval] Failed to parse ${scenariosPath}: ${err}`);
      process.exit(1);
    }
    scenarios = scenarios.filter((s) => matchesFilter(s.id, s.tags, filterIds, filterTags));
    console.log(`[eval] Running ${scenarios.length} layout scenarios...\n`);

    for (const scenario of scenarios) {
      process.stdout.write(`  ${scenario.id.padEnd(22)}`);

      try {
        await clearBoard(cookie, boardId);
      } catch (err) {
        console.error(`\n[eval] clearBoard failed for ${scenario.id}: ${err} - skipping`);
        layoutResults.push({
          id: scenario.id,
          description: scenario.description ?? "",
          pass: false,
          overlapScore: 0,
          outOfBounds: 0,
          objectCount: 0,
          expectedMinObjects: scenario.expectedMinObjects ?? 1,
          typesMatch: null,
          latencyMs: 0,
          error: `clearBoard failed: ${String(err)}`,
        });
        continue;
      }
      const result = await runScenario(cookie, boardId, scenario);
      layoutResults.push(result);

      // Push scores to Langfuse if configured
      if (langfuse) {
        const trace = langfuse.trace({
          name: "eval:scenario",
          metadata: { scenarioId: result.id, description: result.description, promptVersion, model: MODEL },
          tags: ["eval", `scenario:${result.id}`, `model:${MODEL}`, `promptVersion:${promptVersion}`],
        });
        const scoreEntries: { name: string; value: number }[] = [
          { name: "pass", value: result.pass ? 1 : 0 },
          { name: "overlapScore", value: result.overlapScore },
          { name: "outOfBounds", value: result.outOfBounds },
          { name: "objectCount", value: result.objectCount },
          { name: "latencyMs", value: result.latencyMs },
        ];
        if (result.typesMatch !== null) {
          scoreEntries.push({ name: "typesMatch", value: result.typesMatch ? 1 : 0 });
        }
        for (const { name, value } of scoreEntries) {
          langfuse.score({ traceId: trace.id, name, value });
        }
      }

      const status = result.pass ? "PASS" : "FAIL";
      const typeStr = result.typesMatch === null ? "" : ` types=${result.typesMatch ? "ok" : "mismatch"}`;
      const errStr = result.error ? ` (${result.error})` : "";
      console.log(
        `${status}  overlap=${result.overlapScore}  oob=${result.outOfBounds}` +
          `  objects=${result.objectCount}/${result.expectedMinObjects}${typeStr}` +
          `  ${(result.latencyMs / 1000).toFixed(1)}s${errStr}`,
      );
    }

    // Layout summary
    const passed = layoutResults.filter((r) => r.pass).length;
    const avgOverlap = layoutResults.reduce((s, r) => s + r.overlapScore, 0) / (layoutResults.length || 1);
    const avgOob = layoutResults.reduce((s, r) => s + r.outOfBounds, 0) / (layoutResults.length || 1);
    const avgLatency = layoutResults.reduce((s, r) => s + r.latencyMs, 0) / (layoutResults.length || 1);

    console.log(`\n=== Layout Scenarios (PROMPT_VERSION=${promptVersion}, model=${MODEL}) ===`);
    console.log("═══════════════════════════════════════════════════════════════");
    for (const r of layoutResults) {
      const status = r.pass ? "PASS" : "FAIL";
      const typeStr = r.typesMatch === null ? "" : ` types=${r.typesMatch ? "ok" : "mismatch"}`;
      const errStr = r.error ? ` (${r.error})` : "";
      console.log(
        `  ${r.id.padEnd(22)} ${status}  overlap=${r.overlapScore}  oob=${r.outOfBounds}` +
          `  objects=${r.objectCount}/${r.expectedMinObjects}${typeStr}` +
          `  ${(r.latencyMs / 1000).toFixed(1)}s${errStr}`,
      );
    }
    console.log("───────────────────────────────────────────────────────────────");
    console.log(
      `  Aggregate: ${passed}/${layoutResults.length} pass | ` +
        `avg overlap: ${avgOverlap.toFixed(1)} | ` +
        `avg oob: ${avgOob.toFixed(1)} | ` +
        `avg latency: ${(avgLatency / 1000).toFixed(1)}s`,
    );
  } else {
    console.log("[eval] Skipping layout scenarios (EVAL_SKIP_LAYOUT=1)");
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Narrative scenarios
  // ---------------------------------------------------------------------------

  const narrativeResults: NarrativeScenarioResult[] = [];
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-4";

  if (process.env.EVAL_SKIP_NARRATIVE !== "1") {
    const narrativePath = join(__dirname, "narrative-scenarios.json");
    if (!existsSync(narrativePath)) {
      console.warn("[eval] narrative-scenarios.json not found - skipping narrative phase");
    } else {
      let narrativeScenarios: NarrativeScenario[];
      try {
        narrativeScenarios = JSON.parse(readFileSync(narrativePath, "utf8")) as NarrativeScenario[];
      } catch (err) {
        console.error(`[eval] Failed to parse ${narrativePath}: ${err}`);
        process.exit(1);
      }
      narrativeScenarios = narrativeScenarios.filter((s) => matchesFilter(s.id, s.tags, filterIds, filterTags));
      const skipJudge = process.env.EVAL_SKIP_JUDGE === "1";
      console.log(
        `\n[eval] Running ${narrativeScenarios.length} narrative scenarios` +
          (skipJudge ? " (judge disabled)" : ` with judge model=${judgeModel}`) +
          "...",
      );

      for (const scenario of narrativeScenarios) {
        if (!Array.isArray(scenario.turns) || scenario.turns.length === 0) {
          console.warn(`[eval] Skipping narrative scenario "${scenario.id}": no turns defined`);
          continue;
        }

        try {
          await clearBoard(cookie, boardId);
        } catch (err) {
          console.error(`[eval] clearBoard failed for narrative ${scenario.id}: ${err} - skipping`);
          narrativeResults.push({
            id: scenario.id,
            description: scenario.description,
            transcript: [],
            judgeResult: null,
            layoutMetrics: { objectCount: 0, overlapScore: 0, outOfBounds: 0 },
            latencyMs: 0,
            error: `clearBoard failed: ${String(err)}`,
          });
          continue;
        }

        const result = await runNarrativeScenario(cookie, boardId, scenario);
        narrativeResults.push(result);
        printNarrativeResult(result);

        // Push narrative judge scores to Langfuse
        if (langfuse && result.judgeResult) {
          const trace = langfuse.trace({
            name: "eval:narrative",
            metadata: {
              scenarioId: result.id,
              description: result.description,
              promptVersion,
              model: MODEL,
              judgeModel,
            },
            tags: ["eval", "narrative", `scenario:${result.id}`, `model:${MODEL}`, `judgeModel:${judgeModel}`],
          });
          langfuse.score({ traceId: trace.id, name: "overallScore", value: result.judgeResult.overallScore });
          for (const dim of result.judgeResult.dimensions) {
            langfuse.score({ traceId: trace.id, name: dim.dimension, value: dim.score });
          }
        }
      }

      // Narrative summary
      const judged = narrativeResults.filter((r) => r.judgeResult !== null);
      if (judged.length > 0) {
        const avgOverall = judged.reduce((s, r) => s + (r.judgeResult?.overallScore ?? 0), 0) / judged.length;
        console.log(`\n=== Narrative Summary: avg overall score ${avgOverall.toFixed(1)}/5 ===`);
      }
    }
  } else {
    console.log("[eval] Skipping narrative scenarios (EVAL_SKIP_NARRATIVE=1)");
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Write combined v2 report
  // ---------------------------------------------------------------------------

  const resultsDir = join(__dirname, "eval-results");
  mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(resultsDir, `${timestamp}.json`);

  // Build layout section (compatible with v1 schema)
  const layoutPassed = layoutResults.filter((r) => r.pass).length;
  const layoutAvgOverlap = layoutResults.length
    ? layoutResults.reduce((s, r) => s + r.overlapScore, 0) / layoutResults.length
    : 0;
  const layoutAvgOob = layoutResults.length
    ? layoutResults.reduce((s, r) => s + r.outOfBounds, 0) / layoutResults.length
    : 0;
  const layoutAvgLatency = layoutResults.length
    ? layoutResults.reduce((s, r) => s + r.latencyMs, 0) / layoutResults.length
    : 0;

  // Build narrative section
  const judgedNarrative = narrativeResults.filter((r) => r.judgeResult !== null);
  const narrativeAvgOverall = judgedNarrative.length
    ? judgedNarrative.reduce((s, r) => s + (r.judgeResult?.overallScore ?? 0), 0) / judgedNarrative.length
    : 0;

  const dimensionNames = ["yes_and_quality", "character_voice", "dramatic_arc", "tool_usage", "audience_engagement"];
  const avgDimensions: Record<string, number> = {};
  for (const dim of dimensionNames) {
    const scores = judgedNarrative
      .map((r) => r.judgeResult?.dimensions.find((d) => d.dimension === dim)?.score ?? null)
      .filter((s): s is number => s !== null);
    avgDimensions[dim] = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  }

  const report = {
    $schema: "eval-report-v2",
    promptVersion,
    model: MODEL,
    judgeModel,
    timestamp: new Date().toISOString(),
    layout: {
      passed: layoutPassed,
      total: layoutResults.length,
      avgOverlap: layoutAvgOverlap,
      avgOob: layoutAvgOob,
      avgLatencyMs: layoutAvgLatency,
      results: layoutResults,
    },
    narrative: {
      avgOverallScore: Math.round(narrativeAvgOverall * 10) / 10,
      avgDimensions,
      results: narrativeResults,
    },
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[eval] Full report: ${reportPath}`);

  if (langfuse) {
    await langfuse.flushAsync();
    console.log("[eval] Langfuse scores flushed");
  }

  // Compact one-liner summary for easy copy-paste into commits/PRs
  const layoutSummary =
    layoutResults.length > 0
      ? `layout: ${layoutPassed}/${layoutResults.length} | overlap: ${layoutAvgOverlap.toFixed(1)}`
      : "layout: n/a";
  const narrativeSummary =
    judgedNarrative.length > 0 ? `narrative: ${narrativeAvgOverall.toFixed(1)}/5` : "narrative: n/a";
  console.log(`\n${promptVersion} | ${MODEL} | ${layoutSummary} | ${narrativeSummary}`);
}

main().catch((err) => {
  console.error("[eval] Fatal error:", err);
  process.exit(1);
});
