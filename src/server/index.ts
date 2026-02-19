import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { routeAgentRequest } from "agents";
import { auth, getSessionUser } from "./auth";

import type { Bindings } from "./env";
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
  userId: string
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
    `SELECT b.id, b.name, b.created_by, b.created_at, b.updated_at,
       MAX(0, COALESCE(a.activity_count, 0) - COALESCE(s.seen_count, 0)) AS unseen_count
     FROM boards b
     LEFT JOIN board_activity a ON a.board_id = b.id
     LEFT JOIN user_board_seen s ON s.board_id = b.id AND s.user_id = ?1
     WHERE b.created_by = ?1 OR b.created_by = 'system' OR s.user_id IS NOT NULL
     ORDER BY b.updated_at DESC`
  ).bind(user.id).all();
  return c.json(results);
});

app.post("/api/boards", async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.text("Unauthorized", 401);

  const body = await c.req.json<{ name?: string }>();
  const id = crypto.randomUUID();
  const name = body.name || "Untitled Board";

  await c.env.DB.prepare(
    "INSERT INTO boards (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))"
  ).bind(id, name, user.id).run();
  return c.json({ id, name }, 201);
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
  const { results: userBoards } = await c.env.DB.prepare(
    "SELECT id FROM boards WHERE created_by = ?"
  ).bind(user.id).all();
  for (const board of userBoards) {
    await getBoardStub(c.env, board.id as string).deleteBoard();
  }
  await c.env.DB.prepare("DELETE FROM boards WHERE created_by = ?").bind(user.id).run();

  // Delete sessions and user
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

  return c.json({ deleted: true });
});

// Public gallery endpoint - boards with replay events (no auth)
app.get("/api/boards/public", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.name, u.display_name AS creator,
              a.last_activity_at, a.activity_count AS eventCount
       FROM boards b
       JOIN users u ON u.id = b.created_by
       JOIN board_activity a ON a.board_id = b.id
       WHERE a.activity_count > 0
       ORDER BY a.last_activity_at DESC
       LIMIT 50`
    ).all<{ id: string; name: string; creator: string; last_activity_at: string; eventCount: number }>();
    return c.json(results);
  } catch (err) {
    console.error(JSON.stringify({ event: "gallery:public:error", error: String(err) }));
    return c.json([], 500);
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

  return stub.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
  }));
});

export default app;
