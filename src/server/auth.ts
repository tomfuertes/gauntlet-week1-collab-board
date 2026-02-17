import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Bindings } from "./env";

// 7-day session expiry
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const auth = new Hono<{ Bindings: Bindings }>();

// --- Password hashing (PBKDF2 via Web Crypto - zero deps, built into Workers runtime) ---

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const hash = await crypto.subtle.exportKey("raw", key);
  const saltHex = bufToHex(salt);
  const hashHex = bufToHex(new Uint8Array(hash));
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBuf(saltHex);
  const key = await deriveKey(password, salt);
  const hash = await crypto.subtle.exportKey("raw", key);
  return bufToHex(new Uint8Array(hash)) === hashHex;
}

async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
}

function bufToHex(buf: Uint8Array): string {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16));
  return new Uint8Array(bytes);
}

// --- Session helpers ---

function createSessionId(): string {
  return crypto.randomUUID();
}

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  sessionId: string
) {
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

// --- Routes ---

auth.post("/auth/signup", async (c) => {
  const body = await c.req.json<{
    username: string;
    password: string;
    displayName?: string;
  }>();

  if (!body.username || !body.password) {
    return c.json({ error: "Username and password required" }, 400);
  }

  if (body.username.length < 2 || body.username.length > 30) {
    return c.json({ error: "Username must be 2-30 characters" }, 400);
  }

  if (body.password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Check if username taken
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ?"
  )
    .bind(body.username.toLowerCase())
    .first();

  if (existing) {
    return c.json({ error: "Username already taken" }, 409);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  const displayName = body.displayName || body.username;

  await c.env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)"
  )
    .bind(userId, body.username.toLowerCase(), passwordHash, displayName)
    .run();

  // Create session
  const sessionId = createSessionId();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  )
    .bind(sessionId, userId, sessionExpiry())
    .run();

  setSessionCookie(c, sessionId);

  return c.json({
    user: { id: userId, username: body.username.toLowerCase(), displayName },
  });
});

auth.post("/auth/login", async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();

  if (!body.username || !body.password) {
    return c.json({ error: "Username and password required" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, username, password_hash, display_name FROM users WHERE username = ?"
  )
    .bind(body.username.toLowerCase())
    .first<{
      id: string;
      username: string;
      password_hash: string;
      display_name: string;
    }>();

  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  // Create session
  const sessionId = createSessionId();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  )
    .bind(sessionId, user.id, sessionExpiry())
    .run();

  setSessionCookie(c, sessionId);

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    },
  });
});

auth.post("/auth/logout", async (c) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
      .bind(sessionId)
      .run();
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

auth.get("/auth/me", async (c) => {
  const sessionId = getCookie(c, "session");
  if (!sessionId) {
    return c.json({ user: null }, 401);
  }

  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  )
    .bind(sessionId)
    .first<{ id: string; username: string; display_name: string }>();

  if (!row) {
    deleteCookie(c, "session", { path: "/" });
    return c.json({ user: null }, 401);
  }

  return c.json({
    user: { id: row.id, username: row.username, displayName: row.display_name },
  });
});

// --- Middleware for protecting routes ---

export async function getSessionUser(
  db: D1Database,
  sessionId: string | undefined
): Promise<{ id: string; username: string; displayName: string } | null> {
  if (!sessionId) return null;

  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .bind(sessionId)
    .first<{ id: string; username: string; display_name: string }>();

  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}
