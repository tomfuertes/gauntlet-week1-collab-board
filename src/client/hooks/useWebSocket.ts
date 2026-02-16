import { useEffect, useRef, useCallback, useState } from "react";
import type { WSClientMessage, WSServerMessage, BoardObject } from "@shared/types";

interface CursorState {
  userId: string;
  username: string;
  x: number;
  y: number;
}

interface UseWebSocketReturn {
  connected: boolean;
  cursors: Map<string, CursorState>;
  objects: Map<string, BoardObject>;
  presence: { id: string; username: string }[];
  send: (msg: WSClientMessage) => void;
  createObject: (obj: BoardObject) => void;
  updateObject: (partial: Partial<BoardObject> & { id: string }) => void;
  deleteObject: (id: string) => void;
}

export function useWebSocket(boardId: string): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map());
  const [objects, setObjects] = useState<Map<string, BoardObject>>(new Map());
  const [presence, setPresence] = useState<{ id: string; username: string }[]>([]);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws/board/${boardId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s
      setTimeout(() => {
        // Effect cleanup will handle re-creating
      }, 2000);
    };

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
            if (existing) next.set(msg.obj.id, { ...existing, ...msg.obj });
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

    return () => {
      ws.close();
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
    setObjects((prev) => {
      const next = new Map(prev);
      const existing = next.get(partial.id);
      if (existing) next.set(partial.id, { ...existing, ...partial, updatedAt: Date.now() });
      return next;
    });
    send({ type: "obj:update", obj: partial });
  }, [send]);

  const deleteObject = useCallback((id: string) => {
    setObjects((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    send({ type: "obj:delete", id });
  }, [send]);

  return { connected, cursors, objects, presence, send, createObject, updateObject, deleteObject };
}
