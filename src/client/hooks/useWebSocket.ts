import { useEffect, useRef, useCallback, useState } from "react";
import type { WSClientMessage, WSServerMessage, BoardObject } from "@shared/types";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

interface CursorState {
  userId: string;
  username: string;
  x: number;
  y: number;
}

interface UseWebSocketReturn {
  connected: boolean;
  connectionState: ConnectionState;
  cursors: Map<string, CursorState>;
  objects: Map<string, BoardObject>;
  presence: { id: string; username: string }[];
  send: (msg: WSClientMessage) => void;
  createObject: (obj: BoardObject) => void;
  updateObject: (partial: Partial<BoardObject> & { id: string }) => void;
  deleteObject: (id: string) => void;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 8000;

export function useWebSocket(boardId: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map());
  const [objects, setObjects] = useState<Map<string, BoardObject>>(new Map());
  const [presence, setPresence] = useState<{ id: string; username: string }[]>([]);

  const connected = connectionState === "connected";

  useEffect(() => {
    let intentionalClose = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (intentionalClose) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws/board/${boardId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnectionState("connected");
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (intentionalClose) {
          setConnectionState("disconnected");
          return;
        }
        setConnectionState("reconnecting");
        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_CAP_MS);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      // onerror always fires before onclose - no reconnect logic needed here
      ws.onerror = () => {};

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as WSServerMessage;

        switch (msg.type) {
          case "init":
            setObjects(new Map(msg.objects.map((o) => [o.id, o])));
            break;
          case "cursor":
            setCursors((prev) => {
              const next = new Map(prev);
              next.set(msg.userId, { userId: msg.userId, username: msg.username, x: msg.x, y: msg.y });
              return next;
            });
            break;
          case "presence":
            setPresence(msg.users);
            break;
          case "obj:create":
            setObjects((prev) => new Map(prev).set(msg.obj.id, msg.obj));
            break;
          case "obj:update":
            setObjects((prev) => {
              const next = new Map(prev);
              const existing = next.get(msg.obj.id);
              if (!existing) return prev;
              // Server sends full object - LWW: only apply if newer
              const merged = msg.obj as BoardObject;
              if (merged.updatedAt && merged.updatedAt >= existing.updatedAt) {
                next.set(msg.obj.id, merged);
              }
              return next;
            });
            break;
          case "obj:delete":
            setObjects((prev) => {
              const next = new Map(prev);
              next.delete(msg.id);
              return next;
            });
            break;
        }
      };
    }

    setConnectionState("connecting");
    connect();

    return () => {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [boardId]);

  const send = useCallback((msg: WSClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const createObject = useCallback((obj: BoardObject) => {
    setObjects((prev) => new Map(prev).set(obj.id, obj));
    send({ type: "obj:create", obj });
  }, [send]);

  const updateObject = useCallback((partial: Partial<BoardObject> & { id: string }) => {
    const now = Date.now();
    setObjects((prev) => {
      const next = new Map(prev);
      const existing = next.get(partial.id);
      if (existing) next.set(partial.id, { ...existing, ...partial, updatedAt: now });
      return next;
    });
    send({ type: "obj:update", obj: { ...partial, updatedAt: now } });
  }, [send]);

  const deleteObject = useCallback((id: string) => {
    setObjects((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    send({ type: "obj:delete", id });
  }, [send]);

  return { connected, connectionState, cursors, objects, presence, send, createObject, updateObject, deleteObject };
}
