import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { Stage, Layer, Rect, Text, Transformer, Arrow as KonvaArrow, Circle as KonvaCircle, Shape } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import Konva from "konva";
import type { AuthUser } from "../App";
import { AI_USER_ID } from "@shared/types";
import type {
  BoardObject,
  BoardObjectProps,
  ChoreographyStep,
  GameMode,
  AIModel,
  TransientEffect,
  TransientEffectType,
  TroupeConfig,
  Persona,
} from "@shared/types";
import { findSnapTarget, computeConnectedLineGeometry, getEdgePoint } from "@shared/connection-geometry";
import { AI_MODELS } from "@shared/types";
import { TRANSFORMER_CONFIG } from "../constants";
import { useWebSocket } from "../hooks/useWebSocket";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { ConnectionToast } from "./ConnectionToast";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useAiObjectEffects } from "../hooks/useAiObjectEffects";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useDragSelection } from "../hooks/useDragSelection";
import { useThrottledCallback } from "../hooks/useThrottledCallback";
import { useConnectionIndex } from "../hooks/useConnectionIndex";
import { colors, toolCursors, getUserColor } from "../theme";
import { Toolbar, type ToolMode } from "./Toolbar";
import { Cursors } from "./Cursors";
import { AiCursor } from "./AiCursor";
import { ChatPanel } from "./ChatPanel";
import { CanvasPreview } from "./CanvasPreview";
import { OnboardModal } from "./OnboardModal";
import { ConfettiBurst } from "./ConfettiBurst";
import { WaveEffect, useWaveEffect, getWaveContainerClass, waveNeedsOverlay } from "./WaveEffect";
import { BoardGrid } from "./BoardGrid";
import { AudienceRow, getAudienceFigureXs, AUDIENCE_Y } from "./AudienceRow";
import { CanvasSpeechBubbles } from "./CanvasSpeechBubbles";
import { PerfOverlay } from "./PerfOverlay";
import { PostcardModal } from "./PostcardModal";
import { RecapOverlay } from "./RecapOverlay";
import { Button } from "./Button";
import { Select } from "./Select";
import { useIsMobile } from "../hooks/useIsMobile";
import type { UIMessage } from "ai";
import "../styles/animations.css";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const CURSOR_THROTTLE_MS = 33; // ~30fps

// Subtle gradient backgrounds per mood - opacity controlled by intensity (max 0.5)
const MOOD_GRADIENTS: Record<string, string> = {
  comedy: "linear-gradient(135deg, #FFF8E1 0%, #FFE082 100%)",
  noir: "linear-gradient(135deg, #1A1A2E 0%, #16213E 100%)",
  horror: "linear-gradient(135deg, #0D1B0E 0%, #1B3A1B 100%)",
  romance: "linear-gradient(135deg, #FFF0F5 0%, #FFE4E1 100%)",
  tension: "linear-gradient(135deg, #2D0000 0%, #4A1010 100%)",
  triumph: "linear-gradient(135deg, #FFD700 0%, #FFA500 100%)",
  chaos: "linear-gradient(135deg, #2E003E 0%, #4A0072 100%)",
};

// Mirror-div technique: find pixel coords of character at `position` inside a textarea
function getCaretPixelPos(textarea: HTMLTextAreaElement, position: number): { x: number; y: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  (
    [
      "fontSize",
      "fontFamily",
      "fontWeight",
      "letterSpacing",
      "lineHeight",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "boxSizing",
    ] as const
  ).forEach((p) => {
    div.style[p] = style[p];
  });
  div.style.position = "absolute";
  div.style.top = "-9999px";
  div.style.left = "0";
  div.style.width = textarea.offsetWidth + "px";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.overflow = "hidden";
  div.style.visibility = "hidden";
  const clampedPos = Math.min(position, textarea.value.length);
  div.textContent = textarea.value.substring(0, clampedPos);
  const span = document.createElement("span");
  span.textContent = "\u200b";
  div.appendChild(span);
  document.body.appendChild(div);
  try {
    const divRect = div.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    return { x: spanRect.left - divRect.left, y: spanRect.top - divRect.top - textarea.scrollTop };
  } finally {
    document.body.removeChild(div);
  }
}

// Interactive wrapper: binds drag/click/transform handlers to the shared BoardObjectRenderer
interface InteractiveBoardObjectProps {
  obj: BoardObject;
  hasAiGlow: boolean;
  setShapeRef: (id: string) => (node: Konva.Group | null) => void;
  onShapeClick: (e: KonvaEventObject<MouseEvent>, id: string) => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>, id: string) => void;
  onDragStart: (e: KonvaEventObject<DragEvent>, id: string) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>, id: string) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>, id: string) => void;
  onTransformEnd: (
    e: KonvaEventObject<Event>,
    obj: { id: string; type: string; width: number; height: number },
  ) => void;
  onDblClickEdit: (id: string) => void;
}

const InteractiveBoardObject = React.memo(function InteractiveBoardObject({
  obj,
  hasAiGlow,
  setShapeRef,
  onShapeClick,
  onContextMenu,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onDblClickEdit,
}: InteractiveBoardObjectProps) {
  const editable = obj.type === "sticky" || obj.type === "text" || obj.type === "frame";
  const groupProps = {
    ref: setShapeRef(obj.id),
    draggable: true as const,
    onClick: (e: KonvaEventObject<MouseEvent>) => onShapeClick(e, obj.id),
    onContextMenu: (e: KonvaEventObject<PointerEvent>) => onContextMenu(e, obj.id),
    onDragStart: (e: KonvaEventObject<DragEvent>) => onDragStart(e, obj.id),
    onDragMove: (e: KonvaEventObject<DragEvent>) => onDragMove(e, obj.id),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => onDragEnd(e, obj.id),
    onTransformEnd: (e: KonvaEventObject<Event>) => onTransformEnd(e, obj),
    ...(editable
      ? {
          onDblClick: (e: KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
            onDblClickEdit(obj.id);
          },
        }
      : {}),
  };
  return <BoardObjectRenderer obj={obj} groupProps={groupProps} aiGlow={hasAiGlow} interactive />;
});

