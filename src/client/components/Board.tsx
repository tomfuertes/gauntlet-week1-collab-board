import React, { useState, useRef, useCallback, useEffect } from "react";
import { Stage, Layer, Rect, Text, Group, Transformer, Ellipse, Line as KonvaLine, Arrow, Image as KonvaImage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import Konva from "konva";
import type { AuthUser } from "../App";
import { AI_USER_ID } from "@shared/types";
import type { BoardObject } from "@shared/types";
import { useWebSocket, type ConnectionState } from "../hooks/useWebSocket";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useAiObjectEffects } from "../hooks/useAiObjectEffects";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useDragSelection } from "../hooks/useDragSelection";
import { colors, toolCursors, getUserColor } from "../theme";
import { Toolbar, type ToolMode } from "./Toolbar";
import { Cursors } from "./Cursors";
import { ChatPanel } from "./ChatPanel";
import { OnboardModal } from "./OnboardModal";
import { ConfettiBurst } from "./ConfettiBurst";
import { BoardGrid } from "./BoardGrid";
import { PerfOverlay } from "./PerfOverlay";
import "../styles/animations.css";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const CURSOR_THROTTLE_MS = 33; // ~30fps

// Mirror-div technique: find pixel coords of character at `position` inside a textarea
function getCaretPixelPos(textarea: HTMLTextAreaElement, position: number): { x: number; y: number } {
  const div = document.createElement("div");
  const style = window.getComputedStyle(textarea);
  (["fontSize", "fontFamily", "fontWeight", "letterSpacing", "lineHeight",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "boxSizing"] as const).forEach((p) => { div.style[p] = style[p]; });
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

// Renders a base64 image using Konva's Image component, handling async loading
function KonvaImageRenderer({ src, width, height, aiGlowProps }: { src: string; width: number; height: number; aiGlowProps: Record<string, unknown> }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!src) { setError(true); return; }
    setError(false);
    setImg(null);
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => { if (!cancelled) setImg(image); };
    image.onerror = () => { if (!cancelled) setError(true); };
    image.src = src;
    return () => { cancelled = true; };
  }, [src]);
  if (error) {
    return <Rect width={width} height={height} fill="rgba(239,68,68,0.08)" stroke="#ef4444" strokeWidth={1} dash={[4, 4]} cornerRadius={4} />;
  }
  if (!img) {
    return <Rect width={width} height={height} fill="rgba(99,102,241,0.08)" stroke="#6366f1" strokeWidth={1} dash={[4, 4]} cornerRadius={4} />;
  }
  return <KonvaImage image={img} width={width} height={height} cornerRadius={4} {...aiGlowProps} />;
}

// Memoized object renderer - prevents re-rendering unchanged objects when Board state changes
interface BoardObjectRendererProps {
  obj: BoardObject;
  hasAiGlow: boolean;
  setShapeRef: (id: string) => (node: Konva.Group | null) => void;
  onShapeClick: (e: KonvaEventObject<MouseEvent>, id: string) => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>, id: string) => void;
  onDragStart: (e: KonvaEventObject<DragEvent>, id: string) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>, id: string) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>, id: string) => void;
  onTransformEnd: (e: KonvaEventObject<Event>, obj: { id: string; type: string; width: number; height: number }) => void;
  onDblClickEdit: (id: string) => void;
}

