import { DurableObject } from "cloudflare:workers";
import { AI_USER_ID, AI_USERNAME } from "../shared/types";
import type { BoardObject, WSClientMessage, WSServerMessage } from "../shared/types";
import type { Bindings, MutateResult } from "./env";
import { recordBoardActivity, markBoardSeen } from "./env";

interface ConnectionMeta {
  userId: string;
  username: string;
  editingObjectId?: string;
}

export class Board extends DurableObject<Bindings> {
  // Timestamp when AI presence expires. Class properties reset on DO hibernation,
  // which is correct - if the DO hibernated, the AI stream has already ended.
  private aiActiveUntil = 0;
  // Cached boardId (lazy-loaded from DO Storage, set on first WS connect)
  private _boardId: string | null = null;

  private async getBoardId(): Promise<string | null> {
    if (!this._boardId) {
      this._boardId = await this.ctx.storage.get<string>("meta:boardId") ?? null;
    }
    return this._boardId;
  }

  private async setBoardId(id: string): Promise<void> {
    this._boardId = id;
    await this.ctx.storage.put("meta:boardId", id);
  }

  // --- RPC methods (called by Worker via stub) ---

  async readObjects(): Promise<BoardObject[]> {
    return this.getAllObjects();
  }

  async readObject(id: string): Promise<BoardObject | null> {
    return await this.ctx.storage.get<BoardObject>(`obj:${id}`) ?? null;
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
      try { ws.close(1000, "board deleted"); } catch { /* already closed */ }
    }
    return keys.size;
  }

  async mutate(msg: WSClientMessage): Promise<MutateResult> {
    return this.handleMutation(msg, AI_USER_ID);
  }

  /** Broadcast AI cursor position to all WS clients (virtual user - no real WS connection) */
  async injectCursor(x: number, y: number): Promise<void> {
    this.broadcast({
      type: "cursor", userId: AI_USER_ID, username: AI_USERNAME, x, y,
    });
  }

  /** Set AI presence visibility in the presence list */
  async setAiPresence(active: boolean): Promise<void> {
    this.aiActiveUntil = active ? Date.now() + 60_000 : 0;
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
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
    if (!userId || !username) {
      return new Response("Missing user info", { status: 400 });
    }

    // Persist boardId for activity tracking (skips write if already stored)
    if (boardId && !(await this.getBoardId())) await this.setBoardId(boardId);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, username } satisfies ConnectionMeta);

    const objects = await this.getAllObjects();
    const users = this.getPresenceList();
    server.send(JSON.stringify({ type: "init", objects } satisfies WSServerMessage));
    server.send(JSON.stringify({ type: "presence", users } satisfies WSServerMessage));
    this.broadcast({ type: "presence", users }, server);

    // Mark board as seen for connecting user (non-blocking)
    if (boardId) {
      this.ctx.waitUntil(
        markBoardSeen(this.env.DB, userId, boardId).catch((err: unknown) => {
          console.error(JSON.stringify({ event: "activity:markSeen", trigger: "ws:connect", error: String(err) }));
        })
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
      console.warn("[WS] malformed message, ignoring");
      return;
    }

    if (msg.type === "cursor") {
      this.broadcast(
        { type: "cursor", userId: meta.userId, username: meta.username, x: msg.x, y: msg.y },
        ws
      );
      return;
    }

    if (msg.type === "text:cursor") {
      ws.serializeAttachment({ ...meta, editingObjectId: msg.objectId } satisfies ConnectionMeta);
      this.broadcast(
        { type: "text:cursor", userId: meta.userId, username: meta.username, objectId: msg.objectId, position: msg.position },
        ws
      );
      return;
    }

    if (msg.type === "text:blur") {
      ws.serializeAttachment({ ...meta, editingObjectId: undefined } satisfies ConnectionMeta);
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
    if (meta?.editingObjectId) {
      this.broadcast({ type: "text:blur", userId: meta.userId, objectId: meta.editingObjectId });
    }
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });

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

  private getPresenceList(): { id: string; username: string }[] {
    const seen = new Set<string>();
    const users: { id: string; username: string }[] = [];
    for (const ws of this.getWebSockets()) {
      const meta = ws.deserializeAttachment() as ConnectionMeta | null;
      if (meta && !seen.has(meta.userId)) {
        seen.add(meta.userId);
        users.push({ id: meta.userId, username: meta.username });
      }
    }
    if (this.aiActiveUntil > Date.now()) {
      users.push({ id: AI_USER_ID, username: AI_USERNAME });
    }
    return users;
  }

  private async handleMutation(msg: WSClientMessage, userId: string, excludeWs?: WebSocket): Promise<MutateResult> {
    switch (msg.type) {
      case "obj:create": {
        const obj = { ...msg.obj, createdBy: userId, updatedAt: Date.now() };
        await this.ctx.storage.put(`obj:${obj.id}`, obj);
        this.broadcast({ type: "obj:create", obj }, excludeWs);
        this.trackActivity();
        return { ok: true };
      }
      case "obj:update": {
        // No trackActivity() here - obj:update fires per drag pixel, would flood D1.
        // Create/delete + chat messages capture meaningful activity for badges.
        const existing = await this.ctx.storage.get<BoardObject>(`obj:${msg.obj.id}`);
        if (!existing) return { ok: false, error: `Object ${msg.obj.id} not found` };
        if (msg.obj.updatedAt && msg.obj.updatedAt < existing.updatedAt) return { ok: false, error: "Stale update (LWW conflict)" };
        const updated = {
          ...existing,
          ...msg.obj,
          props: { ...existing.props, ...(msg.obj.props || {}) },
          updatedAt: Date.now(),
        };
        await this.ctx.storage.put(`obj:${updated.id}`, updated);
        this.broadcast({ type: "obj:update", obj: updated }, excludeWs);
        return { ok: true };
      }
      case "obj:delete": {
        await this.ctx.storage.delete(`obj:${msg.id}`);
        this.broadcast({ type: "obj:delete", id: msg.id }, excludeWs);
        this.trackActivity();
        return { ok: true };
      }
    }
    return { ok: false, error: `Unknown message type` };
  }

  /** Fire-and-forget D1 activity increment (non-blocking) */
  private trackActivity(): void {
    this.withBoardId("activity:record", (id) => recordBoardActivity(this.env.DB, id));
  }

  /** Fire-and-forget mark-seen for a user (non-blocking) */
  private markSeenForUser(userId: string): void {
    this.withBoardId("activity:markSeen", (id) => markBoardSeen(this.env.DB, userId, id));
  }

  /** Run a D1 operation with the cached boardId (fire-and-forget, errors logged) */
  private withBoardId(event: string, fn: (boardId: string) => Promise<unknown>): void {
    this.ctx.waitUntil(
      this.getBoardId().then((boardId) => {
        if (boardId) {
          return fn(boardId).catch((err: unknown) => {
            console.error(JSON.stringify({ event, error: String(err) }));
          });
        }
      }).catch((err: unknown) => {
        console.error(JSON.stringify({ event: "activity:getBoardId:error", error: String(err) }));
      })
    );
  }
}
