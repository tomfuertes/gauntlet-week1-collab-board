import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { routeAgentRequest } from "agents";
import { auth, getSessionUser } from "./auth";
import { getRandomHatPrompt } from "./hat-prompts";
import { computeOverlapScore } from "./ai-tools-sdk";

import type { Bindings } from "./env";
import { recordBoardActivity, markBoardSeen } from "./env";
export { Board } from "./board";
export { ChatAgent } from "./chat-agent";

const app = new Hono<{ Bindings: Bindings }>();

// --- Route helpers (DRY auth + DO stub patterns) ---

async function requireAuth(c: Context<{ Bindings: Bindings }>) {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return null;
  return user;
}

function getBoardStub(env: Bindings, boardId: string) {
  return env.BOARD.get(env.BOARD.idFromName(boardId));
}

// Returns null if not found/forbidden (caller checks), or the board row
async function checkBoardOwnership(
  db: D1Database,
  boardId: string,
  userId: string,
): Promise<"not_found" | "forbidden" | "ok"> {
  const board = await db.prepare("SELECT created_by FROM boards WHERE id = ?").bind(boardId).first();
  if (!board) return "not_found";
  if (board.created_by !== userId) return "forbidden";
  return "ok";
}

app.use("/api/*", cors());
app.use("/auth/*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok", version: "0.0.1" });
});

// Mount auth routes
app.route("/", auth);

// Board CRUD (auth-protected)
app.get("/api/boards", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.created_by, b.created_at, b.updated_at, b.game_mode,
       MAX(0, COALESCE(a.activity_count, 0) - COALESCE(s.seen_count, 0)) AS unseen_count
     FROM boards b
     LEFT JOIN board_activity a ON a.board_id = b.id
     LEFT JOIN user_board_seen s ON s.board_id = b.id AND s.user_id = ?1
     WHERE b.created_by = ?1 OR b.created_by = 'system' OR s.user_id IS NOT NULL
     ORDER BY b.updated_at DESC`,
  )
    .bind(user.id)
    .all();
  return c.json(results);
});

app.post("/api/boards", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const body = await c.req.json<{ name?: string }>();
  const id = crypto.randomUUID();
  const name = body.name || "Untitled Board";

  await c.env.DB.prepare(
    "INSERT INTO boards (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
  )
    .bind(id, name, user.id)
    .run();
  // Seed activity + seen so the board appears immediately in GET /api/boards
  // (avoids D1 read replication lag - board is visible before any WS activity)
  await recordBoardActivity(c.env.DB, id);
  await markBoardSeen(c.env.DB, user.id, id);
  return c.json({ id, name }, 201);
});

// Public gallery endpoint - no auth, must be above :boardId routes (Hono matches in order)
app.get("/api/boards/public", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.name, b.game_mode, u.display_name AS creator,
              a.last_activity_at, COALESCE(a.activity_count, 0) AS eventCount
       FROM boards b
       JOIN users u ON u.id = b.created_by
       LEFT JOIN board_activity a ON a.board_id = b.id
       ORDER BY a.last_activity_at DESC
       LIMIT 50`,
    ).all<{
      id: string;
      name: string;
      game_mode?: string;
      creator: string;
      last_activity_at: string;
      eventCount: number;
    }>();
    return c.json(results);
  } catch (err) {
    console.error(JSON.stringify({ event: "gallery:public:error", error: String(err) }));
    return c.json([], 500);
  }
});

app.delete("/api/boards/:boardId", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const boardId = c.req.param("boardId");
  const ownership = await checkBoardOwnership(c.env.DB, boardId, user.id);
  if (ownership === "not_found") return c.text("Not found", 404);
  if (ownership === "forbidden") return c.text("Forbidden", 403);

  // Delete DO: broadcast board:deleted, close WS connections, clear storage
  await getBoardStub(c.env, boardId).deleteBoard();

  // Delete D1 row
  await c.env.DB.prepare("DELETE FROM boards WHERE id = ?").bind(boardId).run();
  return c.json({ deleted: true });
});

