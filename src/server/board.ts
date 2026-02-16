import type { BoardObject, WSClientMessage, WSServerMessage } from "../shared/types";

interface ConnectionMeta {
  userId: string;
  username: string;
}

export class Board {
  state: DurableObjectState;
  connections: Map<WebSocket, ConnectionMeta> = new Map();

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

      this.state.acceptWebSocket(server);
      this.connections.set(server, { userId, username });

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
    const meta = this.connections.get(ws);
    if (!meta) return;

    const msg = JSON.parse(raw as string) as WSClientMessage;

    switch (msg.type) {
      case "cursor": {
        // Broadcast cursor to everyone except sender
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
        if (existing) {
          const updated = { ...existing, ...msg.obj, updatedAt: Date.now() };
          await this.state.storage.put(`obj:${updated.id}`, updated);
          this.broadcast({ type: "obj:update", obj: msg.obj }, ws);
        }
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
    this.connections.delete(ws);
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
  }

  async webSocketError(ws: WebSocket) {
    this.connections.delete(ws);
    const users = this.getPresenceList();
    this.broadcast({ type: "presence", users });
  }

  // --- Helpers ---

  private broadcast(msg: WSServerMessage, exclude?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.connections) {
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
    for (const meta of this.connections.values()) {
      if (!seen.has(meta.userId)) {
        seen.add(meta.userId);
        users.push({ id: meta.userId, username: meta.username });
      }
    }
    return users;
  }
}
