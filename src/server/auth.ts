import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Bindings } from "./env";
// KEY-DECISION 2026-02-20: @simplewebauthn/server v10+ chosen - dropped Node.js crypto
// dependency in v10, uses Web Crypto API (CF Workers compatible). TypeScript-first.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

// 7-day session expiry
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// --- Auth rate limiting (in-memory per isolate, resets on Worker restarts - OK for first pass) ---

const _rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;

function getClientIp(req: Request): string {
  // CF-Connecting-IP is set by Cloudflare's edge (cannot be spoofed through CF proxy).
  // X-Forwarded-For fallback is only reached in local dev / non-CF environments.
  // "unknown" is a shared bucket - multiple users without IP headers share one limit
  // (acceptable: only happens in misconfigured/local deployments, not production).
  return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

function checkRateLimit(key: string, limit: number): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  // Lazy sweep: prevent unbounded growth in long-lived isolates.
  // ES2015 Map spec: deleting the current key inside for...of is safe - already-visited
  // entries are not revisited and not-yet-visited deleted entries are skipped.
  if (_rateLimitMap.size > 1000) {
    for (const [k, v] of _rateLimitMap) {
      if (now - v.windowStart >= RATE_WINDOW_MS) _rateLimitMap.delete(k);
    }
  }
  const entry = _rateLimitMap.get(key);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    _rateLimitMap.set(key, { count: 1, windowStart: now });
    return { limited: false, retryAfter: 0 };
  }
  if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000);
    return { limited: true, retryAfter };
  }
  entry.count++;
  return { limited: false, retryAfter: 0 };
}

export const auth = new Hono<{ Bindings: Bindings }>();

// --- Passkey challenge storage (module-level, per Worker isolate) ---
// KEY-DECISION 2026-02-20: In-memory Map for passkey challenges (no KV/D1).
// CF Workers route same RP domain to the same isolate within a PoP, so challenge
// loss on isolate restart = rare graceful retry. 5-min TTL is more than enough.
interface ChallengeEntry {
  challenge: string;
  userId?: string; // resolved during options; needed for user creation on register/verify
  displayName?: string; // registration only
  expiresAt: number;
}
const _passkeyChallenge = new Map<string, ChallengeEntry>();
const PASSKEY_TTL_MS = 5 * 60 * 1000;
const PASSKEY_RP_NAME = "YesAInd";

function sweepPasskeyChallenges() {
  const now = Date.now();
  for (const [k, v] of _passkeyChallenge) {
    if (now > v.expiresAt) _passkeyChallenge.delete(k);
  }
}

// KEY-DECISION 2026-02-20: Use Origin header (not request URL hostname) so local dev with
// Vite on :5173 and wrangler on :8787 gets the correct browser origin for WebAuthn validation.
function getRpIdAndOrigin(c: Context<{ Bindings: Bindings }>): { rpID: string; origin: string } {
  const originHeader = c.req.header("Origin");
  const origin = originHeader ?? new URL(c.req.url).origin;
  const rpID = new URL(origin).hostname;
  return { rpID, origin };
}

// base64url <-> Uint8Array helpers using atob/btoa (available in CF Workers and browsers)
function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlToUint8Array(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const str = atob(b64);
  // Use explicit ArrayBuffer (not ArrayBufferLike) so the return type satisfies WebAuthnCredential.publicKey
  const bytes = new Uint8Array(new ArrayBuffer(str.length));
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

// --- Password hashing (PBKDF2 via Web Crypto - zero deps, built into Workers runtime) ---

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const hash = await crypto.subtle.exportKey("raw", key);
  const saltHex = bufToHex(salt);
  const hashHex = bufToHex(new Uint8Array(hash));
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBuf(saltHex);
  const key = await deriveKey(password, salt);
  const hash = await crypto.subtle.exportKey("raw", key);
  const hashBuf = new Uint8Array(hash);
  const expectedBuf = hexToBuf(hashHex);
  // Timing-safe comparison: check all bytes without early exit to prevent timing attacks
  if (hashBuf.length !== expectedBuf.length) return false;
  let result = 0;
  for (let i = 0; i < hashBuf.length; i++) {
    result |= hashBuf[i]! ^ expectedBuf[i]!;
  }
  return result === 0;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
}

function bufToHex(buf: Uint8Array): string {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex: string): Uint8Array {
  const matched = hex.match(/.{2}/g);
  if (!matched) return new Uint8Array();
  const bytes = matched.map((h) => parseInt(h, 16));
  return new Uint8Array(bytes);
}