const BoardObjectRenderer = React.memo(function BoardObjectRenderer({
  obj, hasAiGlow, setShapeRef, onShapeClick, onContextMenu, onDragStart, onDragMove, onDragEnd, onTransformEnd, onDblClickEdit,
}: BoardObjectRendererProps) {
  const aiGlowProps = hasAiGlow ? { shadowBlur: 12, shadowColor: "rgba(99,102,241,0.5)" } : {};
  const aiGlowLineProps = hasAiGlow ? { shadowBlur: 8, shadowColor: "rgba(99,102,241,0.4)" } : {};
  const editable = obj.type === "sticky" || obj.type === "text" || obj.type === "frame";

  const groupProps = {
    ref: setShapeRef(obj.id),
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    draggable: true as const,
    onClick: (e: KonvaEventObject<MouseEvent>) => onShapeClick(e, obj.id),
    onContextMenu: (e: KonvaEventObject<PointerEvent>) => onContextMenu(e, obj.id),
    onDragStart: (e: KonvaEventObject<DragEvent>) => onDragStart(e, obj.id),
    onDragMove: (e: KonvaEventObject<DragEvent>) => onDragMove(e, obj.id),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => onDragEnd(e, obj.id),
    onTransformEnd: (e: KonvaEventObject<Event>) => onTransformEnd(e, obj),
    ...(editable ? {
      onDblClick: (e: KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true;
        onDblClickEdit(obj.id);
      },
    } : {}),
  };

  if (obj.type === "frame") {
    return (
      <Group {...groupProps}>
        <Rect width={obj.width} height={obj.height} fill="rgba(99,102,241,0.06)" stroke="#6366f1" strokeWidth={2} dash={[10, 5]} cornerRadius={4} {...aiGlowProps} />
        <Text x={8} y={-20} text={obj.props.text || "Frame"} fontSize={13} fill="#6366f1" fontStyle="600" />
      </Group>
    );
  }
  if (obj.type === "sticky") {
    return (
      <Group {...groupProps}>
        <Rect width={obj.width} height={obj.height} fill={obj.props.color || "#fbbf24"} cornerRadius={8} shadowBlur={hasAiGlow ? 12 : 5} shadowColor={hasAiGlow ? "rgba(99,102,241,0.5)" : "rgba(0,0,0,0.3)"} />
        <Text x={10} y={10} text={obj.props.text || ""} fontSize={14} fill="#1a1a2e" width={obj.width - 20} />
      </Group>
    );
  }
  if (obj.type === "rect") {
    return (
      <Group {...groupProps}>
        <Rect width={obj.width} height={obj.height} fill={obj.props.fill || "#3b82f6"} stroke={obj.props.stroke || "#2563eb"} strokeWidth={2} cornerRadius={4} {...aiGlowProps} />
      </Group>
    );
  }
  if (obj.type === "circle") {
    return (
      <Group {...groupProps}>
        <Ellipse x={obj.width / 2} y={obj.height / 2} radiusX={obj.width / 2} radiusY={obj.height / 2} fill={obj.props.fill || "#8b5cf6"} stroke={obj.props.stroke || "#7c3aed"} strokeWidth={2} {...aiGlowProps} />
      </Group>
    );
  }
  if (obj.type === "line") {
    const useArrow = obj.props.arrow === "end" || obj.props.arrow === "both";
    const LineComponent = useArrow ? Arrow : KonvaLine;
    return (
      <Group {...groupProps}>
        <LineComponent
          points={[0, 0, obj.width, obj.height]}
          stroke={obj.props.stroke || "#f43f5e"}
          strokeWidth={3}
          hitStrokeWidth={12}
          lineCap="round"
          {...(useArrow ? {
            pointerLength: 12,
            pointerWidth: 10,
            ...(obj.props.arrow === "both" ? { pointerAtBeginning: true } : {}),
          } : {})}
          {...aiGlowLineProps}
        />
      </Group>
    );
  }
  if (obj.type === "text") {
    return (
      <Group {...groupProps}>
        <Text text={obj.props.text || ""} fontSize={16} fill={obj.props.color || "#ffffff"} width={obj.width} />
      </Group>
    );
  }
  if (obj.type === "image") {
    return (
      <Group {...groupProps}>
        <KonvaImageRenderer src={obj.props.src || ""} width={obj.width} height={obj.height} aiGlowProps={aiGlowProps} />
      </Group>
    );
  }
  return null;
});

