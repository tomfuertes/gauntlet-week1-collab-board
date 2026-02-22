import { useEffect, useRef, useCallback, useState } from "react";
import type {
  WSClientMessage,
  WSServerMessage,
  BoardObject,
  BoardObjectUpdate,
  ChoreographyStep,
  TransientEffect,
  Poll,
  PollResult,
} from "@shared/types";
import { SFX_EFFECTS } from "@shared/types";
import type { HeckleEvent, CanvasBubble } from "./useSpectatorSocket";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export interface CursorState {
  userId: string;
  username: string;
  x: number;
  y: number;
}

export interface TextCursorState {
  userId: string;
  username: string;
  objectId: string;
  position: number;
  lastSeen: number;
}

const TEXT_CURSOR_TTL_MS = 5000; // clear stale editing indicators if no update within 5s

export interface Reaction {
  id: string;
  emoji: string;
  x: number;
  y: number;
  ts: number;
}

export interface CurtainCallData {
  characters: { id: string; name: string }[];
  sceneTitle: string;
}

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  initialized: boolean;
  cursors: Map<string, CursorState>;
  textCursors: Map<string, TextCursorState>;
  objects: Map<string, BoardObject>;
  presence: { id: string; username: string }[];
  spectatorCount: number;
  reactions: Reaction[];
  heckleEvents: HeckleEvent[];
  canvasBubbles: CanvasBubble[];
  curtainCall: CurtainCallData | null;
  clearCurtainCall: () => void;
  audienceWave: { emoji: string; count: number; effect: string } | null;
  clearAudienceWave: () => void;
  activePoll: Poll | null;
  pollResult: PollResult | null;
  clearPollResult: () => void;
  send: (msg: WSClientMessage) => void;
  createObject: (obj: BoardObject) => void;
  updateObject: (partial: BoardObjectUpdate) => void;
  deleteObject: (id: string) => void;
  /** Update local state only (no WS send). Used for real-time visual feedback during drag. */
  patchObjectLocal: (id: string, patch: Partial<BoardObject>) => void;
  batchUndo: (batchId: string) => void;
  lastServerMessageAt: React.RefObject<number>;
  lastRttMs: React.RefObject<number>;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;
const MAX_RETRY_COUNT = 10;

// Close codes that should NOT trigger reconnection
// 1000/1001: normal/going-away (intentional server close)
// 4001-4099: app-level non-retryable (auth failure, invalid board, etc.)
function isNonRetryableCode(code: number): boolean {
  return code === 1000 || code === 1001 || (code >= 4001 && code <= 4099);
}

