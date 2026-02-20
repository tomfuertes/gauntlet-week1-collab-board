import { DurableObject } from "cloudflare:workers";
import { AI_USER_ID, AI_USERNAME } from "../shared/types";
import type { BoardObject, MutateResult, ReplayEvent, WSClientMessage, WSServerMessage } from "../shared/types";
import type { Bindings } from "./env";
import { recordBoardActivity, markBoardSeen } from "./env";

type ConnectionMeta =
  | { role: "player"; userId: string; username: string; editingObjectId?: string }
  | { role: "spectator"; userId: string; username: string };

// Allowed emoji set for spectator reactions (must match client REACTION_EMOJIS)
const ALLOWED_REACTION_EMOJIS = new Set([
  "\uD83D\uDC4F",
  "\uD83D\uDE02",
  "\uD83D\uDD25",
  "\u2764\uFE0F",
  "\uD83D\uDE2E",
  "\uD83C\uDFAD",
]);

export class Board extends DurableObject<Bindings> {
  // Timestamp when AI presence expires. Class properties reset on DO hibernation,
  // which is correct - if the DO hibernated, the AI stream has already ended.
  private aiActiveUntil = 0;
  // Cached boardId (lazy-loaded from DO Storage, set on first WS connect)
  private _boardId: string | null = null;
  // Rate limit: last reaction timestamp per userId (resets on hibernation, which is fine)
  private lastReactionAt = new Map<string, number>();

  private async getBoardId(): Promise<string | null> {
    if (!this._boardId) {
      this._boardId = (await this.ctx.storage.get<string>("meta:boardId")) ?? null;
    }
    return this._boardId;
  }

  private async setBoardId(id: string): Promise<void> {
    this._boardId = id;
    await this.ctx.storage.put("meta:boardId", id);
  }

  // Event recording for scene replay
  private lastRecordedAt = new Map<string, number>(); // objId -> timestamp (debounce tracker)
  private eventCount = -1; // -1 = not yet loaded

  // --- RPC methods (called by Worker via stub) ---
  // readObjects, readObject, mutate, injectCursor implement the BoardStub contract (shared/types.ts)

  async getStats(): Promise<{ objectCount: number; eventCount: number }> {
    const [objs, evts] = await Promise.all([
      this.ctx.storage.list({ prefix: "obj:", limit: 501 }),
      this.ctx.storage.list({ prefix: "evt:", limit: 2001 }),
    ]);
    return { objectCount: objs.size, eventCount: evts.size };
  }

  async readObjects(): Promise<BoardObject[]> {
    return this.getAllObjects();
  }

  async readEvents(): Promise<ReplayEvent[]> {
    const entries = await this.ctx.storage.list<ReplayEvent>({ prefix: "evt:" });
    return [...entries.values()];
  }

  async readObject(id: string): Promise<BoardObject | null> {
    return (await this.ctx.storage.get<BoardObject>(`obj:${id}`)) ?? null;
  }

  async clearBoard(): Promise<number> {
    const keys = await this.ctx.storage.list({ prefix: "obj:" });
    await this.ctx.storage.delete([...keys.keys()]);
    this.broadcast({ type: "init", objects: [] });
    return keys.size;
  }

  async deleteBoard(): Promise<number> {
    const keys = await this.ctx.storage.list({ prefix: "obj:" });
    await this.ctx.storage.delete([...keys.keys()]);
    await this.ctx.storage.delete("meta:boardId");
    this.broadcast({ type: "board:deleted" });
    for (const ws of this.getWebSockets()) {
      try {
        ws.close(1000, "board deleted");
      } catch {
        /* already closed */
      }
    }
    return keys.size;
  }

  async mutate(msg: WSClientMessage): Promise<MutateResult> {
    return this.handleMutation(msg, AI_USER_ID);
  }

  /** Broadcast AI cursor position to all WS clients (virtual user - no real WS connection) */
  async injectCursor(x: number, y: number): Promise<void> {
    this.broadcast({
      type: "cursor",
      userId: AI_USER_ID,
      username: AI_USERNAME,
      x,
      y,
    });
  }