// --- Session helpers ---

function createSessionId(): string {
  return crypto.randomUUID();
}

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], sessionId: string) {
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

async function createAndSetSession(c: Context<{ Bindings: Bindings }>, userId: string): Promise<void> {
  const sessionId = createSessionId();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, sessionExpiry())
    .run();
  setSessionCookie(c, sessionId);
}

// --- Routes ---

auth.post("/auth/signup", async (c) => {
  const ip = getClientIp(c.req.raw);
  // 30/min: high enough for E2E suites (all tests share one IP), low enough to block abuse
  const rl = checkRateLimit(`signup:${ip}`, 30);
  if (rl.limited) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "Too many signup attempts. Try again later." }, 429);
  }

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
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(body.username.toLowerCase())
    .first();

  if (existing) {
    return c.json({ error: "Username already taken" }, 409);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  const displayName = body.displayName || body.username;

  await c.env.DB.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)")
    .bind(userId, body.username.toLowerCase(), passwordHash, displayName)
    .run();

  await createAndSetSession(c, userId);

  return c.json({
    user: { id: userId, username: body.username.toLowerCase(), displayName },
  });
});

auth.post("/auth/login", async (c) => {
  const ip = getClientIp(c.req.raw);
  const rl = checkRateLimit(`login:${ip}`, 10);
  if (rl.limited) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "Too many login attempts. Try again later." }, 429);
  }

  const body = await c.req.json<{ username: string; password: string }>();

  if (!body.username || !body.password) {
    return c.json({ error: "Username and password required" }, 400);
  }

  const user = await c.env.DB.prepare("SELECT id, username, password_hash, display_name FROM users WHERE username = ?")
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

  await createAndSetSession(c, user.id);

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
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
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
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
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

// --- Passkey / WebAuthn routes ---

// Generate registration options for a new passkey credential
auth.post("/auth/passkey/register/options", async (c) => {
  const ip = getClientIp(c.req.raw);
  const rl = checkRateLimit(`passkey-reg:${ip}`, 30);
  if (rl.limited) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await c.req.json<{ username: string; displayName?: string }>();
  if (!body.username || body.username.length < 2 || body.username.length > 30) {
    return c.json({ error: "Username must be 2-30 characters" }, 400);
  }

  const username = body.username.toLowerCase();
  const displayName = body.displayName || body.username;

  // Look up existing user to exclude their current credentials (prevent duplicate registration)
  const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: string }>();

  const excludeCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];
  const userId = existingUser?.id ?? crypto.randomUUID();

  if (existingUser) {
    const creds = await c.env.DB.prepare("SELECT id, transports FROM webauthn_credentials WHERE user_id = ?")
      .bind(existingUser.id)
      .all<{ id: string; transports: string | null }>();
    for (const cred of creds.results) {
      excludeCredentials.push({
        id: cred.id,
        transports: cred.transports ? (cred.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
      });
    }
  }

  const { rpID } = getRpIdAndOrigin(c);
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID,
    userName: username,
    userDisplayName: displayName,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials,
  });

  sweepPasskeyChallenges();
  _passkeyChallenge.set(`reg:${username}`, {
    challenge: options.challenge,
    userId,
    displayName,
    expiresAt: Date.now() + PASSKEY_TTL_MS,
  });

  return c.json(options);
});

// Verify passkey registration and create account + session
auth.post("/auth/passkey/register/verify", async (c) => {
  const ip = getClientIp(c.req.raw);
  const rl = checkRateLimit(`passkey-reg:${ip}`, 30);
  if (rl.limited) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await c.req.json<{ username: string; credential: RegistrationResponseJSON }>();
  if (!body.username || !body.credential) {
    return c.json({ error: "Missing username or credential" }, 400);
  }

  const username = body.username.toLowerCase();
  const entry = _passkeyChallenge.get(`reg:${username}`);
  if (!entry || Date.now() > entry.expiresAt) {
    return c.json({ error: "Registration session expired. Please try again." }, 400);
  }

  const { rpID, origin } = getRpIdAndOrigin(c);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: entry.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // "preferred" - don't reject if UV flag unset
    });
  } catch {
    return c.json({ error: "Passkey verification failed. Please try again." }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "Passkey verification failed." }, 400);
  }

  const { credential: cred, credentialDeviceType } = verification.registrationInfo;
  _passkeyChallenge.delete(`reg:${username}`);

  // Get or create user - passkey-only users get sentinel password_hash
  const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: string }>();

  let finalUserId = entry.userId!;
  if (!existingUser) {
    // KEY-DECISION 2026-02-20: "PASSKEY_ONLY" sentinel for password_hash. verifyPassword()
    // always returns false for this value (format mismatch), naturally denying password login.
    await c.env.DB.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)")
      .bind(finalUserId, username, "PASSKEY_ONLY", entry.displayName!)
      .run();
  } else {
    finalUserId = existingUser.id;
  }

  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key, counter, transports, device_type) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      cred.id,
      finalUserId,
      uint8ArrayToBase64url(cred.publicKey),
      cred.counter,
      cred.transports?.join(",") ?? null,
      credentialDeviceType,
    )
    .run();

  await createAndSetSession(c, finalUserId);
  return c.json({ user: { id: finalUserId, username, displayName: entry.displayName! } });
});