// Tap-to-create popup: appears at single-tap position on empty canvas (mobile only)
function TapCreateMenu({
  screenX,
  screenY,
  onSelect,
  onDismiss,
}: {
  screenX: number;
  screenY: number;
  onSelect: (type: "sticky" | "text" | "person" | "rect" | "circle") => void;
  onDismiss: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: TouchEvent | MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Delay to avoid dismissing on the same tap that opened the menu
    const t = setTimeout(() => {
      document.addEventListener("touchstart", handle, { passive: true });
      document.addEventListener("mousedown", handle);
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener("touchstart", handle);
      document.removeEventListener("mousedown", handle);
    };
  }, [onDismiss]);

  const MENU_W = 260;
  const left = Math.max(8, Math.min(screenX - MENU_W / 2, window.innerWidth - MENU_W - 8));
  const top = screenY > window.innerHeight * 0.6 ? screenY - 76 : screenY + 12;

  const options: {
    type: "sticky" | "text" | "person" | "rect" | "circle";
    label: string;
    bg: string;
    radius: number;
  }[] = [
    { type: "sticky", label: "Sticky", bg: "#fbbf24", radius: 4 },
    { type: "text", label: "Text", bg: "#818cf8", radius: 4 },
    { type: "person", label: "Person", bg: "#4ade80", radius: 4 },
    { type: "rect", label: "Shape", bg: "#3b82f6", radius: 4 },
    { type: "circle", label: "Circle", bg: "#8b5cf6", radius: 50 },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 40,
        background: "rgba(22, 33, 62, 0.95)",
        border: "1px solid #334155",
        borderRadius: 12,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        gap: 4,
        padding: "8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.type}
          onTouchStart={(e) => {
            e.stopPropagation();
            onSelect(opt.type);
          }}
          onClick={() => onSelect(opt.type)}
          style={{
            minWidth: 44,
            minHeight: 52,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: 8,
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "0.6875rem",
            gap: 5,
            padding: "4px 6px",
          }}
        >
          <div style={{ width: 22, height: 22, background: opt.bg, borderRadius: opt.radius }} />
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Board({
  user,
  boardId,
  onLogout,
  onBack,
}: {
  user: AuthUser;
  boardId: string;
  onLogout: () => void;
  onBack: () => void;
}) {
  const isMobile = useIsMobile();
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  // Touch gesture state for pinch-to-zoom and single-finger pan
  const touchGestureRef = useRef<{
    pinching: boolean;
    lastDist: number;
    panningEmptyStage: boolean;
    panLastX: number;
    panLastY: number;
    tapStart: { x: number; y: number; time: number } | null;
    lastTapTime: number;
    lastThrottleTime: number;
  }>({
    pinching: false,
    lastDist: 0,
    panningEmptyStage: false,
    panLastX: 0,
    panLastY: 0,
    tapStart: null,
    lastTapTime: 0,
    lastThrottleTime: 0,
  });
  const [tapMenuPos, setTapMenuPos] = useState<{
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
  } | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const lastDragSendRef = useRef(0);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [chatOpen, setChatOpen] = useState(false);
  const [postcardOpen, setPostcardOpen] = useState(false);
  const [postcardSnapshot, setPostcardSnapshot] = useState("");
  const [recentChatMessages, setRecentChatMessages] = useState<UIMessage[]>([]);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>();
  const [chatInitialTemplateId, setChatInitialTemplateId] = useState<string | undefined>();
  const [boardGenStarted, setBoardGenStarted] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>("freeform");
  const [boardName, setBoardName] = useState<string>("");
  // Claude Haiku 4.5 default; sent on every message so server knows which provider to use
  const [aiModel, setAIModel] = useState<AIModel>("claude-haiku-4.5");
  // Per-player persona claim - set via OnboardModal or ChatPanel inline picker
  const [claimedPersonaId, setClaimedPersonaId] = useState<string | null>(null);
  // Troupe config from OnboardModal - passed to ChatPanel for first-message scene setup
  const [troupeConfig, setTroupeConfig] = useState<TroupeConfig | undefined>();
  // Custom board personas fetched from server (passed to OnboardModal wizard)
  // Initialize as undefined so OnboardModal's default {...DEFAULT_PERSONAS} takes effect before fetch completes
  const [personas, setPersonas] = useState<Persona[] | undefined>(undefined);

  // "Previously On..." recap narration (null = not ready or not available)
  const [recapNarration, setRecapNarration] = useState<string | null>(null);

  // Curtain call overlay: confetti burst positions + rating state
  const [curtainConfettis, setCurtainConfettis] = useState<Array<{ id: string; x: number; y: number }>>([]);
  const [curtainRating, setCurtainRating] = useState(0);
  const [curtainRatingHover, setCurtainRatingHover] = useState(0);
  const [curtainRatingSubmitted, setCurtainRatingSubmitted] = useState(false);

  // --- Ambient mood lighting state ---
  const [canvasMood, setCanvasMood] = useState<{ mood: string; intensity: number }>({ mood: "neutral", intensity: 0 });
  const onMoodReceived = useCallback((mood: string, intensity: number) => {
    setCanvasMood({ mood, intensity });
  }, []);

  // Hydrate game mode from D1 on mount (so returning users get the right mode)
  useEffect(() => {
    fetch(`/api/boards/${boardId}`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401) {
          onLogout();
          return null;
        } // session expired
        return r.ok ? (r.json() as Promise<{ game_mode?: string; name?: string }>) : null;
      })
      .then((data) => {
        if (data?.game_mode && ["yesand", "freeform", "harold"].includes(data.game_mode)) {
          setGameMode(data.game_mode as GameMode);
        }
        if (data?.name) setBoardName(data.name);
      })
      .catch((err) => {
        // Non-critical: board still usable at freeform default; log for debugging
        console.warn("[Board] Failed to fetch game mode, defaulting to freeform:", err);
      });
  }, [boardId, onLogout]);

  // Fetch custom personas for this board (passed to OnboardModal wizard)
  useEffect(() => {
    fetch(`/api/boards/${boardId}/personas`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data)) setPersonas(data);
      })
      .catch((err) => {
        // Non-critical: OnboardModal falls back to DEFAULT_PERSONAS
        console.warn("[Board] Failed to fetch personas:", err);
      });
  }, [boardId]);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objId: string } | null>(null);
  const trRef = useRef<Konva.Transformer>(null);
  // Captures the fixed endpoint (the one NOT being dragged) at drag start to avoid moving-reference issues
  const lineEndpointDragRef = useRef<{ fixedX: number; fixedY: number } | null>(null);
  // Snap target found during endpoint handle drag - ref for drag-end reads, state for indicator rendering
  const endpointSnapRef = useRef<{ objectId: string; snapPoint: { x: number; y: number } } | null>(null);
  const [endpointSnapPoint, setEndpointSnapPoint] = useState<{ x: number; y: number } | null>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());

  // Pending tweens from animated obj:update messages (id -> from/to positions+dimensions + duration)
  const pendingAnimRef = useRef<
    Map<
      string,
      {
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        fromWidth: number;
        fromHeight: number;
        toWidth: number;
        toHeight: number;
        durationMs: number;
      }
    >
  >(new Map());
  const onAnimatedUpdate = useCallback(
    (id: string, toX: number, toY: number, toWidth: number, toHeight: number, durationMs: number) => {
      const node = shapeRefs.current.get(id);
      // Skip if node missing or user is actively dragging this object
      if (!node || node.isDragging()) return;
      pendingAnimRef.current.set(id, {
        fromX: node.x(),
        fromY: node.y(),
        // node.width()/height() reflects pre-update React state at callback time (before setObjects)
        fromWidth: node.width(),
        fromHeight: node.height(),
        toX,
        toY,
        toWidth,
        toHeight,
        durationMs,
      });
    },
    [],
  );

  const onEffect = useCallback((id: string, effect: string) => {
    const node = shapeRefs.current.get(id);
    if (!node || node.isDragging()) return;
    // KEY-DECISION 2026-02-20: Skip effect if a position tween is pending for this node.
    // The pending tween will reset x/y (and therefore scale/opacity) mid-flight, making
    // the effect invisible and causing a visual glitch.
    if (pendingAnimRef.current.has(id)) return;

    if (effect === "pulse") {
      node.to({
        scaleX: 1.12,
        scaleY: 1.12,
        duration: 0.12,
        onFinish: () => node.to({ scaleX: 1, scaleY: 1, duration: 0.12 }),
      });
    } else if (effect === "shake") {
      const origX = node.x();
      node.to({
        x: origX + 8,
        duration: 0.05,
        onFinish: () =>
          node.to({
            x: origX - 8,
            duration: 0.1,
            onFinish: () =>
              node.to({
                x: origX + 6,
                duration: 0.1,
                onFinish: () =>
                  node.to({ x: origX - 6, duration: 0.1, onFinish: () => node.to({ x: origX, duration: 0.05 }) }),
              }),
          }),
      });
    } else if (effect === "flash") {
      node.to({
        opacity: 0.2,
        duration: 0.1,
        onFinish: () => node.to({ opacity: 1, duration: 0.15 }),
      });
    }
  }, []);

  // KEY-DECISION 2026-02-20: patchObjectLocalRef lets onSequence (defined before useWebSocket)
  // update React state after animations complete. Ref is updated each render so setTimeout
  // callbacks always get the latest function reference.
  const patchObjectLocalRef = useRef<((id: string, patch: Partial<BoardObject>) => void) | null>(null);

  const onSequence = useCallback(
    (steps: ChoreographyStep[]) => {
      for (const step of steps) {
        setTimeout(() => {
          const node = shapeRefs.current.get(step.objectId);
          if (!node || node.isDragging()) return;
          if (step.action === "move" && step.x !== undefined && step.y !== undefined) {
            node.to({ x: step.x, y: step.y, duration: 0.4, easing: Konva.Easings.EaseInOut });
          } else if (step.action === "effect" && step.effect) {
            onEffect(step.objectId, step.effect);
          }
        }, step.delayMs);
      }
      // After all tweens finish, sync React state so positions match DO Storage
      const maxDelay = steps.length > 0 ? Math.max(...steps.map((s) => s.delayMs)) + 600 : 600;
      setTimeout(() => {
        for (const step of steps) {
          if (step.action === "move" && step.x !== undefined && step.y !== undefined) {
            patchObjectLocalRef.current?.(step.objectId, { x: step.x, y: step.y });
          }
        }
      }, maxDelay);
    },
    [onEffect],
  );

  // --- Spotlight & Blackout state ---
  // KEY-DECISION 2026-02-20: Each spotlight trigger gets a unique id so useEffect re-fires
  // even when spotlight hits the same position twice in a row.
  const [spotlightState, setSpotlightState] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [blackoutActive, setBlackoutActive] = useState(false);
  const spotlightLayerRef = useRef<Konva.Layer>(null);
  const blackoutLayerRef = useRef<Konva.Layer>(null);
  const spotlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blackoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate spotlight layer in, hold 5s, fade out
  useEffect(() => {
    if (!spotlightState) return;
    const layer = spotlightLayerRef.current;
    if (!layer) return;
    if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
    layer.opacity(0);
    layer.to({ opacity: 1, duration: 0.3 });
    spotlightTimerRef.current = setTimeout(() => {
      layer.to({ opacity: 0, duration: 0.3, onFinish: () => setSpotlightState(null) });
    }, 5000);
    return () => {
      if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
    };
  }, [spotlightState?.id]);

  // Animate blackout: fade in (0.5s) → hold 1.5s → fade out (0.5s) → remove
  useEffect(() => {
    if (!blackoutActive) return;
    const layer = blackoutLayerRef.current;
    if (!layer) return;
    if (blackoutTimerRef.current) clearTimeout(blackoutTimerRef.current);
    layer.opacity(0);
    layer.to({
      opacity: 1,
      duration: 0.5,
      onFinish: () => {
        blackoutTimerRef.current = setTimeout(() => {
          layer.to({ opacity: 0, duration: 0.5, onFinish: () => setBlackoutActive(false) });
        }, 1500);
      },
    });
    return () => {
      if (blackoutTimerRef.current) clearTimeout(blackoutTimerRef.current);
    };
  }, [blackoutActive]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (spotlightTimerRef.current) clearTimeout(spotlightTimerRef.current);
      if (blackoutTimerRef.current) clearTimeout(blackoutTimerRef.current);
    };
  }, []);

  const onSpotlight = useCallback((objectId?: string, x?: number, y?: number) => {
    let spotX = x ?? 600;
    let spotY = y ?? 420;
    if (objectId) {
      const obj = objectsRef.current.get(objectId);
      if (obj) {
        spotX = obj.x + obj.width / 2;
        spotY = obj.y + obj.height / 2;
      }
    }
    setSpotlightState({ x: spotX, y: spotY, id: crypto.randomUUID() });
  }, []);

  const onBlackout = useCallback(() => {
    setBlackoutActive(true);
  }, []);

  // Object fade-in animation tracking
  const wasInitializedRef = useRef(false);
  useEffect(() => {
    wasInitializedRef.current = initialized;
  });
  const animatedIdsRef = useRef(new Set<string>());

  // Frame drag-to-create state
  const [frameDraft, setFrameDraft] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const frameDraftRef = useRef(frameDraft);
  frameDraftRef.current = frameDraft;
  const [pendingFrame, setPendingFrame] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const pendingFrameCancelled = useRef(false);

  // Click-or-drag creation state
  const drawStartRef = useRef<{
    x: number;
    y: number;
    toolMode: ToolMode;
    time: number;
    startObjectId?: string; // connector: snapped source object
    startSnapPoint?: { x: number; y: number }; // connector: snapped edge point
  } | null>(null);
  const [shapeDraft, setShapeDraft] = useState<{
    toolMode: ToolMode;
    x: number;
    y: number;
    width: number;
    height: number;
    startObjectId?: string;
    snapTarget?: { objectId: string; snapPoint: { x: number; y: number } };
  } | null>(null);
  const shapeDraftRef = useRef(shapeDraft);
  shapeDraftRef.current = shapeDraft;

  // Bulk drag state
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // --- SFX visual burst state (must be before useWebSocket which references the callback) ---
  const [sfxBursts, setSfxBursts] = useState<Array<{ id: string; emoji: string; label: string; x: number; y: number }>>(
    [],
  );
  const onSfxReceived = useCallback((effect: string, emoji: string, label: string, x: number, y: number) => {
    const burstId = `${effect}-${Date.now()}`;
    setSfxBursts((prev) => [...prev, { id: burstId, emoji, label, x, y }]);
    setTimeout(() => setSfxBursts((prev) => prev.filter((b) => b.id !== burstId)), 1800);
  }, []);

  // --- Transient visual effects from AI (sparkle, poof, explosion, highlight) ---
  const [transientEffects, setTransientEffects] = useState<
    Array<{ id: string; effectType: TransientEffectType; x: number; y: number; duration: number }>
  >([]);
  const onTransientEffect = useCallback((effect: TransientEffect) => {
    const id = `transient-${Date.now()}-${Math.random()}`;
    setTransientEffects((prev) => [
      ...prev,
      { id, effectType: effect.type, x: effect.x, y: effect.y, duration: effect.duration },
    ]);
    setTimeout(() => setTransientEffects((prev) => prev.filter((e) => e.id !== id)), effect.duration);
  }, []);

  const {
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
    createObject: wsCreate,
    updateObject: wsUpdate,
    deleteObject: wsDelete,
    patchObjectLocal,
    batchUndo,
    lastServerMessageAt,
  } = useWebSocket(
    boardId,
    onAnimatedUpdate,
    onEffect,
    onSequence,
    onSpotlight,
    onBlackout,
    onSfxReceived,
    onTransientEffect,
    onMoodReceived,
  );

  const handleSfxSend = useCallback(
    (effectId: string) => {
      // Send at canvas center (adjusted for pan/zoom)
      const cx = (window.innerWidth / 2 - stagePosRef.current.x) / scaleRef.current;
      const cy = (window.innerHeight / 2 - stagePosRef.current.y) / scaleRef.current;
      send({ type: "sfx", effect: effectId, x: cx, y: cy });
    },
    [send],
  );
  // Keep ref current so onSequence's setTimeout callbacks always use the latest patchObjectLocal
  patchObjectLocalRef.current = patchObjectLocal;

  // Apply pending tweens after each React commit (before browser paint) to avoid visual snap.
  // Sequence: WS fires callback (captures fromX/Y/W/H) -> state update snaps Konva node ->
  // useLayoutEffect resets to from values and starts tween -> browser paints at old pos smoothly.
  useLayoutEffect(() => {
    if (pendingAnimRef.current.size === 0) return;
    for (const [id, anim] of pendingAnimRef.current) {
      const node = shapeRefs.current.get(id);
      if (node && !node.isDragging()) {
        node.x(anim.fromX);
        node.y(anim.fromY);
        node.width(anim.fromWidth);
        node.height(anim.fromHeight);
        node.to({
          x: anim.toX,
          y: anim.toY,
          width: anim.toWidth,
          height: anim.toHeight,
          duration: anim.durationMs / 1000,
          easing: Konva.Easings.EaseInOut,
        });
      }
    }
    pendingAnimRef.current.clear();
  });

  const connectionIndex = useConnectionIndex(objects);
  const connectionIndexRef = useRef(connectionIndex);
  connectionIndexRef.current = connectionIndex;

  const sendCursorThrottled = useThrottledCallback(
    (x: number, y: number) => send({ type: "cursor", x, y }),
    CURSOR_THROTTLE_MS,
  );

  const { createObject, updateObject, deleteObject, startBatch, commitBatch, undo, redo, pushExternalBatch, topTag } =
    useUndoRedo(objects, wsCreate, wsUpdate, wsDelete);
  const { aiGlowIds, confettiPos, confettiKey, clearConfetti, aiCursorTarget } = useAiObjectEffects(
    objects,
    initialized,
    scale,
    stagePos,
    size,
  );
  const { activeWave, dismissWave } = useWaveEffect(audienceWave, clearAudienceWave);

  // Stable refs to avoid recreating callbacks on every state change
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  // "Previously On..." recap: fetch once per hour after WS init, show if available
  useEffect(() => {
    if (!initialized) return;
    const seenKey = `recap-seen-${boardId}`;
    const seenAt = parseInt(localStorage.getItem(seenKey) ?? "0", 10);
    // KEY-DECISION 2026-02-20: 1-hour TTL so returning users get a recap after stepping away,
    // but rapid board switches don't spam them. Server handles the "enough history" gate.
    if (seenAt > Date.now() - 60 * 60 * 1000) return;
    fetch(`/api/boards/${boardId}/recap`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean; narration?: string }>) : null))
      .then((data) => {
        if (data?.available && data.narration) setRecapNarration(data.narration);
      })
      .catch(() => {}); // non-critical: fail silently, no recap shown
  }, [boardId, initialized]);

  // Curtain call: fire confetti across viewport + reset rating state when a new curtain_call arrives
  useEffect(() => {
    if (!curtainCall) return;
    // Reset rating form state
    setCurtainRating(0);
    setCurtainRatingHover(0);
    setCurtainRatingSubmitted(false);
    // Fire confetti at 5 spread positions across the viewport
    const w = window.innerWidth;
    const h = window.innerHeight;
    setCurtainConfettis([
      { id: crypto.randomUUID(), x: w * 0.15, y: h * 0.3 },
      { id: crypto.randomUUID(), x: w * 0.4, y: h * 0.2 },
      { id: crypto.randomUUID(), x: w * 0.6, y: h * 0.15 },
      { id: crypto.randomUUID(), x: w * 0.8, y: h * 0.3 },
      { id: crypto.randomUUID(), x: w * 0.5, y: h * 0.5 },
    ]);
    // Auto-dismiss after 15 seconds
    const t = setTimeout(clearCurtainCall, 15000);
    return () => clearTimeout(t);
  }, [curtainCall, clearCurtainCall]);

  // Auto-dismiss poll result banner after 8s (players get less context than spectators)
  useEffect(() => {
    if (!pollResult) return;
    const t = setTimeout(clearPollResult, 8000);
    return () => clearTimeout(t);
  }, [pollResult, clearPollResult]);

  // --- AI Batch Undo state ---
  const [undoAiBatchId, setUndoAiBatchId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const undoAiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedBatchIds = useRef(new Set<string>());

  /** Send chat:bubble WS event so spectators see performer dialogue as a canvas speech bubble */
  const handleChatSend = useCallback(
    (text: string) => {
      send({ type: "chat:bubble", text });
    },
    [send],
  );

  /** Called when ChatPanel AI response completes - find batch objects and register for undo */
  const handleAIComplete = useCallback(() => {
    const currentObjects = objectsRef.current;
    // Find the most recent batchId among all objects
    let latestBatchId: string | null = null;
    let latestUpdatedAt = 0;
    for (const [, obj] of currentObjects) {
      if (obj.batchId && obj.updatedAt > latestUpdatedAt) {
        latestUpdatedAt = obj.updatedAt;
        latestBatchId = obj.batchId;
      }
    }
    if (!latestBatchId) return;
    // Skip if this batch was already processed (AI responded with text only, no new objects)
    if (processedBatchIds.current.has(latestBatchId)) return;
    processedBatchIds.current.add(latestBatchId);

    // Collect all objects in this batch
    const batchObjects: BoardObject[] = [];
    for (const [, obj] of currentObjects) {
      if (obj.batchId === latestBatchId) batchObjects.push(obj);
    }
    if (batchObjects.length === 0) return;

    // Push to undo stack so Cmd+Z undoes the whole batch
    pushExternalBatch(batchObjects, latestBatchId);

    // Show the "Undo AI" button
    setUndoAiBatchId(latestBatchId);
    if (undoAiTimerRef.current) clearTimeout(undoAiTimerRef.current);
    undoAiTimerRef.current = setTimeout(() => setUndoAiBatchId(null), 30000);
  }, [pushExternalBatch]);

  /** Capture Konva stage snapshot and open PostcardModal */
  const handleOpenPostcard = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // KEY-DECISION 2026-02-20: toDataURL at pixelRatio:2 gives retina-quality snapshot without
    // changing the visible canvas; the offscreen compositing canvas handles final 1200x630 resize.
    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    setPostcardSnapshot(dataUrl);
    setPostcardOpen(true);
  }, []);

  /** Handle "Undo AI" button click */
  const handleUndoAiBatch = useCallback(() => {
    if (!undoAiBatchId) return;

    // If the AI batch is the top of the undo stack, use the stack (supports redo)
    if (topTag() === undoAiBatchId) {
      undo();
    } else {
      // Targeted deletion: batch-delete all objects with this batchId via WS
      batchUndo(undoAiBatchId);
    }

    setUndoAiBatchId(null);
    if (undoAiTimerRef.current) clearTimeout(undoAiTimerRef.current);
  }, [undoAiBatchId, topTag, undo, batchUndo]);

  // Cleanup undo AI timer on unmount
  useEffect(() => {
    return () => {
      if (undoAiTimerRef.current) clearTimeout(undoAiTimerRef.current);
    };
  }, []);
  const stagePosRef = useRef(stagePos);
  stagePosRef.current = stagePos;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const [editingId, setEditingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const clipboardRef = useRef<BoardObject[]>([]);

  // True when all selected objects are circles - drives proportional resize in Transformer
  const circleOnlySelected = useMemo(
    () => selectedIds.size > 0 && [...selectedIds].every((id) => objects.get(id)?.type === "circle"),
    [selectedIds, objects],
  );

  // Single selected line: drives endpoint-handle UX instead of Transformer bounding box
  const selectedLineObj = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const [id] = selectedIds;
    const obj = objects.get(id);
    return obj?.type === "line" ? obj : null;
  }, [selectedIds, objects]);

  // Marquee selection (extracted to useDragSelection)
  const { marquee, justFinishedMarqueeRef, startMarquee, updateMarquee, finishMarquee } = useDragSelection({
    objectsRef,
    setSelectedIds,
  });

  // Shared helper: batch-delete all selected objects
  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const isBatch = selectedIds.size > 1;
    if (isBatch) startBatch();
    try {
      for (const id of selectedIds) deleteObject(id);
      setSelectedIds(new Set());
    } finally {
      if (isBatch) commitBatch();
    }
  }, [selectedIds, deleteObject, startBatch, commitBatch]);

  // Shared: create offset copies of items, wrap in a batch if >1, select the new set
  const placeItems = useCallback(
    (items: BoardObject[]) => {
      if (items.length === 0) return;
      const isBatch = items.length > 1;
      if (isBatch) startBatch();
      const newIds = new Set<string>();
      try {
        for (const item of items) {
          const id = crypto.randomUUID();
          newIds.add(id);
          createObject({
            ...item,
            id,
            x: item.x + 20,
            y: item.y + 20,
            props: { ...item.props },
            createdBy: user.id,
            updatedAt: Date.now(),
          } as BoardObject);
        }
      } finally {
        if (isBatch) commitBatch();
      }
      setSelectedIds(newIds);
    },
    [createObject, startBatch, commitBatch, user.id],
  );

  // Copy selected objects to in-memory clipboard
  const copySelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const copied: BoardObject[] = [];
    for (const id of selectedIds) {
      const obj = objectsRef.current.get(id);
      if (obj) copied.push({ ...obj, props: { ...obj.props } } as BoardObject);
    }
    clipboardRef.current = copied;
  }, [selectedIds]);

  // Paste clipboard objects with 20px offset, new UUIDs, select the pasted set
  const pasteClipboard = useCallback(() => {
    const items = clipboardRef.current;
    if (items.length === 0) return;
    placeItems(items);
    // Advance clipboard positions so repeated pastes cascade
    clipboardRef.current = items.map(
      (item) =>
        ({
          ...item,
          x: item.x + 20,
          y: item.y + 20,
          props: { ...item.props },
        }) as BoardObject,
    );
  }, [placeItems]);

  // Duplicate selected objects with 20px offset without touching the clipboard
  const duplicateSelected = useCallback(() => {
    const items: BoardObject[] = [];
    for (const id of selectedIds) {
      const obj = objectsRef.current.get(id);
      if (obj) items.push({ ...obj, props: { ...obj.props } } as BoardObject);
    }
    placeItems(items);
  }, [selectedIds, placeItems]);

  // Apply a color to all selected objects (used by Toolbar color picker)
  const handleColorChange = useCallback(
    (color: string) => {
      const isBatch = selectedIds.size > 1;
      if (isBatch) startBatch();
      try {
        for (const id of selectedIds) {
          const obj = objects.get(id);
          if (!obj) continue;
          const key = obj.type === "sticky" || obj.type === "text" ? "color" : obj.type === "line" ? "stroke" : "fill";
          updateObject({ id, props: { [key]: color } as BoardObjectProps });
        }
      } finally {
        if (isBatch) commitBatch();
      }
    },
    [selectedIds, objects, updateObject, startBatch, commitBatch],
  );

  // Apply arrow style to all selected line objects
  const handleArrowStyleChange = useCallback(
    (style: "none" | "end" | "both") => {
      const isBatch = selectedIds.size > 1;
      if (isBatch) startBatch();
      try {
        for (const id of selectedIds) {
          const obj = objects.get(id);
          if (!obj || obj.type !== "line") continue;
          updateObject({ id, props: { arrow: style } as BoardObjectProps });
        }
      } finally {
        if (isBatch) commitBatch();
      }
    },
    [selectedIds, objects, updateObject, startBatch, commitBatch],
  );

  // Clear selection if objects were deleted (by another user or AI)
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => objects.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [objects]);

  // Clear selection when switching away from select mode
  useEffect(() => {
    if (toolMode !== "select") setSelectedIds(new Set());
  }, [toolMode]);

  // Resize handler
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // KEY-DECISION 2026-02-20: Non-passive touchmove on the stage container prevents browser
  // default pinch-zoom/scroll during gestures. React 17+ registers touch events passively,
  // so calling e.evt.preventDefault() in Konva handlers is a no-op - native listener required.
  useEffect(() => {
    if (!isMobile) return;
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container();
    const onTouchMove = (e: TouchEvent) => {
      const ts = touchGestureRef.current;
      if (ts.pinching || ts.panningEmptyStage || e.touches.length >= 2) {
        e.preventDefault();
      }
    };
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => container.removeEventListener("touchmove", onTouchMove);
  }, [isMobile]);

  // Keyboard shortcuts for tool switching + delete
  useKeyboardShortcuts({
    selectedIds,
    editingId,
    setSelectedIds,
    setToolMode,
    setChatOpen,
    setShowShortcuts,
    deleteSelected,
    copySelected,
    pasteClipboard,
    duplicateSelected,
    undo,
    redo,
  });

  // Sync Transformer with selected nodes
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (selectedIds.size > 0 && !editingId) {
      // KEY-DECISION 2026-02-20: Lines use endpoint-handle UX, not Transformer bounding box.
      // Exclude all lines so the Transformer doesn't show rotation/scale anchors on line selections.
      const nodes = [...selectedIds]
        .filter((id) => objectsRef.current.get(id)?.type !== "line")
        .map((id) => shapeRefs.current.get(id))
        .filter((n): n is Konva.Group => !!n);
      if (nodes.length > 0) {
        tr.nodes(nodes);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, editingId, objects]);

  // Right-click context menu handler
  const handleShapeContextMenu = useCallback((e: KonvaEventObject<PointerEvent>, id: string) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, objId: id });
  }, []);

  // Open chat with a prefilled prompt (from context menu)
  const openChatWithPrompt = useCallback((prompt: string) => {
    setContextMenu(null);
    setChatInitialPrompt(prompt);
    setChatOpen(true);
  }, []);

  // Shared click handler for all shapes (supports shift+click multi-select)
  const handleShapeClick = useCallback((e: KonvaEventObject<MouseEvent>, id: string) => {
    e.cancelBubble = true;
    if (e.evt.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  }, []);

  // Helper: recalculate all connected lines for a set of moved object IDs.
  // Returns array of { lineId, geo } patches. Reads from Konva nodes (for in-drag) or objects map.
  const getConnectedLineUpdates = useCallback(
    (movedIds: Set<string>): { lineId: string; geo: { x: number; y: number; width: number; height: number } }[] => {
      const updates: { lineId: string; geo: { x: number; y: number; width: number; height: number } }[] = [];
      const seenLines = new Set<string>();

      // Get current position from Konva node (if being dragged) or state
      const getObjBounds = (obj: BoardObject) => {
        const node = shapeRefs.current.get(obj.id);
        if (node) {
          return {
            x: node.x(),
            y: node.y(),
            width: obj.width,
            height: obj.height,
            rotation: obj.rotation,
            type: obj.type,
          };
        }
        return { x: obj.x, y: obj.y, width: obj.width, height: obj.height, rotation: obj.rotation, type: obj.type };
      };

      for (const movedId of movedIds) {
        const lineIds = connectionIndexRef.current.get(movedId);
        if (!lineIds) continue;
        for (const lineId of lineIds) {
          if (seenLines.has(lineId)) continue;
          seenLines.add(lineId);
          const line = objectsRef.current.get(lineId);
          if (!line) continue;
          const startObj = line.startObjectId ? objectsRef.current.get(line.startObjectId) : null;
          const endObj = line.endObjectId ? objectsRef.current.get(line.endObjectId) : null;
          if (!startObj && !endObj) continue;

          if (startObj && endObj) {
            const geo = computeConnectedLineGeometry(getObjBounds(startObj), getObjBounds(endObj));
            updates.push({ lineId, geo });
          } else if (startObj) {
            // Only start connected - recalc start edge, keep end fixed
            const bounds = getObjBounds(startObj);
            const endX = line.x + line.width;
            const endY = line.y + line.height;
            const start = getEdgePoint(bounds, endX, endY);
            updates.push({ lineId, geo: { x: start.x, y: start.y, width: endX - start.x, height: endY - start.y } });
          } else if (endObj) {
            // Only end connected - recalc end edge, keep start fixed
            const bounds = getObjBounds(endObj);
            const end = getEdgePoint(bounds, line.x, line.y);
            updates.push({ lineId, geo: { x: line.x, y: line.y, width: end.x - line.x, height: end.y - line.y } });
          }
        }
      }
      return updates;
    },
    [],
  );

  // Bulk drag handlers (reads selectedIds from ref for stability)
  const handleShapeDragStart = useCallback((_e: KonvaEventObject<DragEvent>, id: string) => {
    const node = shapeRefs.current.get(id);
    if (node) node.moveToTop();

    const sel = selectedIdsRef.current;
    if (sel.has(id) && sel.size > 1) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const sid of sel) {
        const node = shapeRefs.current.get(sid);
        if (node) positions.set(sid, { x: node.x(), y: node.y() });
      }
      dragStartPositionsRef.current = positions;
    } else {
      dragStartPositionsRef.current = new Map();
    }
  }, []);

  const handleShapeDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>, id: string) => {
      const positions = dragStartPositionsRef.current;

      // Multi-select: move companion nodes visually
      if (positions.size > 0) {
        const startPos = positions.get(id);
        if (startPos) {
          const dx = e.target.x() - startPos.x;
          const dy = e.target.y() - startPos.y;
          for (const [sid, spos] of positions) {
            if (sid === id) continue;
            const node = shapeRefs.current.get(sid);
            if (node) {
              node.x(spos.x + dx);
              node.y(spos.y + dy);
            }
          }
        }
      }

      // Update connected lines visually (local only, no WS yet)
      const movedIds = positions.size > 0 ? new Set(positions.keys()) : new Set([id]);
      const lineUpdates = getConnectedLineUpdates(movedIds);
      for (const { lineId, geo } of lineUpdates) {
        patchObjectLocal(lineId, geo);
      }

      // Throttled WS send for real-time multiplayer + replay recording
      const now = Date.now();
      if (now - lastDragSendRef.current < 100) return;
      lastDragSendRef.current = now;

      // Send primary dragged object position
      send({ type: "obj:update", obj: { id, x: e.target.x(), y: e.target.y(), updatedAt: now } });

      // Send companion objects in multi-select
      if (positions.size > 0) {
        for (const [sid] of positions) {
          if (sid === id) continue;
          const node = shapeRefs.current.get(sid);
          if (node) {
            send({ type: "obj:update", obj: { id: sid, x: node.x(), y: node.y(), updatedAt: now } });
          }
        }
      }

      // Send connected line updates to remote
      for (const { lineId, geo } of lineUpdates) {
        send({ type: "obj:update", obj: { id: lineId, ...geo, updatedAt: now } });
      }
    },
    [send, getConnectedLineUpdates, patchObjectLocal],
  );

  const handleShapeDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>, id: string) => {
      const positions = dragStartPositionsRef.current;
      const movedIds = positions.size > 0 ? new Set(positions.keys()) : new Set([id]);
      const lineUpdates = getConnectedLineUpdates(movedIds);
      const needsBatch = positions.size > 0 || lineUpdates.length > 0;

      if (needsBatch) startBatch();
      try {
        if (positions.size > 0) {
          for (const sid of positions.keys()) {
            const node = shapeRefs.current.get(sid);
            if (node) {
              updateObject({ id: sid, x: node.x(), y: node.y() });
            }
          }
          dragStartPositionsRef.current = new Map();
        } else {
          updateObject({ id, x: e.target.x(), y: e.target.y() });
        }
        // Commit connected line positions
        for (const { lineId, geo } of lineUpdates) {
          updateObject({ id: lineId, ...geo });
        }
      } finally {
        if (needsBatch) commitBatch();
      }
    },
    [updateObject, startBatch, commitBatch, getConnectedLineUpdates],
  );

  // Track mouse for cursor sync + marquee (reads stagePos/scale from refs for stability)
  const handleMouseMove = useCallback(
    (_e: KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
      const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;

      // Update marquee if dragging
      updateMarquee(worldX, worldY);

      // Cursor sync (throttled via useThrottledCallback)
      sendCursorThrottled(worldX, worldY);
    },
    [sendCursorThrottled, updateMarquee],
  );

  // Stage mousedown: marquee (select), frame draft, or shape/connector draw start
  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Dismiss "Undo AI" button on any canvas interaction
      setUndoAiBatchId(null);
      if (e.target !== stageRef.current) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
      const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;

      if (toolMode === "spotlight") {
        // Spotlight mode: send spotlight WS message at clicked position, return to select
        send({ type: "spotlight", x: worldX, y: worldY });
        setToolMode("select");
        return;
      } else if (toolMode === "select") {
        startMarquee(worldX, worldY);
      } else if (toolMode === "frame") {
        setFrameDraft({ startX: worldX, startY: worldY, x: worldX, y: worldY, width: 0, height: 0 });
      } else {
        // Shape/connector draw start
        const ds: NonNullable<typeof drawStartRef.current> = {
          x: worldX,
          y: worldY,
          toolMode,
          time: Date.now(),
        };
        // Connector: check for snap at start point
        if (toolMode === "connector") {
          const snap = findSnapTarget(worldX, worldY, objectsRef.current.values());
          if (snap) {
            ds.startObjectId = snap.objectId;
            ds.startSnapPoint = snap.snapPoint;
          }
        }
        drawStartRef.current = ds;
      }
    },
    [toolMode, startMarquee, send],
  );

  // Stage mouseup: finish marquee, frame draft, or shape/connector creation
  const handleStageMouseUp = useCallback(() => {
    // Marquee selection finish
    if (finishMarquee()) return;

    // Frame creation finish
    if (frameDraftRef.current) {
      const fd = frameDraftRef.current;
      if (fd.width >= 20 && fd.height >= 20) {
        setPendingFrame({ x: fd.x, y: fd.y, width: fd.width, height: fd.height });
      }
      setFrameDraft(null);
      return;
    }

    // Shape/connector creation finish
    const ds = drawStartRef.current;
    if (!ds) return;
    drawStartRef.current = null;

    const draft = shapeDraftRef.current;
    setShapeDraft(null);
    setSelectedIds(new Set());

    // KEY-DECISION 2026-02-19: Use Math.abs() because connectors store signed deltas
    // (negative width/height when dragging left/up). Without abs, left/up drags fall
    // through to the click branch and create unconnected default-size lines.
    if (draft && (Math.abs(draft.width) > 5 || Math.abs(draft.height) > 5)) {
      // User dragged - commit with draft dimensions
      if (draft.toolMode === "connector") {
        const lineObj: BoardObject = {
          id: crypto.randomUUID(),
          type: "line",
          x: draft.x,
          y: draft.y,
          width: draft.width,
          height: draft.height,
          rotation: 0,
          props: { stroke: "#94a3b8", arrow: "end" },
          createdBy: user.id,
          updatedAt: Date.now(),
          startObjectId: ds.startObjectId,
          // Guard: prevent self-referential connections (same object at both ends)
          endObjectId:
            draft.snapTarget?.objectId && draft.snapTarget.objectId !== ds.startObjectId
              ? draft.snapTarget.objectId
              : undefined,
        };
        createObject(lineObj);
      } else if (draft.toolMode === "sticky") {
        createObject({
          id: crypto.randomUUID(),
          type: "sticky",
          x: draft.x,
          y: draft.y,
          width: Math.max(20, draft.width),
          height: Math.max(20, draft.height),
          rotation: 0,
          props: { text: "", color: "#fbbf24" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (draft.toolMode === "rect") {
        createObject({
          id: crypto.randomUUID(),
          type: "rect",
          x: draft.x,
          y: draft.y,
          width: Math.max(20, draft.width),
          height: Math.max(20, draft.height),
          rotation: 0,
          props: { fill: "#3b82f6", stroke: "#2563eb" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (draft.toolMode === "circle") {
        createObject({
          id: crypto.randomUUID(),
          type: "circle",
          x: draft.x,
          y: draft.y,
          width: Math.max(20, draft.width),
          height: Math.max(20, draft.height),
          rotation: 0,
          props: { fill: "#8b5cf6", stroke: "#7c3aed" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (draft.toolMode === "text") {
        const id = crypto.randomUUID();
        createObject({
          id,
          type: "text",
          x: draft.x,
          y: draft.y,
          width: Math.max(20, draft.width),
          height: Math.max(20, draft.height),
          rotation: 0,
          props: { text: "", color: "#ffffff" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
        setEditingId(id);
      }
    } else {
      // User clicked (no significant drag) - create default size
      const cx = ds.x;
      const cy = ds.y;

      if (ds.toolMode === "sticky") {
        createObject({
          id: crypto.randomUUID(),
          type: "sticky",
          x: cx - 100,
          y: cy - 100,
          width: 200,
          height: 200,
          rotation: 0,
          props: { text: "", color: "#fbbf24" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (ds.toolMode === "rect") {
        createObject({
          id: crypto.randomUUID(),
          type: "rect",
          x: cx - 75,
          y: cy - 50,
          width: 150,
          height: 100,
          rotation: 0,
          props: { fill: "#3b82f6", stroke: "#2563eb" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (ds.toolMode === "circle") {
        createObject({
          id: crypto.randomUUID(),
          type: "circle",
          x: cx - 50,
          y: cy - 50,
          width: 100,
          height: 100,
          rotation: 0,
          props: { fill: "#8b5cf6", stroke: "#7c3aed" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (ds.toolMode === "connector") {
        // Use snap point as start if click landed on/near an object; otherwise center on click
        const lineStartX = ds.startSnapPoint?.x ?? cx - 100;
        const lineStartY = ds.startSnapPoint?.y ?? cy;
        createObject({
          id: crypto.randomUUID(),
          type: "line",
          x: lineStartX,
          y: lineStartY,
          width: 200,
          height: 0,
          rotation: 0,
          props: { stroke: "#94a3b8", arrow: "end" },
          createdBy: user.id,
          updatedAt: Date.now(),
          startObjectId: ds.startObjectId,
        });
      } else if (ds.toolMode === "text") {
        const id = crypto.randomUUID();
        createObject({
          id,
          type: "text",
          x: cx,
          y: cy,
          width: 200,
          height: 40,
          rotation: 0,
          props: { text: "", color: "#ffffff" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
        setEditingId(id);
      } else if (ds.toolMode === "person") {
        // KEY-DECISION 2026-02-20: window.prompt for name entry - synchronous, no extra state,
        // Cancel (null) aborts creation so user can reposition before naming.
        const name = window.prompt("Character name:");
        if (name !== null) {
          createObject({
            id: crypto.randomUUID(),
            type: "person",
            x: cx - 30,
            y: cy - 60,
            width: 60,
            height: 120,
            rotation: 0,
            props: { text: name || "Character", color: getUserColor(user.id) },
            createdBy: user.id,
            updatedAt: Date.now(),
          });
          setToolMode("select");
        }
      }
    }
  }, [finishMarquee, createObject, user.id]);

  // Wheel: ctrl/meta+scroll (or pinch) = zoom toward cursor, plain scroll = pan
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Zoom toward cursor (pinch gestures fire as ctrl+wheel in browsers)
      const oldScale = scaleRef.current;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const factor = 1.08;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, direction > 0 ? oldScale * factor : oldScale / factor));

      const mousePointTo = {
        x: (pointer.x - stagePosRef.current.x) / oldScale,
        y: (pointer.y - stagePosRef.current.y) / oldScale,
      };

      setScale(newScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      });
    } else {
      // Pan - works in all modes including select
      setStagePos({
        x: stagePosRef.current.x - e.evt.deltaX,
        y: stagePosRef.current.y - e.evt.deltaY,
      });
    }
  }, []);

  // Stage drag-end handler removed: Stage is no longer draggable (draggable={false}).
  // Canvas panning uses scroll-wheel only (handleWheel). Shape creation owns mousedown/mouseup.

  // Handle object transform (resize + rotate) - shared by all object types
  const handleObjectTransform = useCallback(
    (e: KonvaEventObject<Event>, obj: { id: string; type: string; width: number; height: number }) => {
      const node = e.target;
      const sx = node.scaleX();
      const sy = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      // Lines store endpoint delta in width/height - don't clamp to min 20
      const isLine = obj.type === "line";
      let newWidth = isLine ? Math.round(obj.width * sx) : Math.max(20, Math.round(obj.width * sx));
      let newHeight = isLine ? Math.round(obj.height * sy) : Math.max(20, Math.round(obj.height * sy));
      // Circles must stay circular: keepRatio on Transformer handles visual, this guards stored data
      if (obj.type === "circle") {
        const size = Math.max(newWidth, newHeight);
        newWidth = size;
        newHeight = size;
      }

      // Check if connected lines need updating
      const lineUpdates = getConnectedLineUpdates(new Set([obj.id]));
      const needsBatch = lineUpdates.length > 0;

      if (needsBatch) startBatch();
      try {
        updateObject({
          id: obj.id,
          x: node.x(),
          y: node.y(),
          width: newWidth,
          height: newHeight,
          rotation: node.rotation(),
        });
        for (const { lineId, geo } of lineUpdates) {
          updateObject({ id: lineId, ...geo });
        }
      } finally {
        if (needsBatch) commitBatch();
      }

      // Re-sync Transformer bounding box after scale reset
      requestAnimationFrame(() => {
        trRef.current?.forceUpdate();
        trRef.current?.getLayer()?.batchDraw();
      });
    },
    [updateObject, getConnectedLineUpdates, startBatch, commitBatch],
  );

  // Ref callback to track shape nodes for Transformer + fade-in animation
  const setShapeRef = useCallback((id: string) => {
    return (node: Konva.Group | null) => {
      if (node) {
        shapeRefs.current.set(id, node);
        // Animate newly created objects (skip initial load via lagged ref)
        if (wasInitializedRef.current && !animatedIdsRef.current.has(id)) {
          animatedIdsRef.current.add(id);
          node.opacity(0);
          node.scaleX(0.8);
          node.scaleY(0.8);
          const tween = new Konva.Tween({
            node,
            duration: 0.2,
            opacity: 1,
            scaleX: 1,
            scaleY: 1,
            easing: Konva.Easings.EaseOut,
            onFinish: () => tween.destroy(),
          });
          tween.play();
        }
      } else {
        shapeRefs.current.delete(id);
      }
    };
  }, []);

  // Stable dbl-click handler for editable objects (sticky, text, frame)
  const handleShapeDblClick = useCallback((id: string) => {
    setSelectedIds(new Set());
    setEditingId(id);
  }, []);

  // Combined stage mouse move: cursor sync + marquee tracking + frame/shape draft
  const handleStageMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      handleMouseMove(e); // cursor sync (throttled) + marquee tracking

      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
      const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;

      // Frame draft
      if (frameDraftRef.current) {
        setFrameDraft((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            x: Math.min(prev.startX, worldX),
            y: Math.min(prev.startY, worldY),
            width: Math.abs(worldX - prev.startX),
            height: Math.abs(worldY - prev.startY),
          };
        });
        return;
      }

      // Shape/connector draft
      const ds = drawStartRef.current;
      if (!ds) return;
      const dx = worldX - ds.x;
      const dy = worldY - ds.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Threshold: 5px to distinguish click from drag
      if (dist < 5 && !shapeDraftRef.current) return;

      if (ds.toolMode === "connector") {
        // Connector: line from start to cursor, check end snap
        // KEY-DECISION 2026-02-21: Recalculate start edge point dynamically as drag angle changes.
        // ds.startSnapPoint is frozen at mousedown angle; getEdgePoint here tracks the cursor
        // direction so the start edge faces the current drag target, not the original click angle.
        let startX = ds.startSnapPoint?.x ?? ds.x;
        let startY = ds.startSnapPoint?.y ?? ds.y;
        if (ds.startObjectId) {
          const startObj = objectsRef.current.get(ds.startObjectId);
          if (startObj) {
            const ep = getEdgePoint(startObj, worldX, worldY);
            startX = ep.x;
            startY = ep.y;
          }
        }
        let snap = findSnapTarget(worldX, worldY, objectsRef.current.values());
        // Don't snap to the object we started the connector from
        if (snap && snap.objectId === ds.startObjectId) snap = null;
        setShapeDraft({
          toolMode: "connector",
          x: startX,
          y: startY,
          width: (snap?.snapPoint.x ?? worldX) - startX,
          height: (snap?.snapPoint.y ?? worldY) - startY,
          snapTarget: snap ?? undefined,
        });
      } else {
        // Shape: drag from start to cursor (min/max for proper rect)
        const x = Math.min(ds.x, worldX);
        const y = Math.min(ds.y, worldY);
        const w = Math.abs(dx);
        const h = Math.abs(dy);
        setShapeDraft({ toolMode: ds.toolMode, x, y, width: w, height: h });
      }
    },
    [handleMouseMove],
  );

  const commitPendingFrame = useCallback(
    (title: string) => {
      if (!pendingFrame) return;
      createObject({
        id: crypto.randomUUID(),
        type: "frame",
        x: pendingFrame.x,
        y: pendingFrame.y,
        width: pendingFrame.width,
        height: pendingFrame.height,
        rotation: 0,
        props: { text: title || "Frame" },
        createdBy: user.id,
        updatedAt: Date.now(),
      });
      setPendingFrame(null);
      setToolMode("select");
    },
    [pendingFrame, createObject, user.id],
  );

  // Double-click on empty canvas - no-op (creation handled by click/drag)
  const handleStageDblClick = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    // Shape creation is now handled by mousedown/mouseup
  }, []);

  // --- Mobile touch handlers ---

  const handleStageTouchStart = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      if (!isMobile) return;
      const ts = touchGestureRef.current;
      const touches = e.evt.touches;
      if (touches.length >= 2) {
        ts.pinching = true;
        ts.panningEmptyStage = false;
        ts.tapStart = null;
        ts.lastDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        return;
      }
      ts.pinching = false;
      ts.lastDist = 0;
      if (touches.length === 1) {
        const touch = touches[0];
        if (e.target === stageRef.current) {
          ts.panningEmptyStage = true;
          ts.panLastX = touch.clientX;
          ts.panLastY = touch.clientY;
          ts.tapStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
        } else {
          ts.panningEmptyStage = false;
          ts.tapStart = null;
        }
      }
    },
    [isMobile],
  );

  const handleStageTouchMove = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      if (!isMobile) return;
      const ts = touchGestureRef.current;
      const touches = e.evt.touches;

      if (touches.length >= 2) {
        ts.panningEmptyStage = false;
        ts.tapStart = null;
        const now = Date.now();
        if (now - ts.lastThrottleTime < 33) return; // throttle to ~30fps
        ts.lastThrottleTime = now;

        const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        const midX = (touches[0].clientX + touches[1].clientX) / 2;
        const midY = (touches[0].clientY + touches[1].clientY) / 2;
        if (ts.lastDist > 0) {
          const factor = dist / ts.lastDist;
          const oldScale = scaleRef.current;
          const newScale = Math.min(3, Math.max(0.5, oldScale * factor));
          setScale(newScale);
          setStagePos({
            x: midX - (midX - stagePosRef.current.x) * (newScale / oldScale),
            y: midY - (midY - stagePosRef.current.y) * (newScale / oldScale),
          });
        }
        ts.lastDist = dist;
        return;
      }

      if (touches.length === 1 && ts.panningEmptyStage) {
        const touch = touches[0];
        const dx = touch.clientX - ts.panLastX;
        const dy = touch.clientY - ts.panLastY;
        setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        ts.panLastX = touch.clientX;
        ts.panLastY = touch.clientY;
        if (ts.tapStart) {
          const moved = Math.hypot(touch.clientX - ts.tapStart.x, touch.clientY - ts.tapStart.y);
          if (moved > 8) ts.tapStart = null;
        }
      }
    },
    [isMobile],
  );

  const handleStageTouchEnd = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      if (!isMobile) return;
      const ts = touchGestureRef.current;
      if (ts.pinching && e.evt.touches.length < 2) {
        ts.pinching = false;
        ts.lastDist = 0;
      }
      if (e.evt.touches.length === 0) {
        ts.panningEmptyStage = false;
        if (ts.tapStart) {
          const elapsed = Date.now() - ts.tapStart.time;
          if (elapsed < 300) {
            const now = Date.now();
            if (now - ts.lastTapTime < 350) {
              // Double-tap: reset view to 1:1
              setScale(1);
              setStagePos({ x: 0, y: 0 });
              ts.lastTapTime = 0;
              setTapMenuPos(null);
            } else {
              ts.lastTapTime = now;
              // Single tap on empty canvas: show creation popup
              const stage = stageRef.current;
              if (stage) {
                const pointer = stage.getPointerPosition();
                if (pointer) {
                  const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
                  const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;
                  setTapMenuPos({ screenX: ts.tapStart.x, screenY: ts.tapStart.y, worldX, worldY });
                }
              }
            }
          }
          ts.tapStart = null;
        }
      }
    },
    [isMobile],
  );

  const handleTapMenuSelect = useCallback(
    (type: "sticky" | "text" | "person" | "rect" | "circle") => {
      if (!tapMenuPos) return;
      const { worldX, worldY } = tapMenuPos;
      setTapMenuPos(null);
      if (type === "sticky") {
        createObject({
          id: crypto.randomUUID(),
          type: "sticky",
          x: worldX - 100,
          y: worldY - 100,
          width: 200,
          height: 200,
          rotation: 0,
          props: { text: "", color: "#fbbf24" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (type === "text") {
        const id = crypto.randomUUID();
        createObject({
          id,
          type: "text",
          x: worldX,
          y: worldY,
          width: 200,
          height: 40,
          rotation: 0,
          props: { text: "", color: "#ffffff" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
        setEditingId(id);
      } else if (type === "person") {
        const name = window.prompt("Character name:");
        if (name !== null) {
          createObject({
            id: crypto.randomUUID(),
            type: "person",
            x: worldX - 30,
            y: worldY - 60,
            width: 60,
            height: 120,
            rotation: 0,
            props: { text: name || "Character", color: getUserColor(user.id) },
            createdBy: user.id,
            updatedAt: Date.now(),
          });
        }
      } else if (type === "rect") {
        createObject({
          id: crypto.randomUUID(),
          type: "rect",
          x: worldX - 75,
          y: worldY - 50,
          width: 150,
          height: 100,
          rotation: 0,
          props: { fill: "#3b82f6", stroke: "#2563eb" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      } else if (type === "circle") {
        createObject({
          id: crypto.randomUUID(),
          type: "circle",
          x: worldX - 50,
          y: worldY - 50,
          width: 100,
          height: 100,
          rotation: 0,
          props: { fill: "#8b5cf6", stroke: "#7c3aed" },
          createdBy: user.id,
          updatedAt: Date.now(),
        });
      }
    },
    [tapMenuPos, createObject, user.id],
  );

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    onLogout();
  };

  // ---------------------------------------------------------------------------
  // Mobile layout: chat is primary, canvas preview strip at top
  // ---------------------------------------------------------------------------
  if (isMobile && !canvasExpanded) {
    const previewHeight = Math.round(size.height * 0.3);
    // KEY-DECISION 2026-02-19: Show OnboardModal on mobile when board is empty and no scene has started.
    // boardGenStarted doubles as the "dismissed onboarding" flag on mobile too.
    const showMobileOnboard = initialized && objects.size === 0 && !boardGenStarted;
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: colors.bg,
          overflow: "hidden",
        }}
      >
        {/* Condensed header: board name + connection dot + spectator count only */}
        <div
          style={{
            height: 48,
            flexShrink: 0,
            zIndex: 10,
            background: colors.overlayHeader,
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 1rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Button
              variant="link"
              onClick={onBack}
              style={{ color: colors.textMuted, fontSize: "0.875rem", minHeight: 44, minWidth: 44 }}
            >
              &larr; Boards
            </Button>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span
                style={{ fontSize: "0.625rem", color: colors.textSubtle, fontWeight: 400, letterSpacing: "0.05em" }}
              >
                YesAInd
              </span>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: colors.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 200,
                }}
              >
                {boardName || "Untitled"}
              </span>
            </div>
            <span
              data-testid="connection-state"
              data-state={connectionState}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                display: "inline-block",
                background: {
                  connected: colors.success,
                  reconnecting: colors.warning,
                  connecting: colors.info,
                  disconnected: colors.error,
                  failed: colors.error,
                }[connectionState],
              }}
              title={connectionState}
            />
          </div>
          {spectatorCount > 0 && (
            <span style={{ color: colors.textDim, fontSize: "0.75rem" }}>{spectatorCount} watching</span>
          )}
        </div>

        {/* Canvas preview strip (~30% height) - tap to expand full-screen */}
        <div
          style={{
            height: previewHeight,
            flexShrink: 0,
            cursor: "pointer",
            position: "relative",
            overflow: "hidden",
            borderBottom: `1px solid ${colors.border}`,
          }}
          onClick={() => setCanvasExpanded(true)}
        >
          <CanvasPreview objects={objects} width={size.width} height={previewHeight} />
          <div
            style={{
              position: "absolute",
              bottom: 6,
              right: 8,
              background: "rgba(0,0,0,0.55)",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: "0.6875rem",
              color: colors.textMuted,
              pointerEvents: "none",
            }}
          >
            Tap to expand
          </div>
        </div>

        {/* Chat panel fills remaining space - primary mobile interaction */}
        <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
          <ChatPanel
            boardId={boardId}
            username={user.username}
            gameMode={gameMode}
            aiModel={aiModel}
            onClose={() => {}}
            initialPrompt={chatInitialPrompt}
            initialTemplateId={chatInitialTemplateId}
            selectedIds={selectedIds}
            onAIComplete={handleAIComplete}
            mobileMode={true}
            claimedPersonaId={claimedPersonaId}
            onClaimChange={setClaimedPersonaId}
            troupeConfig={troupeConfig}
            heckleEvents={heckleEvents}
            onChatSend={handleChatSend}
          />
        </div>

        {/* Onboard modal - rendered on top when board is empty (mobile-sized, full modal) */}
        {showMobileOnboard && (
          <OnboardModal
            personas={personas}
            onSubmit={(prompt, mode, model, personaId, _templateId, tc) => {
              setGameMode(mode);
              setAIModel(model);
              setClaimedPersonaId(personaId);
              setTroupeConfig(tc);
              setBoardGenStarted(true);
              setChatInitialPrompt(prompt);
              if (mode !== "freeform") {
                fetch(`/api/boards/${boardId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ game_mode: mode }),
                  credentials: "include",
                }).catch((e) => console.error("Failed to save game mode:", e));
              }
            }}
            onDismiss={() => setBoardGenStarted(true)}
          />
        )}

        {/* Connection status toast */}
        <ConnectionToast connectionState={connectionState} />
      </div>
    );
  }

  return (
    // cb-canvas-overlay applies slide-in animation when mobile expanded canvas is shown
    // cb-wave-shake / cb-wave-glow are applied temporarily for audience wave CSS effects
    <div
      className={
        [isMobile && canvasExpanded ? "cb-canvas-overlay" : "", getWaveContainerClass(activeWave)]
          .filter(Boolean)
          .join(" ") || undefined
      }
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: colors.bg,
        cursor: toolCursors[toolMode] || "default",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 10,
          background: colors.overlayHeader,
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          color: colors.text,
          fontSize: "0.875rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {isMobile && canvasExpanded ? (
            <Button
              variant="link"
              onClick={() => {
                setCanvasExpanded(false);
                // Clear canvas interaction state so it doesn't leak back into chat.
                // selectedIds especially matters: AI uses it to scope operations, and the
                // user has no way to see or clear the selection from the chat view.
                setSelectedIds(new Set());
                setEditingId(null);
                setFrameDraft(null);
                setPendingFrame(null);
                // Prevent chatInitialPrompt from re-firing on ChatPanel remount
                setChatInitialPrompt(undefined);
                setChatInitialTemplateId(undefined);
              }}
              style={{ color: colors.textMuted, fontSize: "0.875rem", minHeight: 44, minWidth: 44 }}
            >
              &larr; Chat
            </Button>
          ) : (
            <Button
              variant="link"
              onClick={onBack}
              style={{ color: colors.textMuted, fontSize: "0.875rem", minHeight: 44, minWidth: 44 }}
            >
              &larr; Boards
            </Button>
          )}
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: "0.625rem", color: colors.textSubtle, fontWeight: 400, letterSpacing: "0.05em" }}>
              YesAInd
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: "0.875rem",
                color: colors.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 200,
              }}
            >
              {boardName || "Untitled"}
            </span>
          </div>
          <span
            data-testid="connection-state"
            data-state={connectionState}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              display: "inline-block",
              background: {
                connected: colors.success,
                reconnecting: colors.warning,
                connecting: colors.info,
                disconnected: colors.error,
                failed: colors.error,
              }[connectionState],
            }}
            title={connectionState}
          />
        </div>
        {/* On mobile expanded canvas, hide desktop-only chrome (presence, zoom, invite, logout) */}
        {isMobile && canvasExpanded ? (
          spectatorCount > 0 ? (
            <span style={{ color: colors.textDim, fontSize: "0.75rem" }}>{spectatorCount} watching</span>
          ) : null
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {/* Presence avatars */}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {presence.map((p) => {
                const isAi = p.id === AI_USER_ID;
                return (
                  <span
                    key={p.id}
                    style={{
                      background: isAi ? colors.aiCursor : colors.accent,
                      borderRadius: "50%",
                      width: 24,
                      height: 24,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.625rem",
                      fontWeight: 600,
                      color: "#fff",
                    }}
                    title={p.username}
                  >
                    {isAi ? "AI" : p.username[0].toUpperCase()}
                  </span>
                );
              })}
              {spectatorCount > 0 && (
                <span style={{ color: colors.textDim, fontSize: "0.75rem", marginLeft: 4 }}>
                  {spectatorCount} watching
                </span>
              )}
            </div>
            <span style={{ color: colors.textDim }}>{Math.round(scale * 100)}%</span>
            <span>{user.displayName}</span>
            <Select
              value={aiModel}
              onChange={(v) => setAIModel(v as AIModel)}
              options={AI_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            />
            <Button
              onClick={() => {
                navigator.clipboard.writeText(`${location.origin}/#watch/${boardId}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied!" : "Invite Spectators"}
            </Button>
            <Button onClick={handleLogout}>Logout</Button>
          </div>
        )}
      </div>

      {/* Connection status toast */}
      <ConnectionToast connectionState={connectionState} />
      {/* Loading skeleton while WebSocket connects */}
      {!initialized && connectionState !== "disconnected" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            top: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    animation: `cb-pulse 1.5s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.875rem" }}>Loading board...</div>
          </div>
        </div>
      )}

      {/* Onboard modal - shown on empty boards until user starts a scene or dismisses */}
      {initialized && objects.size === 0 && !boardGenStarted && !chatOpen && (
        <OnboardModal
          personas={personas}
          onSubmit={(prompt, mode, model, personaId, templateId, tc) => {
            setGameMode(mode);
            setAIModel(model);
            setClaimedPersonaId(personaId);
            setTroupeConfig(tc);
            setBoardGenStarted(true);
            setChatInitialPrompt(prompt);
            setChatInitialTemplateId(templateId);
            setChatOpen(true);
            // Persist mode to D1 (fire-and-forget)
            if (mode !== "freeform") {
              fetch(`/api/boards/${boardId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ game_mode: mode }),
                credentials: "include",
              }).catch((e) => console.error("Failed to save game mode:", e));
            }
          }}
          onDismiss={() => setBoardGenStarted(true)}
        />
      )}

      {/* Ambient mood lighting - full-canvas gradient behind Konva Stage */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: MOOD_GRADIENTS[canvasMood.mood] ?? "transparent",
          opacity: canvasMood.mood === "neutral" ? 0 : canvasMood.intensity * 0.5,
          transition: "background 2s ease, opacity 2s ease",
        }}
      />

      {/* Canvas */}
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={scale}
        scaleY={scale}
        draggable={false}
        onWheel={handleWheel}
        onMouseMove={handleStageMouseMove}
        onMouseDown={handleStageMouseDown}
        onMouseUp={handleStageMouseUp}
        onClick={(e: KonvaEventObject<MouseEvent>) => {
          setContextMenu(null);
          if (e.target === stageRef.current) {
            if (justFinishedMarqueeRef.current) {
              justFinishedMarqueeRef.current = false;
              return;
            }
            setSelectedIds(new Set());
          }
        }}
        onDblClick={handleStageDblClick}
        onTouchStart={isMobile ? handleStageTouchStart : undefined}
        onTouchMove={isMobile ? handleStageTouchMove : undefined}
        onTouchEnd={isMobile ? handleStageTouchEnd : undefined}
      >
        <Layer>
          <BoardGrid stagePos={stagePos} scale={scale} size={size} />

          {/* Pass 0: stage backgrounds (behind everything, non-interactive) */}
          {[...objects.values()]
            .filter((o) => o.isBackground)
            .map((obj) => (
              <BoardObjectRenderer key={obj.id} obj={obj} isBackground />
            ))}
          {/* Pass 1: frames (behind foreground objects) */}
          {[...objects.values()]
            .filter((o) => o.type === "frame" && !o.isBackground)
            .map((obj) => (
              <InteractiveBoardObject
                key={obj.id}
                obj={obj}
                hasAiGlow={aiGlowIds.has(obj.id)}
                setShapeRef={setShapeRef}
                onShapeClick={handleShapeClick}
                onContextMenu={handleShapeContextMenu}
                onDragStart={handleShapeDragStart}
                onDragMove={handleShapeDragMove}
                onDragEnd={handleShapeDragEnd}
                onTransformEnd={handleObjectTransform}
                onDblClickEdit={handleShapeDblClick}
              />
            ))}
          {/* Frame drag preview */}
          {frameDraft && frameDraft.width > 0 && frameDraft.height > 0 && (
            <Rect
              x={frameDraft.x}
              y={frameDraft.y}
              width={frameDraft.width}
              height={frameDraft.height}
              fill="rgba(99,102,241,0.06)"
              stroke="#6366f1"
              strokeWidth={2 / scale}
              dash={[10 / scale, 5 / scale]}
              cornerRadius={4}
              listening={false}
            />
          )}
          {/* Shape/connector drag preview */}
          {shapeDraft &&
            (shapeDraft.width !== 0 || shapeDraft.height !== 0) &&
            (shapeDraft.toolMode === "connector" ? (
              <>
                <KonvaArrow
                  points={[
                    shapeDraft.x,
                    shapeDraft.y,
                    shapeDraft.x + shapeDraft.width,
                    shapeDraft.y + shapeDraft.height,
                  ]}
                  stroke="#94a3b8"
                  strokeWidth={3 / scale}
                  opacity={0.6}
                  pointerLength={12 / scale}
                  pointerWidth={10 / scale}
                  listening={false}
                />
                {/* Snap indicator at start */}
                {shapeDraft.startObjectId && (
                  <KonvaCircle
                    x={shapeDraft.x}
                    y={shapeDraft.y}
                    radius={6 / scale}
                    fill="rgba(99,102,241,0.4)"
                    stroke="#6366f1"
                    strokeWidth={2 / scale}
                    listening={false}
                  />
                )}
                {/* Snap indicator at end */}
                {shapeDraft.snapTarget && (
                  <KonvaCircle
                    x={shapeDraft.snapTarget.snapPoint.x}
                    y={shapeDraft.snapTarget.snapPoint.y}
                    radius={6 / scale}
                    fill="rgba(99,102,241,0.4)"
                    stroke="#6366f1"
                    strokeWidth={2 / scale}
                    listening={false}
                  />
                )}
              </>
            ) : shapeDraft.toolMode === "sticky" ? (
              <Rect
                x={shapeDraft.x}
                y={shapeDraft.y}
                width={shapeDraft.width}
                height={shapeDraft.height}
                fill="rgba(251,191,36,0.3)"
                stroke="#fbbf24"
                strokeWidth={2 / scale}
                cornerRadius={8}
                listening={false}
              />
            ) : shapeDraft.toolMode === "rect" ? (
              <Rect
                x={shapeDraft.x}
                y={shapeDraft.y}
                width={shapeDraft.width}
                height={shapeDraft.height}
                fill="rgba(59,130,246,0.2)"
                stroke="#3b82f6"
                strokeWidth={2 / scale}
                cornerRadius={4}
                listening={false}
              />
            ) : shapeDraft.toolMode === "circle" ? (
              <Rect
                x={shapeDraft.x}
                y={shapeDraft.y}
                width={shapeDraft.width}
                height={shapeDraft.height}
                fill="rgba(139,92,246,0.2)"
                stroke="#8b5cf6"
                strokeWidth={2 / scale}
                cornerRadius={Math.min(shapeDraft.width, shapeDraft.height) / 2}
                listening={false}
              />
            ) : shapeDraft.toolMode === "text" ? (
              <Rect
                x={shapeDraft.x}
                y={shapeDraft.y}
                width={shapeDraft.width}
                height={shapeDraft.height}
                fill="transparent"
                stroke="#60a5fa"
                strokeWidth={1 / scale}
                dash={[4 / scale, 4 / scale]}
                listening={false}
              />
            ) : null)}

          {/* Pass 2: non-frame, non-background objects */}
          {[...objects.values()]
            .filter((o) => o.type !== "frame" && !o.isBackground)
            .map((obj) => (
              <InteractiveBoardObject
                key={obj.id}
                obj={obj}
                hasAiGlow={aiGlowIds.has(obj.id)}
                setShapeRef={setShapeRef}
                onShapeClick={handleShapeClick}
                onContextMenu={handleShapeContextMenu}
                onDragStart={handleShapeDragStart}
                onDragMove={handleShapeDragMove}
                onDragEnd={handleShapeDragEnd}
                onTransformEnd={handleObjectTransform}
                onDblClickEdit={handleShapeDblClick}
              />
            ))}

          {/* Remote editing indicators - colored border + username on objects being edited by others */}
          {[...textCursors.values()].map((tc) => {
            if (tc.objectId === editingId) return null; // local user editing same object - caret shown in textarea overlay
            const obj = objects.get(tc.objectId);
            if (!obj) return null;
            const color = getUserColor(tc.userId);
            return (
              <React.Fragment key={tc.userId}>
                <Rect
                  x={obj.x}
                  y={obj.y}
                  width={obj.width}
                  height={obj.height}
                  stroke={color}
                  strokeWidth={2 / scale}
                  fill="transparent"
                  dash={[6 / scale, 3 / scale]}
                  listening={false}
                  rotation={obj.rotation || 0}
                />
                <Text
                  x={obj.x}
                  y={obj.y - 18 / scale}
                  text={tc.username}
                  fontSize={11 / scale}
                  fill="#fff"
                  padding={2 / scale}
                  listening={false}
                />
              </React.Fragment>
            );
          })}

          {/* Marquee selection visualization */}
          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill={colors.accentSubtle}
              stroke={colors.accent}
              strokeWidth={1}
              dash={[6, 3]}
              listening={false}
            />
          )}

          {/* Selection transformer */}
          <Transformer
            ref={trRef}
            {...TRANSFORMER_CONFIG}
            anchorSize={isMobile ? 16 : TRANSFORMER_CONFIG.anchorSize}
            keepRatio={circleOnlySelected}
            enabledAnchors={
              circleOnlySelected
                ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                : [
                    "top-left",
                    "top-center",
                    "top-right",
                    "middle-right",
                    "middle-left",
                    "bottom-left",
                    "bottom-center",
                    "bottom-right",
                  ]
            }
            boundBoxFunc={(_oldBox, newBox) => {
              // Lines can have near-zero dimensions in one axis - only clamp shapes
              const hasLineSelected = [...selectedIdsRef.current].some(
                (id) => objectsRef.current.get(id)?.type === "line",
              );
              if (!hasLineSelected && (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20)) return _oldBox;
              return newBox;
            }}
            borderStroke={colors.accent}
            anchorStroke={colors.accent}
          />

          {/* Line endpoint handles: two draggable circles at start/end instead of Transformer */}
          {selectedLineObj && (
            <>
              {/* Start endpoint handle */}
              <KonvaCircle
                x={selectedLineObj.x}
                y={selectedLineObj.y}
                radius={7 / scale}
                fill={colors.accent}
                stroke="#fff"
                strokeWidth={2 / scale}
                draggable
                onClick={(e: KonvaEventObject<MouseEvent>) => {
                  e.cancelBubble = true;
                }}
                onDragStart={() => {
                  lineEndpointDragRef.current = {
                    fixedX: selectedLineObj.x + selectedLineObj.width,
                    fixedY: selectedLineObj.y + selectedLineObj.height,
                  };
                  endpointSnapRef.current = null;
                }}
                onDragMove={(e) => {
                  const fixed = lineEndpointDragRef.current;
                  if (!fixed) return;
                  const dragX = e.target.x();
                  const dragY = e.target.y();
                  // KEY-DECISION 2026-02-21: Exclude endObjectId from snap candidates to prevent
                  // self-loops where start and end connect to the same object.
                  const candidates = [...objectsRef.current.values()].filter(
                    (o) => o.id !== selectedLineObj.endObjectId,
                  );
                  const snap = findSnapTarget(dragX, dragY, candidates);
                  endpointSnapRef.current = snap;
                  setEndpointSnapPoint(snap?.snapPoint ?? null);
                  const newX = snap?.snapPoint.x ?? dragX;
                  const newY = snap?.snapPoint.y ?? dragY;
                  patchObjectLocal(selectedLineObj.id, {
                    x: newX,
                    y: newY,
                    width: fixed.fixedX - newX,
                    height: fixed.fixedY - newY,
                  });
                }}
                onDragEnd={(e) => {
                  const fixed = lineEndpointDragRef.current;
                  if (!fixed) return;
                  const snap = endpointSnapRef.current;
                  const newX = snap?.snapPoint.x ?? e.target.x();
                  const newY = snap?.snapPoint.y ?? e.target.y();
                  updateObject({
                    id: selectedLineObj.id,
                    x: newX,
                    y: newY,
                    width: fixed.fixedX - newX,
                    height: fixed.fixedY - newY,
                    startObjectId: snap?.objectId,
                  });
                  lineEndpointDragRef.current = null;
                  endpointSnapRef.current = null;
                  setEndpointSnapPoint(null);
                }}
              />
              {/* End endpoint handle */}
              <KonvaCircle
                x={selectedLineObj.x + selectedLineObj.width}
                y={selectedLineObj.y + selectedLineObj.height}
                radius={7 / scale}
                fill={colors.accent}
                stroke="#fff"
                strokeWidth={2 / scale}
                draggable
                onClick={(e: KonvaEventObject<MouseEvent>) => {
                  e.cancelBubble = true;
                }}
                onDragStart={() => {
                  lineEndpointDragRef.current = {
                    fixedX: selectedLineObj.x,
                    fixedY: selectedLineObj.y,
                  };
                  endpointSnapRef.current = null;
                }}
                onDragMove={(e) => {
                  const fixed = lineEndpointDragRef.current;
                  if (!fixed) return;
                  const dragX = e.target.x();
                  const dragY = e.target.y();
                  const candidates = [...objectsRef.current.values()].filter(
                    (o) => o.id !== selectedLineObj.startObjectId,
                  );
                  const snap = findSnapTarget(dragX, dragY, candidates);
                  endpointSnapRef.current = snap;
                  setEndpointSnapPoint(snap?.snapPoint ?? null);
                  const newX = snap?.snapPoint.x ?? dragX;
                  const newY = snap?.snapPoint.y ?? dragY;
                  patchObjectLocal(selectedLineObj.id, {
                    width: newX - fixed.fixedX,
                    height: newY - fixed.fixedY,
                  });
                }}
                onDragEnd={(e) => {
                  const fixed = lineEndpointDragRef.current;
                  if (!fixed) return;
                  const snap = endpointSnapRef.current;
                  const newX = snap?.snapPoint.x ?? e.target.x();
                  const newY = snap?.snapPoint.y ?? e.target.y();
                  updateObject({
                    id: selectedLineObj.id,
                    width: newX - fixed.fixedX,
                    height: newY - fixed.fixedY,
                    endObjectId: snap?.objectId,
                  });
                  lineEndpointDragRef.current = null;
                  endpointSnapRef.current = null;
                  setEndpointSnapPoint(null);
                }}
              />
              {/* Snap indicator shown when dragging an endpoint near a connectable object */}
              {endpointSnapPoint && (
                <KonvaCircle
                  x={endpointSnapPoint.x}
                  y={endpointSnapPoint.y}
                  radius={6 / scale}
                  fill="rgba(99,102,241,0.4)"
                  stroke="#6366f1"
                  strokeWidth={2 / scale}
                  listening={false}
                />
              )}
            </>
          )}
        </Layer>

        {/* Cursor layer on top - AI cursor below human cursors */}
        <Layer>
          <AiCursor target={aiCursorTarget} />
          <Cursors cursors={cursors} />
        </Layer>

        {/* Spotlight overlay: dark mask with transparent circle cut-out via destination-out.
            KEY-DECISION 2026-02-20: Separate Layer ensures destination-out only affects this
            layer's canvas buffer, not content layers below. The hole shows through because
            the Layer composites normally on top. Layer opacity is animated for fade-in/out. */}
        {spotlightState && (
          <Layer ref={spotlightLayerRef} listening={false}>
            <Shape
              listening={false}
              sceneFunc={(konvaCtx) => {
                if (!spotlightState) return;

                const ctx = (konvaCtx as any)._context as CanvasRenderingContext2D;
                const visX = -stagePos.x / scale;
                const visY = -stagePos.y / scale;
                const visW = size.width / scale;
                const visH = size.height / scale;
                const spotRadius = 200 / scale; // 200px on-screen regardless of zoom
                ctx.save();
                ctx.fillStyle = "rgba(0, 0, 0, 1)";
                ctx.fillRect(visX, visY, visW, visH);
                ctx.globalCompositeOperation = "destination-out";
                ctx.fillStyle = "rgba(0, 0, 0, 1)";
                ctx.beginPath();
                ctx.arc(spotlightState.x, spotlightState.y, spotRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
              }}
            />
          </Layer>
        )}

        {/* Blackout overlay: full-canvas fade to near-black for scene transitions */}
        {blackoutActive && (
          <Layer ref={blackoutLayerRef} listening={false}>
            <Shape
              listening={false}
              sceneFunc={(konvaCtx) => {
                const ctx = (konvaCtx as any)._context as CanvasRenderingContext2D;
                const visX = -stagePos.x / scale;
                const visY = -stagePos.y / scale;
                const visW = size.width / scale;
                const visH = size.height / scale;
                ctx.save();
                ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
                ctx.fillRect(visX, visY, visW, visH);
                ctx.restore();
              }}
            />
          </Layer>
        )}

        {/* Audience silhouettes at bottom of stage - only when spectators present */}
        <AudienceRow spectatorCount={spectatorCount} />
      </Stage>

      {/* Inline text editing overlay */}
      {editingId &&
        (() => {
          const obj = objects.get(editingId);
          if (!obj) return null;
          if (obj.type === "frame") {
            return (
              <input
                autoFocus
                defaultValue={obj.props.text || ""}
                style={{
                  position: "absolute",
                  left: obj.x * scale + stagePos.x,
                  top: obj.y * scale + stagePos.y - 32,
                  width: Math.min(200, obj.width * scale),
                  height: 28,
                  background: "rgba(22, 33, 62, 0.95)",
                  border: "2px solid #6366f1",
                  borderRadius: 4,
                  padding: "0 8px",
                  fontSize: 13,
                  color: "#e0e7ff",
                  outline: "none",
                  zIndex: 20,
                  boxSizing: "border-box" as const,
                  transform: `rotate(${obj.rotation || 0}deg)`,
                  transformOrigin: "0 0",
                }}
                onChange={(e) => {
                  updateObject({ id: editingId, props: { ...obj.props, text: e.target.value } });
                  send({ type: "text:cursor", objectId: editingId, position: e.target.selectionStart ?? 0 });
                }}
                onBlur={(e) => {
                  updateObject({ id: editingId, props: { ...obj.props, text: e.target.value } });
                  send({ type: "text:blur", objectId: editingId });
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    updateObject({
                      id: editingId,
                      props: { ...obj.props, text: (e.target as HTMLInputElement).value },
                    });
                    send({ type: "text:blur", objectId: editingId });
                    setEditingId(null);
                  }
                }}
              />
            );
          }
          const isText = obj.type === "text";
          // Only sticky/text reach this branch; cast to flat props for field access
          const p = obj.props as BoardObjectProps;
          const remoteCarets = [...textCursors.values()].filter((tc) => tc.objectId === editingId);
          return (
            <>
              <textarea
                ref={textareaRef}
                autoFocus
                defaultValue={p.text || ""}
                style={{
                  position: "absolute",
                  left: obj.x * scale + stagePos.x,
                  top: obj.y * scale + stagePos.y,
                  width: obj.width * scale,
                  height: obj.height * scale,
                  background: isText ? "transparent" : p.color || "#fbbf24",
                  border: isText ? "2px solid #60a5fa" : "2px solid #f59e0b",
                  borderRadius: isText ? 4 * scale : 8 * scale,
                  padding: isText ? 4 * scale : 10 * scale,
                  fontSize: isText ? 16 * scale : 14 * scale,
                  color: isText ? p.color || "#ffffff" : "#1a1a2e",
                  resize: "none",
                  outline: "none",
                  zIndex: 20,
                  boxSizing: "border-box" as const,
                  fontFamily: "inherit",
                  transform: `rotate(${obj.rotation || 0}deg)`,
                  transformOrigin: "0 0",
                }}
                onChange={(e) => {
                  updateObject({ id: editingId, props: { ...p, text: e.target.value } });
                  send({ type: "text:cursor", objectId: editingId, position: e.target.selectionStart ?? 0 });
                }}
                onSelect={(e) => {
                  send({
                    type: "text:cursor",
                    objectId: editingId,
                    position: (e.target as HTMLTextAreaElement).selectionStart ?? 0,
                  });
                }}
                onBlur={(e) => {
                  updateObject({ id: editingId, props: { ...p, text: e.target.value } });
                  send({ type: "text:blur", objectId: editingId });
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    updateObject({ id: editingId, props: { ...p, text: (e.target as HTMLTextAreaElement).value } });
                    send({ type: "text:blur", objectId: editingId });
                    setEditingId(null);
                  }
                }}
              />
              {/* Remote user carets inside this textarea */}
              {remoteCarets.map((tc) => {
                const ta = textareaRef.current;
                if (!ta) return null;
                const pos = getCaretPixelPos(ta, tc.position);
                const color = getUserColor(tc.userId);
                const lineH =
                  parseInt(window.getComputedStyle(ta).lineHeight) || Math.round((isText ? 16 : 14) * scale * 1.4);
                return (
                  <div
                    key={tc.userId}
                    style={{
                      position: "absolute",
                      left: obj.x * scale + stagePos.x + pos.x,
                      top: obj.y * scale + stagePos.y + pos.y,
                      width: 2,
                      height: lineH,
                      background: color,
                      pointerEvents: "none",
                      zIndex: 21,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        bottom: "100%",
                        left: 0,
                        background: color,
                        color: "#fff",
                        fontSize: 10,
                        padding: "1px 4px",
                        borderRadius: 3,
                        whiteSpace: "nowrap",
                        fontFamily: "inherit",
                      }}
                    >
                      {tc.username}
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()}

      {/* Pending frame title input */}
      {pendingFrame && (
        <input
          autoFocus
          placeholder="Frame title..."
          style={{
            position: "absolute",
            left: pendingFrame.x * scale + stagePos.x,
            top: pendingFrame.y * scale + stagePos.y - 32,
            width: Math.min(200, pendingFrame.width * scale),
            height: 28,
            background: "rgba(22, 33, 62, 0.95)",
            border: "2px solid #6366f1",
            borderRadius: 4,
            padding: "0 8px",
            fontSize: 13,
            color: "#e0e7ff",
            outline: "none",
            zIndex: 20,
            boxSizing: "border-box" as const,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur(); // commit via onBlur
            } else if (e.key === "Escape") {
              pendingFrameCancelled.current = true;
              setPendingFrame(null);
              setToolMode("select");
            }
          }}
          onBlur={(e) => {
            if (pendingFrameCancelled.current) {
              pendingFrameCancelled.current = false;
              return;
            }
            commitPendingFrame(e.target.value);
          }}
        />
      )}

      {/* Toolbar: always shown on desktop; on mobile shown when canvas is expanded */}
      {(!isMobile || canvasExpanded) && (
        <Toolbar
          toolMode={toolMode}
          setToolMode={setToolMode}
          selectedIds={selectedIds}
          objects={objects}
          chatOpen={chatOpen}
          setChatOpen={setChatOpen}
          showShortcuts={showShortcuts}
          setShowShortcuts={setShowShortcuts}
          deleteSelected={deleteSelected}
          onColorChange={handleColorChange}
          onArrowStyleChange={handleArrowStyleChange}
          onZoomIn={() => setScale((s) => Math.min(MAX_ZOOM, s * 1.2))}
          onZoomOut={() => setScale((s) => Math.max(MIN_ZOOM, s / 1.2))}
          onZoomReset={() => {
            setScale(1);
            setStagePos({ x: 0, y: 0 });
          }}
          onPostcard={handleOpenPostcard}
          onBlackout={onBlackout}
          onSfx={handleSfxSend}
          isMobile={isMobile}
        />
      )}

      {/* SFX visual bursts - DOM overlay positioned via canvas coordinates */}
      {sfxBursts.map((burst) => (
        <div
          key={burst.id}
          className="cb-sfx-burst"
          style={{
            left: burst.x * scaleRef.current + stagePosRef.current.x,
            top: burst.y * scaleRef.current + stagePosRef.current.y,
          }}
        >
          <div style={{ fontSize: "3.5rem", lineHeight: 1 }}>{burst.emoji}</div>
          <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
            {burst.label}
          </div>
        </div>
      ))}

      {/* Transient AI visual effects (sparkle/poof/explosion/highlight) - DOM overlay positioned via canvas coords */}
      {transientEffects.map((effect) => (
        <div
          key={effect.id}
          className={`cb-transient-effect cb-transient-${effect.effectType}`}
          style={
            {
              left: effect.x * scaleRef.current + stagePosRef.current.x,
              top: effect.y * scaleRef.current + stagePosRef.current.y,
              "--duration": `${effect.duration}ms`,
            } as React.CSSProperties
          }
        >
          {effect.effectType === "sparkle" && "✨"}
          {effect.effectType === "poof" && "💨"}
          {effect.effectType === "explosion" && "💥"}
        </div>
      ))}

      {/* Tap-to-create menu: shown on single-tap on empty canvas (mobile only) */}
      {isMobile && tapMenuPos && (
        <TapCreateMenu
          screenX={tapMenuPos.screenX}
          screenY={tapMenuPos.screenY}
          onSelect={handleTapMenuSelect}
          onDismiss={() => setTapMenuPos(null)}
        />
      )}

      {/* AI Chat Panel */}
      {chatOpen && (
        <ChatPanel
          boardId={boardId}
          username={user.username}
          gameMode={gameMode}
          aiModel={aiModel}
          onClose={() => {
            setChatOpen(false);
            setChatInitialPrompt(undefined);
            setChatInitialTemplateId(undefined);
            if (objects.size === 0) setBoardGenStarted(false);
          }}
          initialPrompt={chatInitialPrompt}
          initialTemplateId={chatInitialTemplateId}
          selectedIds={selectedIds}
          onAIComplete={handleAIComplete}
          claimedPersonaId={claimedPersonaId}
          onClaimChange={setClaimedPersonaId}
          troupeConfig={troupeConfig}
          onMessagesChange={setRecentChatMessages}
          heckleEvents={heckleEvents}
          onChatSend={handleChatSend}
        />
      )}

      {/* Scene Postcard modal */}
      <PostcardModal
        open={postcardOpen}
        onClose={() => setPostcardOpen(false)}
        snapshotDataUrl={postcardSnapshot}
        messages={recentChatMessages}
        boardId={boardId}
      />

      {/* "Previously On..." recap overlay - shown on board return if scene has history */}
      {recapNarration && (
        <RecapOverlay
          narration={recapNarration}
          onDismiss={() => {
            setRecapNarration(null);
            localStorage.setItem(`recap-seen-${boardId}`, Date.now().toString());
          }}
        />
      )}

      {/* Undo AI batch button - appears after AI creates objects */}
      {undoAiBatchId && (
        <button
          onClick={handleUndoAiBatch}
          style={{
            position: "absolute",
            bottom: 80,
            right: chatOpen ? 392 : 16,
            zIndex: 31,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "rgba(99, 102, 241, 0.15)",
            border: "1px solid rgba(99, 102, 241, 0.4)",
            borderRadius: 8,
            color: "#c7d2fe",
            fontSize: "0.8125rem",
            fontWeight: 500,
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            transition: "all 0.15s ease",
            animation: "cb-undo-ai-in 0.25s ease-out",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(99, 102, 241, 0.25)";
            e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(99, 102, 241, 0.15)";
            e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.4)";
          }}
        >
          <span style={{ fontSize: "0.875rem" }}>&#x21B6;</span>
          Undo AI
        </button>
      )}

      {/* Right-click context menu */}
      {contextMenu &&
        (() => {
          const obj = objects.get(contextMenu.objId);
          if (!obj) return null;
          const cp = obj.props as BoardObjectProps;
          const items: { label: string; prompt: string }[] = [
            {
              label: "Ask AI about this",
              prompt: `What is this ${obj.type}${cp.text ? ` that says "${cp.text}"` : ""} about?`,
            },
            {
              label: "Recolor with AI",
              prompt: `Change the color of this ${obj.type} (id: ${obj.id}) to a random vibrant color.`,
            },
          ];
          if (obj.type === "sticky" || obj.type === "text") {
            items.push({
              label: "Expand on this",
              prompt: `Create more sticky notes related to: "${obj.props.text || ""}"`,
            });
          }
          return (
            <div onClick={() => setContextMenu(null)} style={{ position: "absolute", inset: 0, zIndex: 40 }}>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: contextMenu.x,
                  top: contextMenu.y,
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: 4,
                  minWidth: 180,
                  zIndex: 41,
                }}
              >
                {items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setSelectedIds(new Set([contextMenu.objId]));
                      openChatWithPrompt(item.prompt);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      color: colors.text,
                      padding: "8px 12px",
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = colors.accentSubtle;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

      {/* Confetti burst (first object + AI multi-create) */}
      {confettiPos && <ConfettiBurst key={confettiKey} x={confettiPos.x} y={confettiPos.y} onDone={clearConfetti} />}

      {/* Audience wave effect overlay (confetti/hearts/spotlight/dramatic) */}
      {activeWave && waveNeedsOverlay(activeWave.effect) && (
        <WaveEffect
          key={activeWave.key}
          effect={activeWave.effect}
          emoji={activeWave.emoji}
          count={activeWave.count}
          onDone={dismissWave}
        />
      )}

      {/* Floating reactions - above audience figures when spectators present, else canvas position */}
      {reactions.map((r) => {
        let screenX: number;
        let screenY: number;
        if (spectatorCount > 0) {
          const xs = getAudienceFigureXs(spectatorCount);
          // Deterministic figure pick: first 2 hex chars of UUID give 0-255 range (NaN-safe fallback to 0)
          const raw = parseInt(r.id.substring(0, 2), 16);
          const figIdx = (Number.isNaN(raw) ? 0 : raw) % xs.length;
          screenX = xs[figIdx] * scale + stagePos.x;
          screenY = (AUDIENCE_Y - 24) * scale + stagePos.y;
        } else {
          screenX = r.x * scale + stagePos.x;
          screenY = r.y * scale + stagePos.y;
        }
        return (
          <span
            key={r.id}
            className={spectatorCount > 0 ? "cb-audience-reaction" : "cb-reaction"}
            style={{ left: screenX, top: screenY }}
          >
            {r.emoji}
          </span>
        );
      })}

      {/* Canvas speech bubbles - heckle shouts above audience + performer chat visible to spectators */}
      <CanvasSpeechBubbles
        bubbles={canvasBubbles}
        spectatorCount={spectatorCount}
        scale={scale}
        stagePos={stagePos}
        headerH={0}
      />

      {/* Performance overlay (Shift+P or backtick to toggle) */}
      <PerfOverlay
        objectCount={objects.size}
        cursorCount={cursors.size}
        connectionState={connectionState}
        stageRef={stageRef}
        lastServerMessageAt={lastServerMessageAt}
      />

      {/* Curtain call confetti bursts - spread across viewport */}
      {curtainConfettis.map((c) => (
        <ConfettiBurst
          key={c.id}
          x={c.x}
          y={c.y}
          onDone={() => setCurtainConfettis((prev) => prev.filter((p) => p.id !== c.id))}
        />
      ))}

      {/* Audience poll indicator for players - compact banner (spectators get full overlay) */}
      {(activePoll || pollResult) && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            background: "#0f172a",
            border: "1px solid rgba(251,191,36,0.4)",
            borderRadius: 12,
            padding: "10px 18px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: "0.8125rem",
            color: "#e2e8f0",
            maxWidth: 400,
            overflow: "hidden",
          }}
        >
          <span style={{ color: "#fbbf24", fontSize: "1rem" }}>🎭</span>
          {activePoll ? (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Audience voting: <em style={{ color: "#fbbf24" }}>{activePoll.question}</em>
            </span>
          ) : pollResult ? (
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              Audience chose: <em style={{ color: "#fbbf24" }}>{pollResult.winner.label}</em>
              <button
                onClick={clearPollResult}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </span>
          ) : null}
        </div>
      )}

      {/* Curtain call overlay - scene end celebration + star rating */}
      {curtainCall && (
        <div
          onClick={clearCurtainCall}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1a1a2e",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: "40px 48px",
              maxWidth: 480,
              width: "90%",
              textAlign: "center",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            {/* Scene complete header */}
            <div
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: "0.8rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.4)",
                marginBottom: 12,
              }}
            >
              Scene Complete
            </div>
            <div
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: "clamp(1.25rem, 4vw, 1.75rem)",
                fontWeight: 700,
                color: "#f5f5f5",
                marginBottom: 16,
                lineHeight: 1.2,
              }}
            >
              {curtainCall.sceneTitle}
            </div>

            {/* Starring line */}
            {curtainCall.characters.length > 0 && (
              <div
                style={{
                  fontSize: "0.875rem",
                  color: "rgba(255,255,255,0.55)",
                  marginBottom: 32,
                  letterSpacing: "0.03em",
                }}
              >
                Starring:{" "}
                <span style={{ color: "rgba(255,255,255,0.8)" }}>
                  {curtainCall.characters.map((ch) => ch.name).join(", ")}
                </span>
              </div>
            )}

            {/* Star rating UI */}
            {curtainRatingSubmitted ? (
              <div style={{ color: "#4ade80", fontSize: "1rem", fontWeight: 600, marginBottom: 24 }}>
                Thanks for rating!
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "rgba(255,255,255,0.4)",
                    marginBottom: 12,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  Rate this scene
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onMouseEnter={() => setCurtainRatingHover(star)}
                      onMouseLeave={() => setCurtainRatingHover(0)}
                      onClick={() => setCurtainRating(star)}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "2rem",
                        cursor: "pointer",
                        color: star <= (curtainRatingHover || curtainRating) ? "#fbbf24" : "rgba(255,255,255,0.2)",
                        padding: "0 2px",
                        lineHeight: 1,
                        transition: "color 0.1s",
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <button
                  disabled={curtainRating === 0}
                  onClick={() => {
                    if (!curtainRating) return;
                    fetch(`/api/boards/${boardId}/rate`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ rating: curtainRating }),
                      credentials: "include",
                    })
                      .then(() => setCurtainRatingSubmitted(true))
                      .catch(() => setCurtainRatingSubmitted(true)); // optimistic: show thanks even on network error
                  }}
                  style={{
                    background: curtainRating > 0 ? "#6366f1" : "rgba(255,255,255,0.08)",
                    border: "none",
                    borderRadius: 8,
                    color: curtainRating > 0 ? "#fff" : "rgba(255,255,255,0.3)",
                    padding: "10px 28px",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    cursor: curtainRating > 0 ? "pointer" : "default",
                    transition: "background 0.15s, color 0.15s",
                    letterSpacing: "0.04em",
                  }}
                >
                  Submit
                </button>
              </div>
            )}

            {/* Dismiss hint */}
            <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.2)", letterSpacing: "0.04em" }}>
              Click outside or wait 15 seconds to dismiss
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
