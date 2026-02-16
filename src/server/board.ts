import type { BoardObject, WSClientMessage, WSServerMessage } from "../shared/types";

interface ConnectionMeta {
  userId: string;
  username: string;
}

export class Board {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const userId = url.searchParams.get("userId");
      const username = url.searchParams.get("username");
      if (!userId || !username) {
        return new Response("Missing user info", { status: 400 });
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      // Store metadata on the WebSocket itself (survives hibernation)
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ userId, username } satisfies ConnectionMeta);

      // Send init: all objects + presence
      const objects = await this.getAllObjects();
      const users = this.getPresenceList();
      server.send(JSON.stringify({ type: "init", objects } satisfies WSServerMessage));
      server.send(JSON.stringify({ type: "presence", users } satisfies WSServerMessage));

      // Broadcast updated presence to everyone else
      this.broadcast({ type: "presence", users }, server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Expected WebSocket", { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const meta = ws.deserializeAttachment() as ConnectionMeta | null;
    if (!meta) return;

    const msg = JSON.parse(raw as string) as WSClientMessage;

    switch (msg.type) {
      case "cursor": {
        this.broadcast(
          { type: "cursor", userId: meta.userId, username: meta.username, x: msg.x, y: msg.y },
          ws
        );
        break;
      }
      case "obj:create": {
        const obj = { ...msg.obj, createdBy: meta.userId, updatedAt: Date.now() };
        await this.state.storage.put(`obj:${obj.id}`, obj);
        this.broadcast({ type: "obj:create", obj }, ws);
        break;
      }
      case "obj:update": {
        const existing = await this.state.storage.get<BoardObject>(`obj:${msg.obj.id}`);
        if (!existing) break;
        // LWW: reject if client's timestamp is older than stored
        if (msg.obj.updatedAt && msg.obj.updatedAt < existing.updatedAt) break;
        const updated = { ...existing, ...msg.obj, updatedAt: Date.now() };
        await this.state.storage.put(`obj:${updated.id}`, updated);
        this.broadcast({ type: "obj:update", obj: updated }, ws);
        break;
      }
      case "obj:delete": {
        await this.state.storage.delete(`obj:${msg.id}`);
        this.broadcast({ type: "obj:delete", id: msg.id }, ws);
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
  }

  // --- Helpers ---

  private getWebSockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  private getMeta(ws: WebSocket): ConnectionMeta | null {
    return ws.deserializeAttachment() as ConnectionMeta | null;
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
    const entries = await this.state.storage.list<BoardObject>({ prefix: "obj:" });
    return [...entries.values()];
  }

  private getPresenceList(): { id: string; username: string }[] {
    const seen = new Set<string>();
    const users: { id: string; username: string }[] = [];
    for (const ws of this.getWebSockets()) {
      const meta = this.getMeta(ws);
      if (meta && !seen.has(meta.userId)) {
        seen.add(meta.userId);
        users.push({ id: meta.userId, username: meta.username });
      }
    }
    return users;
  }
}
