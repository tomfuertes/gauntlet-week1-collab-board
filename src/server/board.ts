import { DurableObject } from "cloudflare:workers";
import type { BoardObject, WSClientMessage, WSServerMessage } from "../shared/types";

interface ConnectionMeta {
  userId: string;
  username: string;
}

export class Board extends DurableObject {

  // --- RPC methods (called by Worker via stub) ---

  async readObjects(): Promise<BoardObject[]> {
    return this.getAllObjects();
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
    this.broadcast({ type: "board:deleted" });
    for (const ws of this.getWebSockets()) {
      try { ws.close(1000, "board deleted"); } catch { /* already closed */ }
    }
    return keys.size;
  }

  async mutate(msg: WSClientMessage): Promise<void> {
    await this.handleMutation(msg, "ai-agent");
  }

  // --- WebSocket upgrade (requires HTTP) ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const username = url.searchParams.get("username");
    if (!userId || !username) {
      return new Response("Missing user info", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, username } satisfies ConnectionMeta);

    const objects = await this.getAllObjects();
    const users = this.getPresenceList();
    server.send(JSON.stringify({ type: "init", objects } satisfies WSServerMessage));
    server.send(JSON.stringify({ type: "presence", users } satisfies WSServerMessage));
    this.broadcast({ type: "presence", users }, server);

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
      return; // Ignore malformed messages
    }

    if (msg.type === "cursor") {
      this.broadcast(
        { type: "cursor", userId: meta.userId, username: meta.username, x: msg.x, y: msg.y },
        ws
      );
      return;
    }

    await this.handleMutation(msg, meta.userId, ws);
  }

  async webSocketClose(_ws: WebSocket) {
    // ws is already closed when this handler fires - no need to call ws.close()
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
  }

  // --- Private helpers ---

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
    return users;
  }

  private async handleMutation(msg: WSClientMessage, userId: string, excludeWs?: WebSocket) {
    switch (msg.type) {
      case "obj:create": {
        const obj = { ...msg.obj, createdBy: userId, updatedAt: Date.now() };
        await this.ctx.storage.put(`obj:${obj.id}`, obj);
        this.broadcast({ type: "obj:create", obj }, excludeWs);
        break;
      }
      case "obj:update": {
        const existing = await this.ctx.storage.get<BoardObject>(`obj:${msg.obj.id}`);
        if (!existing) break;
        if (msg.obj.updatedAt && msg.obj.updatedAt < existing.updatedAt) break;
        const updated = { ...existing, ...msg.obj, updatedAt: Date.now() };
        await this.ctx.storage.put(`obj:${updated.id}`, updated);
        this.broadcast({ type: "obj:update", obj: updated }, excludeWs);
        break;
      }
      case "obj:delete": {
        await this.ctx.storage.delete(`obj:${msg.id}`);
        this.broadcast({ type: "obj:delete", id: msg.id }, excludeWs);
        break;
      }
    }
  }
}
