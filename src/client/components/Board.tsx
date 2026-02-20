import React, { useState, useRef, useCallback, useEffect } from "react";
import { Stage, Layer, Rect, Text, Transformer, Arrow as KonvaArrow, Circle as KonvaCircle } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import Konva from "konva";
import type { AuthUser } from "../App";
import { AI_USER_ID } from "@shared/types";
import type { BoardObject, BoardObjectProps, GameMode, AIModel } from "@shared/types";
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
import { BoardGrid } from "./BoardGrid";
import { PerfOverlay } from "./PerfOverlay";
import { Button } from "./Button";
import { useIsMobile } from "../hooks/useIsMobile";
import "../styles/animations.css";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const CURSOR_THROTTLE_MS = 33; // ~30fps

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

  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const lastDragSendRef = useRef(0);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>();
  const [chatInitialTemplateId, setChatInitialTemplateId] = useState<string | undefined>();
  const [boardGenStarted, setBoardGenStarted] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>("freeform");
  // Claude Haiku 4.5 default; sent on every message so server knows which provider to use
  const [aiModel, setAIModel] = useState<AIModel>("claude-haiku-4.5");
  // Per-player persona claim - set via OnboardModal or ChatPanel inline picker
  const [claimedPersonaId, setClaimedPersonaId] = useState<string | null>(null);

  // Hydrate game mode from D1 on mount (so returning users get the right mode)
  useEffect(() => {
    fetch(`/api/boards/${boardId}`)
      .then((r) => {
        if (r.status === 401) {
          onLogout();
          return null;
        } // session expired
        return r.ok ? (r.json() as Promise<{ game_mode?: string }>) : null;
      })
      .then((data) => {
        if (data?.game_mode && ["hat", "yesand"].includes(data.game_mode)) {
          setGameMode(data.game_mode as GameMode);
        }
      })
      .catch((err) => {
        // Non-critical: board still usable at freeform default; log for debugging
        console.warn("[Board] Failed to fetch game mode, defaulting to freeform:", err);
      });
  }, [boardId, onLogout]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objId: string } | null>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());

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
    snapTarget?: { objectId: string; snapPoint: { x: number; y: number } };
  } | null>(null);
  const shapeDraftRef = useRef(shapeDraft);
  shapeDraftRef.current = shapeDraft;

  // Bulk drag state
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const {
    connectionState,
    initialized,
    cursors,
    textCursors,
    objects,
    presence,
    spectatorCount,
    reactions,
    send,
    createObject: wsCreate,
    updateObject: wsUpdate,
    deleteObject: wsDelete,
    patchObjectLocal,
    batchUndo,
    lastServerMessageAt,
  } = useWebSocket(boardId);

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

  // Stable refs to avoid recreating callbacks on every state change
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  // --- AI Batch Undo state ---
  const [undoAiBatchId, setUndoAiBatchId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const undoAiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedBatchIds = useRef(new Set<string>());

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
    undoAiTimerRef.current = setTimeout(() => setUndoAiBatchId(null), 10000);
  }, [pushExternalBatch]);

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
      const nodes = [...selectedIds].map((id) => shapeRefs.current.get(id)).filter((n): n is Konva.Group => !!n);
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

      if (toolMode === "select") {
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
    [toolMode, startMarquee],
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
        createObject({
          id: crypto.randomUUID(),
          type: "line",
          x: cx - 100,
          y: cy,
          width: 200,
          height: 0,
          rotation: 0,
          props: { stroke: "#94a3b8", arrow: "end" },
          createdBy: user.id,
          updatedAt: Date.now(),
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
      const newWidth = isLine ? Math.round(obj.width * sx) : Math.max(20, Math.round(obj.width * sx));
      const newHeight = isLine ? Math.round(obj.height * sy) : Math.max(20, Math.round(obj.height * sy));

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
        const startX = ds.startSnapPoint?.x ?? ds.x;
        const startY = ds.startSnapPoint?.y ?? ds.y;
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

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
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
            <span style={{ fontWeight: 600, fontSize: "0.875rem", color: colors.text }}>CollabBoard</span>
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
          />
        </div>

        {/* Onboard modal - rendered on top when board is empty (mobile-sized, full modal) */}
        {showMobileOnboard && (
          <OnboardModal
            onSubmit={(prompt, mode, model, personaId) => {
              setGameMode(mode);
              setAIModel(model);
              setClaimedPersonaId(personaId);
              setBoardGenStarted(true);
              setChatInitialPrompt(prompt);
              if (mode !== "freeform") {
                fetch(`/api/boards/${boardId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ game_mode: mode }),
                }).catch(() => {});
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
    <div
      className={isMobile && canvasExpanded ? "cb-canvas-overlay" : undefined}
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
          background: "rgba(22, 33, 62, 0.9)",
          borderBottom: "1px solid #334155",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          color: "#eee",
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
              style={{ color: "#94a3b8", fontSize: "0.875rem", minHeight: 44, minWidth: 44 }}
            >
              &larr; Boards
            </Button>
          )}
          <span style={{ fontWeight: 600 }}>CollabBoard</span>
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
            <span style={{ color: "#888" }}>{Math.round(scale * 100)}%</span>
            <span>{user.displayName}</span>
            <select
              value={aiModel}
              onChange={(e) => setAIModel(e.target.value as AIModel)}
              style={{
                background: "rgba(22, 33, 62, 0.8)",
                border: "1px solid #334155",
                borderRadius: 6,
                color: "#e2e8f0",
                fontSize: "0.75rem",
                padding: "2px 8px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
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
          onSubmit={(prompt, mode, model, personaId, templateId) => {
            setGameMode(mode);
            setAIModel(model);
            setClaimedPersonaId(personaId);
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
              }).catch(() => {});
            }
          }}
          onDismiss={() => setBoardGenStarted(true)}
        />
      )}

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
      >
        <Layer>
          <BoardGrid stagePos={stagePos} scale={scale} size={size} />

          {/* Pass 1: frames (behind everything) */}
          {[...objects.values()]
            .filter((o) => o.type === "frame")
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

          {/* Pass 2: non-frame objects */}
          {[...objects.values()]
            .filter((o) => o.type !== "frame")
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
        </Layer>

        {/* Cursor layer on top - AI cursor below human cursors */}
        <Layer>
          <AiCursor target={aiCursorTarget} />
          <Cursors cursors={cursors} />
        </Layer>
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

      {/* Toolbar hidden on mobile - AI creates objects via chat */}
      {!isMobile && (
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

      {/* Floating reactions from spectators */}
      {reactions.map((r) => {
        const screenX = r.x * scale + stagePos.x;
        const screenY = r.y * scale + stagePos.y;
        return (
          <span key={r.id} className="cb-reaction" style={{ left: screenX, top: screenY }}>
            {r.emoji}
          </span>
        );
      })}

      {/* Performance overlay (Shift+P or backtick to toggle) */}
      <PerfOverlay
        objectCount={objects.size}
        cursorCount={cursors.size}
        connectionState={connectionState}
        stageRef={stageRef}
        lastServerMessageAt={lastServerMessageAt}
      />
    </div>
  );
}