// Generate authentication options (session key returned for challenge lookup on verify)
auth.post("/auth/passkey/login/options", async (c) => {
  const ip = getClientIp(c.req.raw);
  const rl = checkRateLimit(`passkey-login:${ip}`, 20);
  if (rl.limited) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await c.req.json<{ username?: string }>().catch(() => ({}) as { username?: string });
  const { rpID } = getRpIdAndOrigin(c);

  // If username provided, restrict to their credentials; otherwise allow discoverable flow
  const allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];
  if (body.username) {
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(body.username.toLowerCase())
      .first<{ id: string }>();
    if (user) {
      const creds = await c.env.DB.prepare("SELECT id, transports FROM webauthn_credentials WHERE user_id = ?")
        .bind(user.id)
        .all<{ id: string; transports: string | null }>();
      for (const cred of creds.results) {
        allowCredentials.push({
          id: cred.id,
          transports: cred.transports ? (cred.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
        });
      }
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
    userVerification: "preferred",
  });

  const sessionKey = crypto.randomUUID();
  sweepPasskeyChallenges();
  _passkeyChallenge.set(`login:${sessionKey}`, {
    challenge: options.challenge,
    expiresAt: Date.now() + PASSKEY_TTL_MS,
  });

  return c.json({ ...options, _sessionKey: sessionKey });
});

// Verify passkey authentication and issue session
auth.post("/auth/passkey/login/verify", async (c) => {
  const ip = getClientIp(c.req.raw);
  const rl = checkRateLimit(`passkey-login:${ip}`, 20);
  if (rl.limited) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await c.req.json<{ sessionKey: string; credential: AuthenticationResponseJSON }>();
  if (!body.sessionKey || !body.credential) {
    return c.json({ error: "Missing sessionKey or credential" }, 400);
  }

  const entry = _passkeyChallenge.get(`login:${body.sessionKey}`);
  if (!entry || Date.now() > entry.expiresAt) {
    return c.json({ error: "Login session expired. Please try again." }, 400);
  }

  const credRow = await c.env.DB.prepare(
    `SELECT wc.id, wc.user_id, wc.public_key, wc.counter, wc.transports,
            u.username, u.display_name
     FROM webauthn_credentials wc JOIN users u ON wc.user_id = u.id
     WHERE wc.id = ?`,
  )
    .bind(body.credential.id)
    .first<{
      id: string;
      user_id: string;
      public_key: string;
      counter: number;
      transports: string | null;
      username: string;
      display_name: string;
    }>();

  if (!credRow) {
    return c.json({ error: "Credential not found. Please register a passkey first." }, 400);
  }

  const { rpID, origin } = getRpIdAndOrigin(c);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: entry.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credRow.id,
        publicKey: base64urlToUint8Array(credRow.public_key),
        counter: credRow.counter,
        transports: credRow.transports ? (credRow.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
      },
      requireUserVerification: false,
    });
  } catch {
    return c.json({ error: "Passkey authentication failed. Please try again." }, 400);
  }

  if (!verification.verified) {
    return c.json({ error: "Passkey authentication failed." }, 400);
  }

  _passkeyChallenge.delete(`login:${body.sessionKey}`);

  // Update counter to prevent replay attacks
  await c.env.DB.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, credRow.id)
    .run();

  await createAndSetSession(c, credRow.user_id);
  return c.json({
    user: { id: credRow.user_id, username: credRow.username, displayName: credRow.display_name },
  });
});

// --- Middleware for protecting routes ---

export async function getSessionUser(
  db: D1Database,
  sessionId: string | undefined,
): Promise<{ id: string; username: string; displayName: string } | null> {
  if (!sessionId) return null;

  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime('now')`,
    )
    .bind(sessionId)
    .first<{ id: string; username: string; display_name: string }>();

  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}
