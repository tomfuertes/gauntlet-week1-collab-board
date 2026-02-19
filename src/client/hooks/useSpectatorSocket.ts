import { useEffect, useRef, useCallback, useState } from "react";
import type { WSClientMessage, WSServerMessage, BoardObject } from "@shared/types";
import type { ConnectionState, CursorState, Reaction } from "./useWebSocket";

interface UseSpectatorSocketReturn {
  connectionState: ConnectionState;
  initialized: boolean;
  cursors: Map<string, CursorState>;
  objects: Map<string, BoardObject>;
  presence: { id: string; username: string }[];
  spectatorCount: number;
  reactions: Reaction[];
  sendCursor: (x: number, y: number) => void;
  sendReaction: (emoji: string, x: number, y: number) => void;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 8000;
// Reactions older than this are cleaned up
const REACTION_TTL_MS = 3000;

export function useSpectatorSocket(boardId: string): UseSpectatorSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [initialized, setInitialized] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map());
  const [objects, setObjects] = useState<Map<string, BoardObject>>(new Map());
  const [presence, setPresence] = useState<{ id: string; username: string }[]>([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);

  useEffect(() => {
    let intentionalClose = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (intentionalClose) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws/watch/${boardId}`);
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
        const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
        const delay = base * (0.5 + Math.random() * 0.5);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        console.error(`[WS:spectator] error on board ${boardId} (attempt ${attempt})`);
      };

      ws.onmessage = (event) => {
        let msg: WSServerMessage;
        try {
          msg = JSON.parse(event.data) as WSServerMessage;
        } catch { // intentional: malformed server messages are non-recoverable
          console.error("[WS:spectator] failed to parse message:", event.data);
          return;
        }

        switch (msg.type) {
          case "init":
            setObjects(new Map(msg.objects.map((o) => [o.id, o])));
            setCursors(new Map());
            setInitialized(true);
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
            setSpectatorCount(msg.spectatorCount);
            // Skip spectator-* IDs in cursor cleanup - they aren't in the users list
            setCursors((prev) => {
              const activeIds = new Set(msg.users.map((u) => u.id));
              let changed = false;
              const next = new Map(prev);
              for (const userId of next.keys()) {
                if (userId.startsWith("spectator-")) continue;
                if (!activeIds.has(userId)) { next.delete(userId); changed = true; }
              }
              return changed ? next : prev;
            });
            break;
          case "obj:create":
            setObjects((prev) => new Map(prev).set(msg.obj.id, msg.obj));
            break;
          case "obj:update":
            setObjects((prev) => {
              const next = new Map(prev);
              const existing = next.get(msg.obj.id);
              if (!existing) return prev;
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
          case "reaction":
            setReactions((prev) => [
              ...prev,
              { id: crypto.randomUUID(), emoji: msg.emoji, x: msg.x, y: msg.y, ts: Date.now() },
            ]);
            break;
          case "board:deleted":
            intentionalClose = true;
            wsRef.current?.close();
            setConnectionState("disconnected");
            setObjects(new Map());
            setPresence([]);
            break;
        }
      };
    }

    setConnectionState("connecting");
    setInitialized(false);
    connect();

    return () => {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [boardId]);

  // Clean up expired reactions
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - REACTION_TTL_MS;
      setReactions((prev) => {
        const next = prev.filter((r) => r.ts > cutoff);
        return next.length === prev.length ? prev : next;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  const sendCursor = useCallback((x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cursor", x, y } satisfies WSClientMessage));
    }
  }, []);

  const sendReaction = useCallback((emoji: string, x: number, y: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reaction", emoji, x, y } satisfies WSClientMessage));
    }
  }, []);

  return { connectionState, initialized, cursors, objects, presence, spectatorCount, reactions, sendCursor, sendReaction };
}
