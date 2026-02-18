import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { routeAgentRequest } from "agents";
import { auth, getSessionUser } from "./auth";

import type { Bindings } from "./env";
export { Board } from "./board";
export { ChatAgent } from "./chat-agent";

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());
app.use("/auth/*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok", version: "0.0.1" });
});

// Mount auth routes
app.route("/", auth);

// Board CRUD (auth-protected)
app.get("/api/boards", async (c) => {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.text("Unauthorized", 401);

  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.created_by, b.created_at, b.updated_at,
       MAX(0, COALESCE(a.activity_count, 0) - COALESCE(s.seen_count, 0)) AS unseen_count
     FROM boards b
     LEFT JOIN board_activity a ON a.board_id = b.id
     LEFT JOIN user_board_seen s ON s.board_id = b.id AND s.user_id = ?1
     WHERE b.created_by = ?1 OR b.created_by = 'system'
     ORDER BY b.updated_at DESC`
  ).bind(user.id).all();
  return c.json(results);
});

app.post("/api/boards", async (c) => {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
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
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.text("Unauthorized", 401);

  const boardId = c.req.param("boardId");

  // Ownership check - don't allow deleting system boards or others' boards
  const board = await c.env.DB.prepare("SELECT created_by FROM boards WHERE id = ?").bind(boardId).first();
  if (!board) return c.text("Not found", 404);
  if (board.created_by !== user.id) return c.text("Forbidden", 403);

  // Delete DO: broadcast board:deleted, close WS connections, clear storage
  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);
  await stub.deleteBoard();

  // Delete D1 row
  await c.env.DB.prepare("DELETE FROM boards WHERE id = ?").bind(boardId).run();
  return c.json({ deleted: true });
});

// Clear board (auth-protected, ownership check)
app.post("/api/board/:boardId/clear", async (c) => {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.text("Unauthorized", 401);

  const boardId = c.req.param("boardId");

  // Ownership check - match DELETE route pattern
  const board = await c.env.DB.prepare("SELECT created_by FROM boards WHERE id = ?").bind(boardId).first();
  if (!board) return c.text("Not found", 404);
  if (board.created_by !== user.id) return c.text("Forbidden", 403);

  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);
  const deleted = await stub.clearBoard();
  return c.json({ deleted });
});

// Delete user account and all their data
app.delete("/api/user", async (c) => {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.text("Unauthorized", 401);

  // Delete user's boards (and their DO storage)
  const { results: userBoards } = await c.env.DB.prepare(
    "SELECT id FROM boards WHERE created_by = ?"
  ).bind(user.id).all();
  for (const board of userBoards) {
    const doId = c.env.BOARD.idFromName(board.id as string);
    const stub = c.env.BOARD.get(doId);
    await stub.deleteBoard();
  }
  await c.env.DB.prepare("DELETE FROM boards WHERE created_by = ?").bind(user.id).run();

  // Delete sessions and user
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

  return c.json({ deleted: true });
});

// Agent SDK route (auth-protected)
app.all("/agents/*", async (c) => {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.text("Unauthorized", 401);
  return (await routeAgentRequest(c.req.raw, c.env)) || c.text("Not found", 404);
});

// WebSocket upgrade - authenticate then forward to Board DO
app.get("/ws/board/:boardId", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  // Authenticate via session cookie
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) {
    return c.text("Unauthorized", 401);
  }

  // Route to Board Durable Object
  const boardId = c.req.param("boardId");
  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);

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