  /** Mark this board as publicly archived in D1 (called from ChatAgent on curtain phase).
   *  KEY-DECISION 2026-02-20: Board DO owns the D1 write so boardId is always available
   *  via getBoardId() - ChatAgent would need a separate D1 query to get it. */
  async archiveScene(): Promise<void> {
    const boardId = await this.getBoardId();
    if (!boardId) {
      console.debug(JSON.stringify({ event: "archive:skip", reason: "no-boardId" }));
      return;
    }
    try {
      await this.env.DB.prepare("UPDATE boards SET is_public = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(boardId)
        .run();
      console.debug(JSON.stringify({ event: "archive:scene", boardId }));
    } catch (err) {
      console.error(JSON.stringify({ event: "archive:error", boardId, error: String(err) }));
    }
  }

  /** Set AI presence visibility in the presence list */
  async setAiPresence(active: boolean): Promise<void> {
    this.aiActiveUntil = active ? Date.now() + 60_000 : 0;
    const { users, spectatorCount } = this.getPresenceList();
    this.broadcast({ type: "presence", users, spectatorCount });
  }

  /** Delete all objects created by a specific AI batch, broadcast deletions */
  private async undoBatch(batchId: string): Promise<void> {
    const entries = await this.ctx.storage.list<BoardObject>({ prefix: "obj:" });
    const toDelete: string[] = [];
    for (const [key, obj] of entries) {
      if (obj.batchId === batchId) toDelete.push(key);
    }
    if (toDelete.length === 0) return;
    await this.ctx.storage.delete(toDelete);
    for (const key of toDelete) {
      const id = key.slice(4); // strip "obj:" prefix
      this.broadcast({ type: "obj:delete", id });
    }
  }

  // --- WebSocket upgrade (requires HTTP) ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const username = url.searchParams.get("username");
    const boardId = url.searchParams.get("boardId");
    const role = url.searchParams.get("role") === "spectator" ? ("spectator" as const) : ("player" as const);
    if (!userId || !username) {
      return new Response("Missing user info", { status: 400 });
    }

    // Persist boardId for activity tracking (skips write if already stored)
    if (boardId && !(await this.getBoardId())) await this.setBoardId(boardId);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, username, role } satisfies ConnectionMeta);

    const objects = await this.getAllObjects();
    const { users, spectatorCount } = this.getPresenceList();
    server.send(JSON.stringify({ type: "init", objects } satisfies WSServerMessage));
    server.send(JSON.stringify({ type: "presence", users, spectatorCount } satisfies WSServerMessage));
    this.broadcast({ type: "presence", users, spectatorCount }, server);

    // Mark board as seen for connecting user (non-blocking)
    if (boardId) {
      this.ctx.waitUntil(
        markBoardSeen(this.env.DB, userId, boardId).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "activity:markSeen", trigger: "ws:connect", error: String(err) }));
        }),
      );
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket Hibernation API handlers ---

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const meta = ws.deserializeAttachment() as ConnectionMeta | null;
    if (!meta) return;

    let msg: WSClientMessage;
    try {
      msg = JSON.parse(raw as string) as WSClientMessage;
    } catch {
      // intentional: malformed client messages are non-recoverable
      console.warn("[WS] malformed message, ignoring");
      return;
    }

    // Spectators can only send cursor updates and reactions
    if (meta.role === "spectator" && msg.type !== "cursor" && msg.type !== "reaction") {
      console.warn(JSON.stringify({ event: "spectator:blocked", type: msg.type, userId: meta.userId }));
      return;
    }

    if (msg.type === "cursor") {
      this.broadcast({ type: "cursor", userId: meta.userId, username: meta.username, x: msg.x, y: msg.y }, ws);
      return;
    }

    if (msg.type === "reaction") {
      if (!ALLOWED_REACTION_EMOJIS.has(msg.emoji)) return;
      // Rate limit: 1 reaction per second per user
      const now = Date.now();
      const last = this.lastReactionAt.get(meta.userId) ?? 0;
      if (now - last < 1000) return;
      this.lastReactionAt.set(meta.userId, now);
      this.broadcast({ type: "reaction", userId: meta.userId, emoji: msg.emoji, x: msg.x, y: msg.y });
      // Only spectator reactions count toward the challenge leaderboard
      if (meta.role === "spectator") this.trackReaction();
      return;
    }

    if (msg.type === "text:cursor" && meta.role === "player") {
      const updated: ConnectionMeta = {
        role: "player",
        userId: meta.userId,
        username: meta.username,
        editingObjectId: msg.objectId,
      };
      ws.serializeAttachment(updated);
      this.broadcast(
        {
          type: "text:cursor",
          userId: meta.userId,
          username: meta.username,
          objectId: msg.objectId,
          position: msg.position,
        },
        ws,
      );
      return;
    }

    if (msg.type === "text:blur" && meta.role === "player") {
      const updated: ConnectionMeta = { role: "player", userId: meta.userId, username: meta.username };
      ws.serializeAttachment(updated);
      this.broadcast({ type: "text:blur", userId: meta.userId, objectId: msg.objectId }, ws);
      return;
    }

    if (msg.type === "batch:undo") {
      await this.undoBatch(msg.batchId);
      return;
    }

    await this.handleMutation(msg, meta.userId, ws);
  }

  async webSocketClose(ws: WebSocket) {
    // ws is already closed when this handler fires - no need to call ws.close()
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
    this.handleDisconnect(ws);
  }

  // --- Private helpers ---

  private handleDisconnect(ws: WebSocket): void {
    const meta = ws.deserializeAttachment() as ConnectionMeta | null;
    if (meta && meta.role === "player" && meta.editingObjectId) {
      this.broadcast({ type: "text:blur", userId: meta.userId, objectId: meta.editingObjectId });
    }
    const { users, spectatorCount } = this.getPresenceList();
    this.broadcast({ type: "presence", users, spectatorCount });

    // Mark board as seen on disconnect (catches activity created during the session)
    if (meta) {
      this.markSeenForUser(meta.userId);
    }
  }

  private getWebSockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  private broadcast(msg: WSServerMessage, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(data);
        } catch {
          // Dead connection, will be cleaned up on close/error
        }
      }
    }
  }

  private async getAllObjects(): Promise<BoardObject[]> {
    const entries = await this.ctx.storage.list<BoardObject>({ prefix: "obj:" });
    return [...entries.values()];
  }

  private getPresenceList(): { users: { id: string; username: string }[]; spectatorCount: number } {
    const seen = new Set<string>();
    const users: { id: string; username: string }[] = [];
    let spectatorCount = 0;
    for (const ws of this.getWebSockets()) {
      const meta = ws.deserializeAttachment() as ConnectionMeta | null;
      if (!meta) continue;
      if (meta.role === "spectator") {
        spectatorCount++;
        continue;
      }
      if (!seen.has(meta.userId)) {
        seen.add(meta.userId);
        users.push({ id: meta.userId, username: meta.username });
      }
    }
    if (this.aiActiveUntil > Date.now()) {
      users.push({ id: AI_USER_ID, username: AI_USERNAME });
    }
    return { users, spectatorCount };
  }

  private async recordEvent(event: ReplayEvent, debounceMs = 500): Promise<void> {
    const MAX_EVENTS = 2000;

    // Debounce obj:update - skip if within debounce window since last recorded
    if (event.type === "obj:update" && event.obj) {
      const last = this.lastRecordedAt.get(event.obj.id);
      if (last && event.ts - last < debounceMs) return;
      this.lastRecordedAt.set(event.obj.id, event.ts);
    }

    // Lazy-load event count on first call (resets on hibernation, re-counted on next mutation)
    if (this.eventCount < 0) {
      const all = await this.ctx.storage.list({ prefix: "evt:", limit: MAX_EVENTS + 1 });
      this.eventCount = all.size;
    }

    if (this.eventCount >= MAX_EVENTS) return;

    // Key: evt:{16-digit-padded-ts}:{4-char-random} for lexicographic chronological order
    const ts = String(event.ts).padStart(16, "0");
    const rand = crypto.randomUUID().slice(0, 4);
    await this.ctx.storage.put(`evt:${ts}:${rand}`, event);
    this.eventCount++;
  }

  private async handleMutation(msg: WSClientMessage, userId: string, excludeWs?: WebSocket): Promise<MutateResult> {
    switch (msg.type) {
      case "obj:create": {
        if (msg.obj.type === "image" && !msg.obj.props?.src) {
          return { ok: false, error: "Image objects require props.src" };
        }
        const obj = { ...msg.obj, createdBy: userId, updatedAt: Date.now() };
        await this.ctx.storage.put(`obj:${obj.id}`, obj);
        this.broadcast({ type: "obj:create", obj }, excludeWs);
        await this.recordEvent({ type: "obj:create", ts: obj.updatedAt, obj });
        this.trackActivity();
        return { ok: true };
      }
      case "obj:update": {
        // No trackActivity() here - obj:update fires per drag pixel, would flood D1.
        // Create/delete + chat messages capture meaningful activity for badges.
        const existing = await this.ctx.storage.get<BoardObject>(`obj:${msg.obj.id}`);
        if (!existing) return { ok: false, error: `Object ${msg.obj.id} not found` };
        if (msg.obj.updatedAt && msg.obj.updatedAt < existing.updatedAt)
          return { ok: false, error: "Stale update (LWW conflict)" };
        const updated = {
          ...existing,
          ...msg.obj,
          props: { ...existing.props, ...(msg.obj.props || {}) },
          updatedAt: Date.now(),
        } as BoardObject;
        await this.ctx.storage.put(`obj:${updated.id}`, updated);
        const animField = "anim" in msg && msg.anim ? { anim: msg.anim } : {};
        this.broadcast({ type: "obj:update", obj: updated, ...animField }, excludeWs);
        const isSpatial =
          (msg.obj.x !== undefined && msg.obj.x !== existing.x) ||
          (msg.obj.y !== undefined && msg.obj.y !== existing.y) ||
          (msg.obj.width !== undefined && msg.obj.width !== existing.width) ||
          (msg.obj.height !== undefined && msg.obj.height !== existing.height) ||
          (msg.obj.rotation !== undefined && msg.obj.rotation !== existing.rotation);
        await this.recordEvent(
          { type: "obj:update", ts: updated.updatedAt, obj: updated, ...animField },
          isSpatial ? 100 : 500,
        );
        return { ok: true };
      }
      case "obj:delete": {
        await this.ctx.storage.delete(`obj:${msg.id}`);
        this.broadcast({ type: "obj:delete", id: msg.id }, excludeWs);
        await this.recordEvent({ type: "obj:delete", ts: Date.now(), id: msg.id });
        this.trackActivity();
        // Cascade: disconnect lines that referenced the deleted object (soft - keeps line, clears binding)
        this.ctx.waitUntil(this.disconnectLines(msg.id));
        return { ok: true };
      }
      case "obj:effect": {
        // Broadcast-only transient effect - no storage write, no replay event
        this.broadcast({ type: "obj:effect", id: msg.id, effect: msg.effect });
        return { ok: true };
      }
    }
    return { ok: false, error: `Unknown message type` };
  }

  /** Soft-disconnect lines referencing a deleted object (clears binding, keeps line as static) */
  private async disconnectLines(deletedId: string): Promise<void> {
    const entries = await this.ctx.storage.list<BoardObject>({ prefix: "obj:" });
    for (const [key, obj] of entries) {
      if (obj.type !== "line") continue;
      if (obj.startObjectId !== deletedId && obj.endObjectId !== deletedId) continue;
      const updated = {
        ...obj,
        startObjectId: obj.startObjectId === deletedId ? undefined : obj.startObjectId,
        endObjectId: obj.endObjectId === deletedId ? undefined : obj.endObjectId,
        updatedAt: Date.now(),
      };
      await this.ctx.storage.put(key, updated);
      this.broadcast({ type: "obj:update", obj: updated });
    }
  }

  /** Fire-and-forget D1 activity increment (non-blocking) */
  private trackActivity(): void {
    this.withBoardId("activity:record", (id) => recordBoardActivity(this.env.DB, id));
  }

  /** Fire-and-forget challenge reaction count increment (no-op if board not linked to a challenge) */
  private trackReaction(): void {
    this.withBoardId("challenge:reaction", (boardId) =>
      this.env.DB.prepare("UPDATE challenge_entries SET reaction_count = reaction_count + 1 WHERE board_id = ?")
        .bind(boardId)
        .run(),
    );
  }

  /** Fire-and-forget mark-seen for a user (non-blocking) */
  private markSeenForUser(userId: string): void {
    this.withBoardId("activity:markSeen", (id) => markBoardSeen(this.env.DB, userId, id));
  }

  /** Run a D1 operation with the cached boardId (fire-and-forget, errors logged) */
  private withBoardId(event: string, fn: (boardId: string) => Promise<unknown>): void {
    this.ctx.waitUntil(
      this.getBoardId()
        .then((boardId) => {
          if (boardId) {
            return fn(boardId).catch((err: unknown) => {
              console.error(JSON.stringify({ event, error: String(err) }));
            });
          }
        })
        .catch((err: unknown) => {
          console.error(JSON.stringify({ event: "activity:getBoardId:error", error: String(err) }));
        }),
    );
  }
}
