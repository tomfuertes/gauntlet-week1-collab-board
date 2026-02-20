/**
 * Prompt evaluation harness for CollabBoard AI tools.
 * Run: npx tsx scripts/prompt-eval.ts
 * Requires a running dev server (npm run dev + npm run health).
 *
 * Env vars:
 *   EVAL_USERNAME   login username (default: "eval")
 *   EVAL_PASSWORD   login password (default: "eval1234")
 *   EVAL_MODEL      AI model ID (default: "glm-4.7-flash")
 *   EVAL_PORT       override server port (default: 8787)
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
// ws is a transitive dep (playwright, wrangler) - no new dependency added
import { WebSocket } from "ws";
// langfuse is a direct dependency (already in package.json)
import { Langfuse } from "langfuse";

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
  const { id } = await resp.json() as { id: string };
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

async function runScenario(
  cookie: string,
  boardId: string,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const requestId = nanoid8();
    let settled = false;

    const settle = (result: ScenarioResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result); // resolve before close so a ws.close() throw can't hang the promise
      try { ws.close(); } catch { /* already closed or invalid state */ }
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
      ws.send(JSON.stringify({
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
      }));
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
        const typesMatch = scenario.expectedTypes?.length
          ? checkTypesMatch(objects, scenario.expectedTypes)
          : null;

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
    const src = readFileSync(join(__dirname, "..", "src", "server", "prompts.ts"), "utf8");
    const m = src.match(/PROMPT_VERSION\s*=\s*["']([^"']+)["']/);
    if (!m) {
      console.warn("[eval] WARNING: PROMPT_VERSION not found in prompts.ts - reports will have version=unknown");
      return "unknown";
    }
    return m[1];
  } catch (err) {
    console.warn(`[eval] WARNING: Could not read prompts.ts: ${err}`);
    console.warn("[eval] Run from repo root so src/server/prompts.ts is reachable.");
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const promptVersion = readPromptVersion();

  console.log(`[eval] Prompt eval harness (PROMPT_VERSION=${promptVersion}, model=${MODEL}, port=${PORT})`);

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

  // Load scenarios
  const scenariosPath = join(__dirname, "scenarios.json");
  if (!existsSync(scenariosPath)) {
    console.error(`[eval] scenarios.json not found at: ${scenariosPath}`);
    console.error("[eval] Create scripts/scenarios.json with an array of Scenario objects (see scenarios.json for the format).");
    process.exit(1);
  }
  const scenarios: Scenario[] = JSON.parse(readFileSync(scenariosPath, "utf8"));
  console.log(`[eval] Running ${scenarios.length} scenarios...\n`);

  // Run each scenario sequentially (WS connections, board state checks)
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`  ${scenario.id.padEnd(22)}`);

    try {
      await clearBoard(cookie, boardId);
    } catch (err) {
      console.error(`\n[eval] clearBoard failed for ${scenario.id}: ${err} - skipping`);
      results.push({
        id: scenario.id, description: scenario.description ?? "", pass: false,
        overlapScore: 0, outOfBounds: 0, objectCount: 0,
        expectedMinObjects: scenario.expectedMinObjects ?? 1, typesMatch: null,
        latencyMs: 0, error: `clearBoard failed: ${String(err)}`,
      });
      continue;
    }
    const result = await runScenario(cookie, boardId, scenario);
    results.push(result);

    // Push scores to Langfuse if configured. Each scenario gets its own trace so metrics
    // are queryable per-scenario, per-model, and per-promptVersion in the Langfuse dashboard.
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

  // Summary report
  const passed = results.filter((r) => r.pass).length;
  const avgOverlap = results.reduce((s, r) => s + r.overlapScore, 0) / results.length;
  const avgOob = results.reduce((s, r) => s + r.outOfBounds, 0) / results.length;
  const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;

  console.log(`\nPrompt Eval Report (PROMPT_VERSION=${promptVersion}, model=${MODEL})`);
  console.log("═══════════════════════════════════════════════════════════════");
  for (const r of results) {
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
    `  Aggregate: ${passed}/${results.length} pass | ` +
    `avg overlap: ${avgOverlap.toFixed(1)} | ` +
    `avg oob: ${avgOob.toFixed(1)} | ` +
    `avg latency: ${(avgLatency / 1000).toFixed(1)}s`,
  );

  // Write JSON report
  const resultsDir = join(__dirname, "eval-results");
  mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(resultsDir, `${timestamp}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      { promptVersion, model: MODEL, timestamp: new Date().toISOString(), passed, total: results.length, avgOverlap, avgOob, avgLatencyMs: avgLatency, results },
      null,
      2,
    ),
  );
  console.log(`\n[eval] Full report: ${reportPath}`);

  if (langfuse) {
    await langfuse.flushAsync();
    console.log("[eval] Langfuse scores flushed");
  }
}

main().catch((err) => {
  console.error("[eval] Fatal error:", err);
  process.exit(1);
});