// Get single board metadata (auth-protected)
app.get("/api/boards/:boardId", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);
  const boardId = c.req.param("boardId");
  const row = await c.env.DB.prepare("SELECT id, name, game_mode, created_by FROM boards WHERE id = ?")
    .bind(boardId)
    .first();
  if (!row) return c.text("Not found", 404);
  return c.json(row);
});

// Board objects endpoint for eval harness (auth-protected)
// Canvas usable area bounds from LAYOUT RULES in prompts.ts
const CANVAS_MIN_X = 50,
  CANVAS_MIN_Y = 60,
  CANVAS_MAX_X = 1150,
  CANVAS_MAX_Y = 780;

app.get("/api/boards/:boardId/objects", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const boardId = c.req.param("boardId");
  const objects = await getBoardStub(c.env, boardId).readObjects();

  const overlapScore = computeOverlapScore(objects);
  const outOfBounds = objects.filter(
    (o) => o.x < CANVAS_MIN_X || o.y < CANVAS_MIN_Y || o.x + o.width > CANVAS_MAX_X || o.y + o.height > CANVAS_MAX_Y,
  ).length;

  return c.json({
    objects,
    metrics: { total: objects.length, overlapScore, outOfBounds },
  });
});

// Update board game mode (auth-protected, ownership check)
app.patch("/api/boards/:boardId", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);
  const boardId = c.req.param("boardId");
  const ownership = await checkBoardOwnership(c.env.DB, boardId, user.id);
  if (ownership === "not_found") return c.text("Not found", 404);
  if (ownership === "forbidden") return c.text("Forbidden", 403);
  const body = await c.req.json<{ game_mode?: string }>();
  const gameMode = ["hat", "yesand", "freeform"].includes(body.game_mode ?? "") ? body.game_mode : "freeform";
  await c.env.DB.prepare("UPDATE boards SET game_mode = ? WHERE id = ?").bind(gameMode, boardId).run();
  return c.json({ ok: true });
});

// Clear board (auth-protected, ownership check)
app.post("/api/board/:boardId/clear", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const boardId = c.req.param("boardId");
  const ownership = await checkBoardOwnership(c.env.DB, boardId, user.id);
  if (ownership === "not_found") return c.text("Not found", 404);
  if (ownership === "forbidden") return c.text("Forbidden", 403);

  const deleted = await getBoardStub(c.env, boardId).clearBoard();
  return c.json({ deleted });
});

// Delete user account and all their data
app.delete("/api/user", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  // Delete user's boards (and their DO storage)
  const { results: userBoards } = await c.env.DB.prepare("SELECT id FROM boards WHERE created_by = ?")
    .bind(user.id)
    .all();
  for (const board of userBoards) {
    await getBoardStub(c.env, board.id as string).deleteBoard();
  }
  await c.env.DB.prepare("DELETE FROM boards WHERE created_by = ?").bind(user.id).run();

  // Delete sessions and user
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

  return c.json({ deleted: true });
});

// --- Daily Challenge API ---

// Validate a route param is a positive integer (rejects floats like "1.5")
function parsePositiveInt(raw: string): number {
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
}

// GET /api/challenges/today - get or create today's challenge; includes userBoardId if authenticated
app.get("/api/challenges/today", async (c) => {
  try {
    const sessionId = getCookie(c, "session");
    const user = sessionId ? await getSessionUser(c.env.DB, sessionId) : null;

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC

    let challenge = await c.env.DB.prepare("SELECT id, date, prompt FROM daily_challenges WHERE date = ?")
      .bind(today)
      .first<{ id: number; date: string; prompt: string }>();

    if (!challenge) {
      // INSERT ... RETURNING is not reliably supported in D1 - use INSERT then SELECT
      const { prompt, index } = getRandomHatPrompt();
      await c.env.DB.prepare("INSERT OR IGNORE INTO daily_challenges (date, prompt, hat_prompt_index) VALUES (?, ?, ?)")
        .bind(today, prompt, index)
        .run();
      challenge = await c.env.DB.prepare("SELECT id, date, prompt FROM daily_challenges WHERE date = ?")
        .bind(today)
        .first<{ id: number; date: string; prompt: string }>();
    }

    if (!challenge) {
      console.error(JSON.stringify({ event: "challenge:today:not_found", date: today }));
      return c.json({ error: "Failed to get challenge" }, 500);
    }

    const userBoardId: string | null = user
      ? ((
          await c.env.DB.prepare("SELECT board_id FROM challenge_entries WHERE challenge_id = ? AND user_id = ?")
            .bind(challenge.id, user.id)
            .first<{ board_id: string }>()
        )?.board_id ?? null)
      : null;

    return c.json({ ...challenge, userBoardId });
  } catch (err) {
    console.error(JSON.stringify({ event: "challenge:today:error", error: String(err) }));
    return c.json({ error: "Failed to load challenge" }, 500);
  }
});