export function useWebSocket(
  boardId: string,
  onAnimatedUpdate?: (
    id: string,
    toX: number,
    toY: number,
    toWidth: number,
    toHeight: number,
    durationMs: number,
  ) => void,
  onEffect?: (id: string, effect: string) => void,
  onSequence?: (steps: ChoreographyStep[]) => void,
  onSpotlight?: (objectId?: string, x?: number, y?: number) => void,
  onBlackout?: () => void,
  onSfx?: (effect: string, emoji: string, label: string, x: number, y: number) => void,
  onTransient?: (effect: TransientEffect) => void,
  onMood?: (mood: string, intensity: number) => void,
  onBoardRenamed?: (name: string) => void,
): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  // Refs so the WS closure always calls the latest callbacks without reconnecting
  const onAnimatedUpdateRef = useRef(onAnimatedUpdate);
  onAnimatedUpdateRef.current = onAnimatedUpdate;
  const onEffectRef = useRef(onEffect);
  onEffectRef.current = onEffect;
  const onSequenceRef = useRef(onSequence);
  onSequenceRef.current = onSequence;
  const onSpotlightRef = useRef(onSpotlight);
  onSpotlightRef.current = onSpotlight;
  const onBlackoutRef = useRef(onBlackout);
  onBlackoutRef.current = onBlackout;
  const onSfxRef = useRef(onSfx);
  onSfxRef.current = onSfx;
  const onTransientRef = useRef(onTransient);
  onTransientRef.current = onTransient;
  const onMoodRef = useRef(onMood);
  onMoodRef.current = onMood;
  const onBoardRenamedRef = useRef(onBoardRenamed);
  onBoardRenamedRef.current = onBoardRenamed;
  const lastServerMessageAt = useRef(0);
  // Stores the most recent DO round-trip latency in ms (-1 = no measurement yet)
  const lastRttMs = useRef(-1);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [initialized, setInitialized] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map());
  const [textCursors, setTextCursors] = useState<Map<string, TextCursorState>>(new Map());
  const [objects, setObjects] = useState<Map<string, BoardObject>>(new Map());
  const [presence, setPresence] = useState<{ id: string; username: string }[]>([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [heckleEvents, setHeckleEvents] = useState<HeckleEvent[]>([]);
  const [canvasBubbles, setCanvasBubbles] = useState<CanvasBubble[]>([]);
  const [curtainCall, setCurtainCall] = useState<CurtainCallData | null>(null);
  const [audienceWave, setAudienceWave] = useState<{ emoji: string; count: number; effect: string } | null>(null);
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);

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
        if (localStorage.getItem("debug-ws")) console.log("[WS] open", boardId);
        setConnectionState("connected");
      };

      ws.onclose = (event: CloseEvent) => {
        wsRef.current = null;
        if (intentionalClose) {
          if (localStorage.getItem("debug-ws")) console.log("[WS] close (intentional)", boardId);
          setConnectionState("disconnected");
          return;
        }
        console.warn(`[WS] closed: code=${event.code} reason="${event.reason}" clean=${event.wasClean}`);
        // KEY-DECISION 2026-02-20: non-retryable codes (auth failures, normal close) go straight
        // to "disconnected" rather than "failed" - they're expected exits, not exhausted retries
        if (isNonRetryableCode(event.code)) {
          setConnectionState("disconnected");
          return;
        }
        if (attempt >= MAX_RETRY_COUNT) {
          console.error(`[WS] max retries (${MAX_RETRY_COUNT}) exhausted, giving up`);
          setConnectionState("failed");
          return;
        }
        setConnectionState("reconnecting");
        const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
        const delay = base * (0.5 + Math.random() * 0.5); // jitter to avoid thundering herd
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      // When onerror fires, onclose always follows - reconnect logic lives in onclose
      ws.onerror = () => {
        if (localStorage.getItem("debug-ws")) console.log("[WS] error", boardId, `attempt=${attempt}`);
        console.error(`[WS] error on board ${boardId} (attempt ${attempt})`);
      };

      ws.onmessage = (event) => {
        lastServerMessageAt.current = performance.now();
        let msg: WSServerMessage;
        try {
          msg = JSON.parse(event.data) as WSServerMessage;
        } catch {
          // intentional: malformed server messages are non-recoverable
          console.error("[WS] failed to parse message:", event.data);
          return;
        }

        switch (msg.type) {
          case "init":
            setObjects(new Map(msg.objects.map((o) => [o.id, o])));
            setCursors(new Map());
            setTextCursors(new Map());
            setInitialized(true);
            break;
          case "cursor":
            setCursors((prev) => {
              const next = new Map(prev);
              next.set(msg.userId, { userId: msg.userId, username: msg.username, x: msg.x, y: msg.y });
              return next;
            });
            break;
          case "text:cursor":
            setTextCursors((prev) => {
              const next = new Map(prev);
              next.set(msg.userId, {
                userId: msg.userId,
                username: msg.username,
                objectId: msg.objectId,
                position: msg.position,
                lastSeen: Date.now(),
              });
              return next;
            });
            break;
          case "text:blur":
            setTextCursors((prev) => {
              const next = new Map(prev);
              next.delete(msg.userId);
              return next;
            });
            break;
          case "presence":
            setPresence(msg.users);
            setSpectatorCount(msg.spectatorCount);
            // Remove cursors for players no longer present (cleans up AI ghost cursor).
            // Skip spectator-* IDs - they aren't in the users list by design.
            setCursors((prev) => {
              const activeIds = new Set(msg.users.map((u: { id: string }) => u.id));
              let changed = false;
              const next = new Map(prev);
              for (const userId of next.keys()) {
                if (userId.startsWith("spectator-")) continue;
                if (!activeIds.has(userId)) {
                  next.delete(userId);
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
            break;
          case "obj:create":
            if (localStorage.getItem("debug-ws")) console.log("[WS]", msg.type, msg.obj?.id, msg.obj?.type);
            setObjects((prev) => new Map(prev).set(msg.obj.id, msg.obj));
            break;
          case "obj:update":
            if (localStorage.getItem("debug-ws")) console.log("[WS]", msg.type, msg.obj?.id, msg.obj?.type);
            // Fire animation callback before state update so caller can capture current Konva node position
            if (msg.anim) {
              onAnimatedUpdateRef.current?.(
                msg.obj.id,
                msg.obj.x,
                msg.obj.y,
                msg.obj.width,
                msg.obj.height,
                msg.anim.duration,
              );
            }
            setObjects((prev) => {
              const next = new Map(prev);
              const existing = next.get(msg.obj.id);
              if (!existing) return prev;
              // Server sends full object - LWW: apply if same age or newer
              const merged = msg.obj as BoardObject;
              if (merged.updatedAt && merged.updatedAt >= existing.updatedAt) {
                next.set(msg.obj.id, merged);
              }
              return next;
            });
            break;
          case "obj:delete":
            if (localStorage.getItem("debug-ws")) console.log("[WS]", msg.type, msg.id, undefined);
            setObjects((prev) => {
              const next = new Map(prev);
              next.delete(msg.id);
              return next;
            });
            break;
          case "obj:effect":
            onEffectRef.current?.(msg.id, msg.effect);
            break;
          case "obj:sequence":
            onSequenceRef.current?.(msg.steps);
            break;
          case "spotlight":
            onSpotlightRef.current?.(msg.objectId, msg.x, msg.y);
            break;
          case "blackout":
            onBlackoutRef.current?.();
            break;
          case "reaction":
            setReactions((prev) => [
              ...prev,
              { id: crypto.randomUUID(), emoji: msg.emoji, x: msg.x, y: msg.y, ts: Date.now() },
            ]);
            break;
          case "heckle":
            setHeckleEvents((prev) => [
              ...prev,
              { id: crypto.randomUUID(), userId: msg.userId, text: msg.text, ts: Date.now() },
            ]);
            setCanvasBubbles((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                userId: msg.userId,
                username: "Audience",
                text: msg.text,
                ts: Date.now(),
                isHeckle: true,
              },
            ]);
            break;
          case "chat:bubble":
            setCanvasBubbles((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                userId: msg.userId,
                username: msg.username,
                text: msg.text,
                ts: Date.now(),
                isHeckle: false,
              },
            ]);
            break;
          case "sfx": {
            const sfxDef = SFX_EFFECTS.find((e) => e.id === msg.effect);
            if (sfxDef) {
              onSfxRef.current?.(msg.effect, sfxDef.emoji, sfxDef.label, msg.x, msg.y);
            }
            break;
          }
          case "obj:transient":
            onTransientRef.current?.(msg.effect);
            break;
          case "curtain_call":
            setCurtainCall({ characters: msg.characters, sceneTitle: msg.sceneTitle });
            break;
          case "mood":
            onMoodRef.current?.(msg.mood, msg.intensity);
            break;
          case "audience:wave":
            setAudienceWave({ emoji: msg.emoji, count: msg.count, effect: msg.effect });
            break;
          case "poll:start":
            setActivePoll(msg.poll);
            setPollResult(null);
            break;
          case "poll:result":
            setActivePoll(null);
            setPollResult(msg.result);
            break;
          case "pong":
            lastRttMs.current = Math.round(performance.now() - msg.sentAt);
            break;
          case "board:deleted":
            // Board was deleted by owner - navigate away
            intentionalClose = true;
            wsRef.current?.close();
            setConnectionState("disconnected");
            setObjects(new Map());
            setPresence([]);
            break;
          case "board:renamed":
            onBoardRenamedRef.current?.(msg.name);
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

  // Sweep stale text cursors - handles text:blur dropped on WS disconnect
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTextCursors((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [userId, tc] of next) {
          if (now - tc.lastSeen > TEXT_CURSOR_TTL_MS) {
            next.delete(userId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Clean up expired reactions (3s TTL) and canvas bubbles (5s TTL)
  useEffect(() => {
    const id = setInterval(() => {
      const reactionCutoff = Date.now() - 3000;
      const bubbleCutoff = Date.now() - 5000;
      setReactions((prev) => {
        const next = prev.filter((r) => r.ts > reactionCutoff);
        return next.length === prev.length ? prev : next;
      });
      setCanvasBubbles((prev) => {
        const next = prev.filter((b) => b.ts > bubbleCutoff);
        return next.length === prev.length ? prev : next;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Send a ping every 5s to measure DO round-trip latency
  useEffect(() => {
    const id = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping", sentAt: performance.now() }));
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const send = useCallback((msg: WSClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else if (msg.type !== "cursor" && msg.type !== "text:cursor" && msg.type !== "text:blur") {
      console.warn("[WS] dropping message while disconnected:", msg.type);
    }
  }, []);

  const createObject = useCallback(
    (obj: BoardObject) => {
      setObjects((prev) => new Map(prev).set(obj.id, obj));
      send({ type: "obj:create", obj });
    },
    [send],
  );

  const updateObject = useCallback(
    (partial: BoardObjectUpdate) => {
      const now = Date.now();
      setObjects((prev) => {
        const next = new Map(prev);
        const existing = next.get(partial.id);
        // Cast safe: merging into valid BoardObject preserves discriminant (type unchanged)
        if (existing)
          next.set(partial.id, {
            ...existing,
            ...partial,
            props: { ...existing.props, ...(partial.props || {}) },
            updatedAt: now,
          } as BoardObject);
        return next;
      });
      send({ type: "obj:update", obj: { ...partial, updatedAt: now } });
    },
    [send],
  );

  const deleteObject = useCallback(
    (id: string) => {
      setObjects((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      send({ type: "obj:delete", id });
    },
    [send],
  );

  /** Update local objects Map without sending a WS message. For real-time drag-follow. */
  const patchObjectLocal = useCallback((id: string, patch: Partial<BoardObject>) => {
    setObjects((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(id, { ...existing, ...patch } as BoardObject);
      return next;
    });
  }, []);

  const clearCurtainCall = useCallback(() => setCurtainCall(null), []);
  const clearAudienceWave = useCallback(() => setAudienceWave(null), []);
  const clearPollResult = useCallback(() => setPollResult(null), []);

  /** Send batch:undo to Board DO via WS - deletes all objects with matching batchId server-side */
  const batchUndo = useCallback(
    (batchId: string) => {
      send({ type: "batch:undo", batchId });
    },
    [send],
  );

  return {
    connectionState,
    initialized,
    cursors,
    textCursors,
    objects,
    presence,
    spectatorCount,
    reactions,
    heckleEvents,
    canvasBubbles,
    curtainCall,
    clearCurtainCall,
    audienceWave,
    clearAudienceWave,
    activePoll,
    pollResult,
    clearPollResult,
    send,
    createObject,
    updateObject,
    deleteObject,
    patchObjectLocal,
    batchUndo,
    lastServerMessageAt,
    lastRttMs,
  };
}