export function Board({ user, boardId, onLogout, onBack }: { user: AuthUser; boardId: string; onLogout: () => void; onBack: () => void }) {
  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const lastCursorSend = useRef(0);
  const lastDragSendRef = useRef(0);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<string | undefined>();
  const [boardGenStarted, setBoardGenStarted] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objId: string } | null>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());

  // Object fade-in animation tracking
  const wasInitializedRef = useRef(false);
  useEffect(() => { wasInitializedRef.current = initialized; });
  const animatedIdsRef = useRef(new Set<string>());

  // Frame drag-to-create state
  const [frameDraft, setFrameDraft] = useState<{startX: number; startY: number; x: number; y: number; width: number; height: number} | null>(null);
  const frameDraftRef = useRef(frameDraft);
  frameDraftRef.current = frameDraft;
  const [pendingFrame, setPendingFrame] = useState<{x: number; y: number; width: number; height: number} | null>(null);
  const pendingFrameCancelled = useRef(false);

  // Bulk drag state
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const { connectionState, initialized, cursors, textCursors, objects, presence, send, createObject: wsCreate, updateObject: wsUpdate, deleteObject: wsDelete, batchUndo, lastServerMessageAt } = useWebSocket(boardId);

  const { createObject, updateObject, deleteObject, startBatch, commitBatch, undo, redo, pushExternalBatch, topTag } = useUndoRedo(objects, wsCreate, wsUpdate, wsDelete);
  const { aiGlowIds, confettiPos, confettiKey, clearConfetti } = useAiObjectEffects(objects, initialized, scale, stagePos, size);

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
    return () => { if (undoAiTimerRef.current) clearTimeout(undoAiTimerRef.current); };
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
  const { marquee, justFinishedMarqueeRef, startMarquee, updateMarquee, finishMarquee } = useDragSelection({ objectsRef, setSelectedIds });

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
  const placeItems = useCallback((items: BoardObject[]) => {
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
        });
      }
    } finally {
      if (isBatch) commitBatch();
    }
    setSelectedIds(newIds);
  }, [createObject, startBatch, commitBatch, user.id]);

  // Copy selected objects to in-memory clipboard
  const copySelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const copied: BoardObject[] = [];
    for (const id of selectedIds) {
      const obj = objectsRef.current.get(id);
      if (obj) copied.push({ ...obj, props: { ...obj.props } });
    }
    clipboardRef.current = copied;
  }, [selectedIds]);

  // Paste clipboard objects with 20px offset, new UUIDs, select the pasted set
  const pasteClipboard = useCallback(() => {
    const items = clipboardRef.current;
    if (items.length === 0) return;
    placeItems(items);
    // Advance clipboard positions so repeated pastes cascade
    clipboardRef.current = items.map(item => ({
      ...item,
      x: item.x + 20,
      y: item.y + 20,
      props: { ...item.props },
    }));
  }, [placeItems]);

  // Duplicate selected objects with 20px offset without touching the clipboard
  const duplicateSelected = useCallback(() => {
    const items: BoardObject[] = [];
    for (const id of selectedIds) {
      const obj = objectsRef.current.get(id);
      if (obj) items.push({ ...obj, props: { ...obj.props } });
    }
    placeItems(items);
  }, [selectedIds, placeItems]);

  // Apply a color to all selected objects (used by Toolbar color picker)
  const handleColorChange = useCallback((color: string) => {
    const isBatch = selectedIds.size > 1;
    if (isBatch) startBatch();
    try {
      for (const id of selectedIds) {
        const obj = objects.get(id);
        if (!obj) continue;
        const key = obj.type === "sticky" || obj.type === "text" ? "color" : obj.type === "line" ? "stroke" : "fill";
        updateObject({ id, props: { ...obj.props, [key]: color } });
      }
    } finally {
      if (isBatch) commitBatch();
    }
  }, [selectedIds, objects, updateObject, startBatch, commitBatch]);

  // Clear selection if objects were deleted (by another user or AI)
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => objects.has(id)));
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
    selectedIds, editingId, setSelectedIds, setToolMode,
    setChatOpen, setShowShortcuts, deleteSelected,
    copySelected, pasteClipboard, duplicateSelected, undo, redo,
  });

  // Sync Transformer with selected nodes
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (selectedIds.size > 0 && !editingId) {
      const nodes = [...selectedIds]
        .map(id => shapeRefs.current.get(id))
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
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  }, []);

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

  const handleShapeDragMove = useCallback((e: KonvaEventObject<DragEvent>, id: string) => {
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
  }, [send]);

  const handleShapeDragEnd = useCallback((e: KonvaEventObject<DragEvent>, id: string) => {
    const positions = dragStartPositionsRef.current;
    if (positions.size > 0) {
      startBatch();
      try {
        for (const sid of positions.keys()) {
          const node = shapeRefs.current.get(sid);
          if (node) {
            updateObject({ id: sid, x: node.x(), y: node.y() });
          }
        }
        dragStartPositionsRef.current = new Map();
      } finally {
        commitBatch();
      }
    } else {
      updateObject({ id, x: e.target.x(), y: e.target.y() });
    }
  }, [updateObject, startBatch, commitBatch]);

  // Track mouse for cursor sync + marquee (reads stagePos/scale from refs for stability)
  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
    const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;

    // Update marquee if dragging
    updateMarquee(worldX, worldY);

    // Cursor sync (throttled)
    const now = Date.now();
    if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;
    lastCursorSend.current = now;
    send({ type: "cursor", x: worldX, y: worldY });
  }, [send, updateMarquee]);

  // Stage mousedown: marquee (select mode) or frame draft (frame mode)
  const handleStageMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
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
    }
  }, [toolMode, startMarquee]);

  // Stage mouseup: finish marquee or frame draft
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
    }
  }, [finishMarquee]);

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

  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    // Only update stage position when the Stage itself is dragged, not objects
    if (e.target !== stageRef.current) return;
    setStagePos({ x: e.target.x(), y: e.target.y() });
  }, []);

  // Handle object transform (resize + rotate) - shared by all object types
  const handleObjectTransform = useCallback((e: KonvaEventObject<Event>, obj: { id: string; type: string; width: number; height: number }) => {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    // Lines store endpoint delta in width/height - don't clamp to min 20
    const isLine = obj.type === "line";
    updateObject({
      id: obj.id,
      x: node.x(),
      y: node.y(),
      width: isLine ? Math.round(obj.width * sx) : Math.max(20, Math.round(obj.width * sx)),
      height: isLine ? Math.round(obj.height * sy) : Math.max(20, Math.round(obj.height * sy)),
      rotation: node.rotation(),
    });
    // Re-sync Transformer bounding box after scale reset
    requestAnimationFrame(() => {
      trRef.current?.forceUpdate();
      trRef.current?.getLayer()?.batchDraw();
    });
  }, [updateObject]);

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

  // Combined stage mouse move: cursor sync + marquee tracking + frame draft
  const handleStageMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    handleMouseMove(e); // cursor sync (throttled) + marquee tracking
    if (!frameDraftRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
    const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;
    setFrameDraft(prev => {
      if (!prev) return null;
      return {
        ...prev,
        x: Math.min(prev.startX, worldX),
        y: Math.min(prev.startY, worldY),
        width: Math.abs(worldX - prev.startX),
        height: Math.abs(worldY - prev.startY),
      };
    });
  }, [handleMouseMove]);

  const commitPendingFrame = useCallback((title: string) => {
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
  }, [pendingFrame, createObject, user.id]);

  // Double-click on empty canvas -> create object based on active tool
  const handleStageDblClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.target !== stageRef.current) return;
    if (toolMode === "select" || toolMode === "frame") return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const worldX = (pointer.x - stagePosRef.current.x) / scaleRef.current;
    const worldY = (pointer.y - stagePosRef.current.y) / scaleRef.current;

    setSelectedIds(new Set());

    if (toolMode === "sticky") {
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
    } else if (toolMode === "rect") {
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
    } else if (toolMode === "circle") {
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
    } else if (toolMode === "line") {
      createObject({
        id: crypto.randomUUID(),
        type: "line",
        x: worldX - 100,
        y: worldY,
        width: 200,
        height: 0,
        rotation: 0,
        props: { stroke: "#f43f5e" },
        createdBy: user.id,
        updatedAt: Date.now(),
      });
    } else if (toolMode === "arrow") {
      createObject({
        id: crypto.randomUUID(),
        type: "line",
        x: worldX - 90,
        y: worldY + 40,
        width: 180,
        height: -80,
        rotation: 0,
        props: { stroke: "#f43f5e", arrow: "end" },
        createdBy: user.id,
        updatedAt: Date.now(),
      });
    } else if (toolMode === "text") {
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
    }
  }, [createObject, user.id, toolMode]);

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: colors.bg, cursor: toolCursors[toolMode] || "default" }}>
      {/* Header */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 48, zIndex: 10,
        background: "rgba(22, 33, 62, 0.9)", borderBottom: "1px solid #334155",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", color: "#eee", fontSize: "0.875rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "#94a3b8", cursor: "pointer",
            fontSize: "0.875rem", padding: 0,
          }}>&larr; Boards</button>
          <span style={{ fontWeight: 600 }}>CollabBoard</span>
          <span data-testid="connection-state" data-state={connectionState} style={{
            width: 8, height: 8, borderRadius: "50%", display: "inline-block",
            background: { connected: colors.success, reconnecting: colors.warning, connecting: colors.info, disconnected: colors.error }[connectionState],
          }} title={connectionState} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Presence avatars */}
          <div style={{ display: "flex", gap: 4 }}>
            {presence.map((p) => {
              const isAi = p.id === AI_USER_ID;
              return (
                <span key={p.id} style={{
                  background: isAi ? colors.aiCursor : colors.accent,
                  borderRadius: "50%", width: 24, height: 24,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.625rem", fontWeight: 600, color: "#fff",
                }} title={p.username}>
                  {isAi ? "AI" : p.username[0].toUpperCase()}
                </span>
              );
            })}
          </div>
          <span style={{ color: "#888" }}>{Math.round(scale * 100)}%</span>
          <span>{user.displayName}</span>
          <button onClick={() => {
            navigator.clipboard.writeText(`${location.origin}/#replay/${boardId}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }} style={{ background: "none", border: "1px solid #475569", borderRadius: 4, color: "#94a3b8", padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem" }}>
            {copied ? "Copied!" : "Share Scene"}
          </button>
          <button onClick={handleLogout} style={{ background: "none", border: "1px solid #475569", borderRadius: 4, color: "#94a3b8", padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem" }}>
            Logout
          </button>
        </div>
      </div>

      {/* Connection status toast */}
      <ConnectionToast connectionState={connectionState} />
      {/* Loading skeleton while WebSocket connects */}
      {!initialized && connectionState !== "disconnected" && (
        <div style={{
          position: "absolute", inset: 0, top: 48, display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 5, pointerEvents: "none",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 80, height: 80, borderRadius: 8,
                  background: "rgba(255,255,255,0.06)",
                  animation: `cb-pulse 1.5s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.875rem" }}>
              Loading board...
            </div>
          </div>
        </div>
      )}

      {/* Onboard modal - shown on empty boards until user starts a scene or dismisses */}
      {initialized && objects.size === 0 && !boardGenStarted && !chatOpen && (
        <OnboardModal
          onSubmit={(prompt) => {
            setBoardGenStarted(true);
            setChatInitialPrompt(prompt);
            setChatOpen(true);
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
        draggable={toolMode !== "select" && toolMode !== "frame"}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
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
          {[...objects.values()].filter(o => o.type === "frame").map((obj) => (
            <BoardObjectRenderer
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
          {/* Pass 2: non-frame objects */}
          {[...objects.values()].filter(o => o.type !== "frame").map((obj) => (
            <BoardObjectRenderer
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
          {[...textCursors.values()].map(tc => {
            if (tc.objectId === editingId) return null; // local user editing same object - caret shown in textarea overlay
            const obj = objects.get(tc.objectId);
            if (!obj) return null;
            const color = getUserColor(tc.userId);
            return (
              <React.Fragment key={tc.userId}>
                <Rect
                  x={obj.x} y={obj.y}
                  width={obj.width} height={obj.height}
                  stroke={color} strokeWidth={2 / scale}
                  fill="transparent"
                  dash={[6 / scale, 3 / scale]}
                  listening={false}
                  rotation={obj.rotation || 0}
                />
                <Text
                  x={obj.x} y={obj.y - 18 / scale}
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
              x={marquee.x} y={marquee.y}
              width={marquee.w} height={marquee.h}
              fill={colors.accentSubtle}
              stroke={colors.accent} strokeWidth={1}
              dash={[6, 3]} listening={false}
            />
          )}

          {/* Selection transformer */}
          <Transformer
            ref={trRef}
            flipEnabled={false}
            rotateEnabled={true}
            boundBoxFunc={(_oldBox, newBox) => {
              // Lines can have near-zero dimensions in one axis - only clamp shapes
              const hasLineSelected = [...selectedIdsRef.current].some(id => objectsRef.current.get(id)?.type === "line");
              if (!hasLineSelected && (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20)) return _oldBox;
              return newBox;
            }}
            borderStroke={colors.accent}
            anchorStroke={colors.accent}
            anchorFill="#fff"
            anchorSize={8}
            padding={5}
            anchorCornerRadius={2}
          />
        </Layer>

        {/* Cursor layer on top */}
        <Layer>
          <Cursors cursors={cursors} />
        </Layer>
      </Stage>

      {/* Inline text editing overlay */}
      {editingId && (() => {
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
                  updateObject({ id: editingId, props: { ...obj.props, text: (e.target as HTMLInputElement).value } });
                  send({ type: "text:blur", objectId: editingId });
                  setEditingId(null);
                }
              }}
            />
          );
        }
        const isText = obj.type === "text";
        const remoteCarets = [...textCursors.values()].filter(tc => tc.objectId === editingId);
        return (
          <>
            <textarea
              ref={textareaRef}
              autoFocus
              defaultValue={obj.props.text || ""}
              style={{
                position: "absolute",
                left: obj.x * scale + stagePos.x,
                top: obj.y * scale + stagePos.y,
                width: obj.width * scale,
                height: obj.height * scale,
                background: isText ? "transparent" : (obj.props.color || "#fbbf24"),
                border: isText ? "2px solid #60a5fa" : "2px solid #f59e0b",
                borderRadius: isText ? 4 * scale : 8 * scale,
                padding: isText ? 4 * scale : 10 * scale,
                fontSize: isText ? 16 * scale : 14 * scale,
                color: isText ? (obj.props.color || "#ffffff") : "#1a1a2e",
                resize: "none",
                outline: "none",
                zIndex: 20,
                boxSizing: "border-box" as const,
                fontFamily: "inherit",
                transform: `rotate(${obj.rotation || 0}deg)`,
                transformOrigin: "0 0",
              }}
              onChange={(e) => {
                updateObject({ id: editingId, props: { ...obj.props, text: e.target.value } });
                send({ type: "text:cursor", objectId: editingId, position: e.target.selectionStart ?? 0 });
              }}
              onSelect={(e) => {
                send({ type: "text:cursor", objectId: editingId, position: (e.target as HTMLTextAreaElement).selectionStart ?? 0 });
              }}
              onBlur={(e) => {
                updateObject({ id: editingId, props: { ...obj.props, text: e.target.value } });
                send({ type: "text:blur", objectId: editingId });
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  updateObject({ id: editingId, props: { ...obj.props, text: (e.target as HTMLTextAreaElement).value } });
                  send({ type: "text:blur", objectId: editingId });
                  setEditingId(null);
                }
              }}
            />
            {/* Remote user carets inside this textarea */}
            {remoteCarets.map(tc => {
              const ta = textareaRef.current;
              if (!ta) return null;
              const pos = getCaretPixelPos(ta, tc.position);
              const color = getUserColor(tc.userId);
              const lineH = parseInt(window.getComputedStyle(ta).lineHeight) || Math.round((isText ? 16 : 14) * scale * 1.4);
              return (
                <div key={tc.userId} style={{
                  position: "absolute",
                  left: obj.x * scale + stagePos.x + pos.x,
                  top: obj.y * scale + stagePos.y + pos.y,
                  width: 2,
                  height: lineH,
                  background: color,
                  pointerEvents: "none",
                  zIndex: 21,
                }}>
                  <div style={{
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
                  }}>{tc.username}</div>
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
            if (pendingFrameCancelled.current) { pendingFrameCancelled.current = false; return; }
            commitPendingFrame(e.target.value);
          }}
        />
      )}

      {/* Toolbar + Color Picker + Zoom + Shortcuts */}
      <Toolbar
        toolMode={toolMode} setToolMode={setToolMode}
        selectedIds={selectedIds} objects={objects}
        chatOpen={chatOpen} setChatOpen={setChatOpen}
        showShortcuts={showShortcuts} setShowShortcuts={setShowShortcuts}
        deleteSelected={deleteSelected}
        onColorChange={handleColorChange}
        onZoomIn={() => setScale((s) => Math.min(MAX_ZOOM, s * 1.2))}
        onZoomOut={() => setScale((s) => Math.max(MIN_ZOOM, s / 1.2))}
        onZoomReset={() => { setScale(1); setStagePos({ x: 0, y: 0 }); }}
      />

      {/* AI Chat Panel */}
      {chatOpen && (
        <ChatPanel
          boardId={boardId}
          username={user.username}
          onClose={() => {
            setChatOpen(false);
            setChatInitialPrompt(undefined);
            if (objects.size === 0) setBoardGenStarted(false);
          }}
          initialPrompt={chatInitialPrompt}
          selectedIds={selectedIds}
          onAIComplete={handleAIComplete}
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
      {contextMenu && (() => {
        const obj = objects.get(contextMenu.objId);
        if (!obj) return null;
        const items: { label: string; prompt: string }[] = [
          { label: "Ask AI about this", prompt: `What is this ${obj.type}${obj.props.text ? ` that says "${obj.props.text}"` : ""} about?` },
          { label: "Recolor with AI", prompt: `Change the color of this ${obj.type} (id: ${obj.id}) to a random vibrant color.` },
        ];
        if (obj.type === "sticky" || obj.type === "text") {
          items.push({ label: "Expand on this", prompt: `Create more sticky notes related to: "${obj.props.text || ""}"` });
        }
        return (
          <div
            onClick={() => setContextMenu(null)}
            style={{ position: "absolute", inset: 0, zIndex: 40 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute", left: contextMenu.x, top: contextMenu.y,
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 8, padding: 4, minWidth: 180, zIndex: 41,
              }}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  onClick={() => { setSelectedIds(new Set([contextMenu.objId])); openChatWithPrompt(item.prompt); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: "none", border: "none", color: colors.text,
                    padding: "8px 12px", cursor: "pointer", fontSize: "0.8125rem",
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.accentSubtle; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
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

const TOAST_CONFIG: Record<ConnectionState, { label: string; bg: string; border: string }> = {
  connecting: { label: "Connecting...", bg: "#78350f", border: "#f59e0b" },
  connected: { label: "Connected", bg: "#065f46", border: "#10b981" },
  reconnecting: { label: "Reconnecting...", bg: "#78350f", border: "#f59e0b" },
  disconnected: { label: "Disconnected", bg: "#7f1d1d", border: "#ef4444" },
};

function ConnectionToast({ connectionState }: { connectionState: ConnectionState }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    clearTimeout(timer.current!);
    if (connectionState === "connecting") return;

    setShow(true);
    if (connectionState === "connected") {
      timer.current = setTimeout(() => setShow(false), 3000);
    }

    return () => clearTimeout(timer.current!);
  }, [connectionState]);

  if (!show) return null;

  const c = TOAST_CONFIG[connectionState];
  return (
    <div style={{
      position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)",
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6,
      padding: "6px 16px", color: "#fff", fontSize: "0.8rem", zIndex: 30,
    }}>
      {c.label}
    </div>
  );
}


