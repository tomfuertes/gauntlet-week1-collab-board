import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { auth, getSessionUser } from "./auth";
import { aiRoutes } from "./ai";

export { Board } from "./board";

type Bindings = {
  DB: D1Database;
  BOARD: DurableObjectNamespace;
  AI: Ai;
  AUTH_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());
app.use("/auth/*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok", version: "0.0.1" });
});

// Mount auth routes
app.route("/", auth);

// Mount AI routes
app.route("/api/ai", aiRoutes);

// Board CRUD (auth-protected)
app.get("/api/boards", async (c) => {
  const sessionId = getCookie(c, "session");
  const user = await getSessionUser(c.env.DB, sessionId);
  if (!user) return c.text("Unauthorized", 401);

  const { results } = await c.env.DB.prepare(
    "SELECT id, name, created_by, created_at, updated_at FROM boards WHERE created_by = ? OR created_by = 'system' ORDER BY updated_at DESC"
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

  // Clear DO storage
  const doId = c.env.BOARD.idFromName(boardId);
  const stub = c.env.BOARD.get(doId);
  await stub.fetch(new Request("http://do/clear", { method: "POST" }));

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
  const res = await stub.fetch(new Request("http://do/clear", { method: "POST" }));
  return new Response(res.body, { headers: { "Content-Type": "application/json" } });
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

  // Forward with user info as query params (DO reads these)
  const url = new URL(c.req.url);
  url.searchParams.set("userId", user.id);
  url.searchParams.set("username", user.displayName);

  return stub.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
  }));
});

export default app;