// POST /api/challenges/:id/enter - create board + entry (idempotent - returns existing if already entered)
app.post("/api/challenges/:id/enter", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const challengeId = parsePositiveInt(c.req.param("id"));
  if (isNaN(challengeId)) return c.text("Invalid challenge id", 400);

  // Check for existing entry (idempotent)
  const existing = await c.env.DB.prepare(
    "SELECT board_id FROM challenge_entries WHERE challenge_id = ? AND user_id = ?",
  )
    .bind(challengeId, user.id)
    .first<{ board_id: string }>();
  if (existing) return c.json({ boardId: existing.board_id });

  const challenge = await c.env.DB.prepare("SELECT id, prompt FROM daily_challenges WHERE id = ?")
    .bind(challengeId)
    .first<{ id: number; prompt: string }>();
  if (!challenge) return c.text("Challenge not found", 404);

  const boardId = crypto.randomUUID();
  const boardName = `Daily: ${challenge.prompt.length > 40 ? challenge.prompt.slice(0, 40) + "..." : challenge.prompt}`;

  try {
    await c.env.DB.prepare(
      "INSERT INTO boards (id, name, created_by, created_at, updated_at, game_mode) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'hat')",
    )
      .bind(boardId, boardName, user.id)
      .run();
    await recordBoardActivity(c.env.DB, boardId);
    await markBoardSeen(c.env.DB, user.id, boardId);
    await c.env.DB.prepare(
      "INSERT INTO challenge_entries (challenge_id, board_id, user_id, created_at) VALUES (?, ?, ?, datetime('now'))",
    )
      .bind(challengeId, boardId, user.id)
      .run();
  } catch (err) {
    // UNIQUE constraint fired from concurrent request - re-fetch the winner's entry
    const raceWinner = await c.env.DB.prepare(
      "SELECT board_id FROM challenge_entries WHERE challenge_id = ? AND user_id = ?",
    )
      .bind(challengeId, user.id)
      .first<{ board_id: string }>();
    if (raceWinner) return c.json({ boardId: raceWinner.board_id });
    console.error(JSON.stringify({ event: "challenge:enter:error", error: String(err) }));
    return c.text("Failed to create challenge entry", 500);
  }

  return c.json({ boardId }, 201);
});

// GET /api/challenges/:id/leaderboard - top 20 entries by reaction count (public)
app.get("/api/challenges/:id/leaderboard", async (c) => {
  const challengeId = parsePositiveInt(c.req.param("id"));
  if (isNaN(challengeId)) return c.text("Invalid challenge id", 400);

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT ce.board_id AS boardId, ce.user_id AS userId,
              u.display_name AS username, ce.reaction_count AS reactionCount
       FROM challenge_entries ce
       JOIN users u ON u.id = ce.user_id
       WHERE ce.challenge_id = ?
       ORDER BY ce.reaction_count DESC
       LIMIT 20`,
    )
      .bind(challengeId)
      .all<{ boardId: string; userId: string; username: string; reactionCount: number }>();

    return c.json(results);
  } catch (err) {
    console.error(JSON.stringify({ event: "challenge:leaderboard:error", challengeId, error: String(err) }));
    return c.json([], 500);
  }
});

// Custom persona CRUD (auth-protected)

app.get("/api/boards/:boardId/personas", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);
  // Any authenticated user can read personas - consistent with board content access model
  const boardId = c.req.param("boardId");
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name, trait, color FROM board_personas WHERE board_id = ? ORDER BY created_at",
    )
      .bind(boardId)
      .all();
    return c.json(results.length > 0 ? results : null); // null = use defaults
  } catch (err) {
    console.error(JSON.stringify({ event: "personas:get-error", boardId, error: String(err) }));
    return c.json({ error: "Failed to load personas" }, 500);
  }
});

app.post("/api/boards/:boardId/personas", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);
  const boardId = c.req.param("boardId");
  const ownership = await checkBoardOwnership(c.env.DB, boardId, user.id);
  if (ownership === "not_found") return c.text("Not found", 404);
  if (ownership === "forbidden") return c.text("Forbidden", 403);

  const body = await c.req.json<{ name?: string; trait?: string; color?: string }>();
  // Strip non-alphanumeric chars from name (name used as [NAME] prefix in LLM protocol)
  const name = (body.name ?? "")
    .trim()
    .replace(/[^A-Z0-9 _-]/gi, "")
    .toUpperCase()
    .slice(0, 30);
  const trait = (body.trait ?? "").trim().slice(0, 500);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color ?? "") ? body.color! : "#fb923c";
  if (!name || !trait) return c.text("name and trait are required", 400);

  try {
    // Limit to 10 personas per board to prevent unbounded growth
    const existing = await c.env.DB.prepare("SELECT COUNT(*) as count FROM board_personas WHERE board_id = ?")
      .bind(boardId)
      .first<{ count: number }>();
    if ((existing?.count ?? 0) >= 10) return c.text("Maximum 10 characters per board", 400);

    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO board_personas (id, board_id, name, trait, color) VALUES (?, ?, ?, ?, ?)")
      .bind(id, boardId, name, trait, color)
      .run();
    return c.json({ id, name, trait, color }, 201);
  } catch (err) {
    console.error(JSON.stringify({ event: "personas:post-error", boardId, error: String(err) }));
    return c.json({ error: "Failed to create persona" }, 500);
  }
});

app.delete("/api/boards/:boardId/personas/:personaId", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);
  const boardId = c.req.param("boardId");
  const ownership = await checkBoardOwnership(c.env.DB, boardId, user.id);
  if (ownership === "not_found") return c.text("Not found", 404);
  if (ownership === "forbidden") return c.text("Forbidden", 403);

  const personaId = c.req.param("personaId");
  try {
    await c.env.DB.prepare("DELETE FROM board_personas WHERE id = ? AND board_id = ?").bind(personaId, boardId).run();
    return c.json({ deleted: true });
  } catch (err) {
    console.error(JSON.stringify({ event: "personas:delete-error", boardId, personaId, error: String(err) }));
    return c.json({ error: "Failed to delete persona" }, 500);
  }
});

// Public replay endpoint - no auth (shareable replay URLs)
app.get("/api/boards/:boardId/replay", async (c) => {
  const boardId = c.req.param("boardId");
  const events = await getBoardStub(c.env, boardId).readEvents();
  return c.json(events);
});

// Agent SDK route (auth-protected)
app.all("/agents/*", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);
  return (await routeAgentRequest(c.req.raw, c.env)) || c.text("Not found", 404);
});

// WebSocket upgrade for spectators - no auth required (public, like replay)
app.get("/ws/watch/:boardId", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  const boardId = c.req.param("boardId");
  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);

  // Generate a unique spectator identity (no auth - anonymous viewer)
  const spectatorId = `spectator-${crypto.randomUUID()}`;

  const url = new URL(c.req.url);
  url.searchParams.set("userId", spectatorId);
  url.searchParams.set("username", "Spectator");
  url.searchParams.set("boardId", boardId);
  url.searchParams.set("role", "spectator");

  return stub.fetch(
    new Request(url.toString(), {
      headers: c.req.raw.headers,
    }),
  );
});

// WebSocket upgrade - authenticate then forward to Board DO
app.get("/ws/board/:boardId", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const boardId = c.req.param("boardId");
  const stub = getBoardStub(c.env, boardId);

  // Forward with user info + boardId as query params (DO reads these)
  const url = new URL(c.req.url);
  url.searchParams.set("userId", user.id);
  url.searchParams.set("username", user.displayName);
  url.searchParams.set("boardId", boardId);

  return stub.fetch(
    new Request(url.toString(), {
      headers: c.req.raw.headers,
    }),
  );
});

export default app;
