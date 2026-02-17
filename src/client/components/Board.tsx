import React, { useState, useRef, useCallback, useEffect } from "react";
import { Stage, Layer, Rect, Text, Group, Transformer, Ellipse, Line as KonvaLine, Arrow } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import type { AuthUser } from "../App";
import { useWebSocket, type ConnectionState } from "../hooks/useWebSocket";
import { useUndoRedo } from "../hooks/useUndoRedo";

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connected: "#4ade80",
  reconnecting: "#facc15",
  connecting: "#94a3b8",
  disconnected: "#f87171",
};
import { Cursors } from "./Cursors";
import { ChatPanel } from "./ChatPanel";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const CURSOR_THROTTLE_MS = 33; // ~30fps

type ToolMode = "select" | "sticky" | "rect" | "circle" | "line" | "arrow" | "text" | "frame";

const COLOR_PRESETS = [
  "#fbbf24", // amber (sticky default)
  "#f87171", // red
  "#fb923c", // orange
  "#4ade80", // green
  "#3b82f6", // blue (rect default)
  "#a78bfa", // purple
  "#f472b6", // pink
  "#94a3b8", // slate
];

const SIDEBAR_W = 48;

/** Check if two axis-aligned bounding boxes intersect */
function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.w > b.x && a.y < b.y + b.height && a.y + a.h > b.y;
}

export function Board({ user, boardId, onLogout, onBack }: { user: AuthUser; boardId: string; onLogout: () => void; onBack: () => void }) {
  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const lastCursorSend = useRef(0);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [chatOpen, setChatOpen] = useState(false);
  const trRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());

  // Marquee selection state
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingMarqueeRef = useRef(false);
  const justFinishedMarqueeRef = useRef(false);

  // Frame drag-to-create state
  const [frameDraft, setFrameDraft] = useState<{startX: number; startY: number; x: number; y: number; width: number; height: number} | null>(null);
  const [pendingFrame, setPendingFrame] = useState<{x: number; y: number; width: number; height: number} | null>(null);
  const pendingFrameCancelled = useRef(false);

  // Bulk drag state
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const { connectionState, initialized, cursors, objects, presence, send, createObject: wsCreate, updateObject: wsUpdate, deleteObject: wsDelete } = useWebSocket(boardId);
  const { createObject, updateObject, deleteObject, startBatch, commitBatch, undo, redo } = useUndoRedo(objects, wsCreate, wsUpdate, wsDelete);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") { setSelectedIds(new Set()); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "v" || e.key === "V") setToolMode("select");
      if (e.key === "s" || e.key === "S") setToolMode("sticky");
      if (e.key === "r" || e.key === "R") setToolMode("rect");
      if (e.key === "c" || e.key === "C") setToolMode("circle");
      if (e.key === "l" || e.key === "L") setToolMode("line");
      if (e.key === "a" || e.key === "A") setToolMode("arrow");
      if (e.key === "t" || e.key === "T") setToolMode("text");
      if (e.key === "f" || e.key === "F") setToolMode("frame");
      if (e.key === "/") { e.preventDefault(); setChatOpen((o) => !o); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !editingId) {
        e.preventDefault();
        if (selectedIds.size > 1) startBatch();
        for (const id of selectedIds) deleteObject(id);
        if (selectedIds.size > 1) commitBatch();
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, editingId, deleteObject, startBatch, commitBatch, undo, redo]);

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

  // Bulk drag handlers
  const handleShapeDragStart = useCallback((_e: KonvaEventObject<DragEvent>, id: string) => {
    if (selectedIds.has(id) && selectedIds.size > 1) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const sid of selectedIds) {
        const node = shapeRefs.current.get(sid);
        if (node) positions.set(sid, { x: node.x(), y: node.y() });
      }
      dragStartPositionsRef.current = positions;
    } else {
      dragStartPositionsRef.current = new Map();
    }
  }, [selectedIds]);

  const handleShapeDragMove = useCallback((e: KonvaEventObject<DragEvent>, id: string) => {
    const positions = dragStartPositionsRef.current;
    if (positions.size === 0) return;
    const startPos = positions.get(id);
    if (!startPos) return;
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
  }, []);

  const handleShapeDragEnd = useCallback((e: KonvaEventObject<DragEvent>, id: string) => {
    const positions = dragStartPositionsRef.current;
    if (positions.size > 0) {
      startBatch();
      for (const sid of positions.keys()) {
        const node = shapeRefs.current.get(sid);
        if (node) {
          updateObject({ id: sid, x: node.x(), y: node.y() });
        }
      }
      commitBatch();
      dragStartPositionsRef.current = new Map();
    } else {
      updateObject({ id, x: e.target.x(), y: e.target.y() });
    }
  }, [updateObject, startBatch, commitBatch]);

  // Track mouse for cursor sync + marquee
  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;

    // Update marquee if dragging
    if (isDraggingMarqueeRef.current && marqueeStartRef.current) {
      const start = marqueeStartRef.current;
      setMarquee({
        x: Math.min(start.x, worldX),
        y: Math.min(start.y, worldY),
        w: Math.abs(worldX - start.x),
        h: Math.abs(worldY - start.y),
      });
    }

    // Cursor sync (throttled)
    const now = Date.now();
    if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;
    lastCursorSend.current = now;
    send({ type: "cursor", x: worldX, y: worldY });
  }, [send, stagePos, scale]);

  // Stage mousedown: marquee (select mode) or frame draft (frame mode)
  const handleStageMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.target !== stageRef.current) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;

    if (toolMode === "select") {
      marqueeStartRef.current = { x: worldX, y: worldY };
      isDraggingMarqueeRef.current = true;
    } else if (toolMode === "frame") {
      setFrameDraft({ startX: worldX, startY: worldY, x: worldX, y: worldY, width: 0, height: 0 });
    }
  }, [toolMode, stagePos, scale]);

  // Stage mouseup: finish marquee or frame draft
  const handleStageMouseUp = useCallback(() => {
    // Marquee selection finish
    if (isDraggingMarqueeRef.current) {
      isDraggingMarqueeRef.current = false;
      if (marquee && (marquee.w > 5 || marquee.h > 5)) {
        const selected = new Set<string>();
        for (const obj of objects.values()) {
          if (rectsIntersect(marquee, obj)) {
            selected.add(obj.id);
          }
        }
        setSelectedIds(selected);
        justFinishedMarqueeRef.current = true;
      }
      setMarquee(null);
      marqueeStartRef.current = null;
      return;
    }
    // Frame creation finish
    if (frameDraft) {
      if (frameDraft.width >= 20 && frameDraft.height >= 20) {
        setPendingFrame({ x: frameDraft.x, y: frameDraft.y, width: frameDraft.width, height: frameDraft.height });
      }
      setFrameDraft(null);
    }
  }, [marquee, objects, frameDraft]);

  // Zoom toward cursor on wheel
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.08;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, direction > 0 ? oldScale * factor : oldScale / factor));

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    setScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, [scale, stagePos]);

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
  }, [updateObject]);

  // Ref callback to track shape nodes for Transformer
  const setShapeRef = useCallback((id: string) => {
    return (node: Konva.Group | null) => {
      if (node) shapeRefs.current.set(id, node);
      else shapeRefs.current.delete(id);
    };
  }, []);

  // Combined stage mouse move: cursor sync + marquee tracking + frame draft
  const handleStageMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    handleMouseMove(e); // cursor sync (throttled) + marquee tracking
    if (!frameDraft) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;
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
  }, [handleMouseMove, frameDraft, stagePos, scale]);

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

    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;

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
  }, [stagePos, scale, createObject, user.id, toolMode]);

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1a1a2e" }}>
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
          <span style={{
            width: 8, height: 8, borderRadius: "50%", display: "inline-block",
            background: CONNECTION_COLORS[connectionState],
          }} title={connectionState} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Presence avatars */}
          <div style={{ display: "flex", gap: 4 }}>
            {presence.map((p) => (
              <span key={p.id} style={{
                background: "#3b82f6", borderRadius: "50%", width: 24, height: 24,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.625rem", fontWeight: 600, color: "#fff",
              }} title={p.username}>
                {p.username[0].toUpperCase()}
              </span>
            ))}
          </div>
          <span style={{ color: "#888" }}>{Math.round(scale * 100)}%</span>
          <span>{user.displayName}</span>
          <button onClick={handleLogout} style={{ background: "none", border: "1px solid #475569", borderRadius: 4, color: "#94a3b8", padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem" }}>
            Logout
          </button>
        </div>
      </div>

      {/* Connection status toast */}
      <ConnectionToast connectionState={connectionState} />
      <style>{`@keyframes cb-pulse { 0%,100% { opacity: 0.4 } 50% { opacity: 1 } }`}</style>

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

      {/* Empty board hint */}
      {initialized && objects.size === 0 && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          textAlign: "center", pointerEvents: "none", zIndex: 5, color: "rgba(255,255,255,0.35)",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>+</div>
          <div style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
            Double-click to add a sticky, or use the toolbar
          </div>
        </div>
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
          {renderGrid(stagePos, scale, size)}

          {/* Pass 1: frames (behind everything) */}
          {[...objects.values()].filter(o => o.type === "frame").map((obj) => (
            <Group
              key={obj.id}
              ref={setShapeRef(obj.id)}
              x={obj.x}
              y={obj.y}
              rotation={obj.rotation}
              draggable
              onClick={(e) => handleShapeClick(e, obj.id)}
              onDragStart={(e) => handleShapeDragStart(e, obj.id)}
              onDragMove={(e) => handleShapeDragMove(e, obj.id)}
              onDragEnd={(e) => handleShapeDragEnd(e, obj.id)}
              onDblClick={(e) => {
                e.cancelBubble = true;
                setSelectedIds(new Set());
                setEditingId(obj.id);
              }}
              onTransformEnd={(e) => handleObjectTransform(e, obj)}
            >
              <Rect
                width={obj.width}
                height={obj.height}
                fill="rgba(99,102,241,0.06)"
                stroke="#6366f1"
                strokeWidth={2}
                dash={[10, 5]}
                cornerRadius={4}
              />
              <Text
                x={8}
                y={-20}
                text={obj.props.text || "Frame"}
                fontSize={13}
                fill="#6366f1"
                fontStyle="600"
              />
            </Group>
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
          {[...objects.values()].filter(o => o.type !== "frame").map((obj) => {
            if (obj.type === "sticky") {
              return (
                <Group
                  key={obj.id}
                  ref={setShapeRef(obj.id)}
                  x={obj.x}
                  y={obj.y}
                  rotation={obj.rotation}
                  draggable
                  onClick={(e) => handleShapeClick(e, obj.id)}
                  onDragStart={(e) => handleShapeDragStart(e, obj.id)}
                  onDragMove={(e) => handleShapeDragMove(e, obj.id)}
                  onDragEnd={(e) => handleShapeDragEnd(e, obj.id)}
                  onDblClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedIds(new Set());
                    setEditingId(obj.id);
                  }}
                  onTransformEnd={(e) => handleObjectTransform(e, obj)}
                >
                  <Rect
                    width={obj.width} height={obj.height}
                    fill={obj.props.color || "#fbbf24"}
                    cornerRadius={8}
                    shadowBlur={5} shadowColor="rgba(0,0,0,0.3)"
                  />
                  <Text
                    x={10} y={10}
                    text={obj.props.text || ""}
                    fontSize={14} fill="#1a1a2e"
                    width={obj.width - 20}
                  />
                </Group>
              );
            }
            if (obj.type === "rect") {
              return (
                <Group
                  key={obj.id}
                  ref={setShapeRef(obj.id)}
                  x={obj.x}
                  y={obj.y}
                  rotation={obj.rotation}
                  draggable
                  onClick={(e) => handleShapeClick(e, obj.id)}
                  onDragStart={(e) => handleShapeDragStart(e, obj.id)}
                  onDragMove={(e) => handleShapeDragMove(e, obj.id)}
                  onDragEnd={(e) => handleShapeDragEnd(e, obj.id)}
                  onTransformEnd={(e) => handleObjectTransform(e, obj)}
                >
                  <Rect
                    width={obj.width} height={obj.height}
                    fill={obj.props.fill || "#3b82f6"}
                    stroke={obj.props.stroke || "#2563eb"}
                    strokeWidth={2}
                    cornerRadius={4}
                  />
                </Group>
              );
            }
            if (obj.type === "circle") {
              return (
                <Group
                  key={obj.id}
                  ref={setShapeRef(obj.id)}
                  x={obj.x}
                  y={obj.y}
                  rotation={obj.rotation}
                  draggable
                  onClick={(e) => handleShapeClick(e, obj.id)}
                  onDragStart={(e) => handleShapeDragStart(e, obj.id)}
                  onDragMove={(e) => handleShapeDragMove(e, obj.id)}
                  onDragEnd={(e) => handleShapeDragEnd(e, obj.id)}
                  onTransformEnd={(e) => handleObjectTransform(e, obj)}
                >
                  <Ellipse
                    x={obj.width / 2}
                    y={obj.height / 2}
                    radiusX={obj.width / 2}
                    radiusY={obj.height / 2}
                    fill={obj.props.fill || "#8b5cf6"}
                    stroke={obj.props.stroke || "#7c3aed"}
                    strokeWidth={2}
                  />
                </Group>
              );
            }
            if (obj.type === "line") {
              const useArrow = obj.props.arrow === "end" || obj.props.arrow === "both";
              const LineComponent = useArrow ? Arrow : KonvaLine;
              return (
                <Group
                  key={obj.id}
                  ref={setShapeRef(obj.id)}
                  x={obj.x}
                  y={obj.y}
                  rotation={obj.rotation}
                  draggable
                  onClick={(e) => handleShapeClick(e, obj.id)}
                  onDragStart={(e) => handleShapeDragStart(e, obj.id)}
                  onDragMove={(e) => handleShapeDragMove(e, obj.id)}
                  onDragEnd={(e) => handleShapeDragEnd(e, obj.id)}
                  onTransformEnd={(e) => handleObjectTransform(e, obj)}
                >
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
                  />
                </Group>
              );
            }
            if (obj.type === "text") {
              return (
                <Group
                  key={obj.id}
                  ref={setShapeRef(obj.id)}
                  x={obj.x}
                  y={obj.y}
                  rotation={obj.rotation}
                  draggable
                  onClick={(e) => handleShapeClick(e, obj.id)}
                  onDragStart={(e) => handleShapeDragStart(e, obj.id)}
                  onDragMove={(e) => handleShapeDragMove(e, obj.id)}
                  onDragEnd={(e) => handleShapeDragEnd(e, obj.id)}
                  onDblClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedIds(new Set());
                    setEditingId(obj.id);
                  }}
                  onTransformEnd={(e) => handleObjectTransform(e, obj)}
                >
                  <Text
                    text={obj.props.text || ""}
                    fontSize={16}
                    fill={obj.props.color || "#ffffff"}
                    width={obj.width}
                  />
                </Group>
              );
            }
            return null;
          })}

          {/* Marquee selection visualization */}
          {marquee && (
            <Rect
              x={marquee.x} y={marquee.y}
              width={marquee.w} height={marquee.h}
              fill="rgba(59, 130, 246, 0.1)"
              stroke="#3b82f6" strokeWidth={1}
              dash={[6, 3]} listening={false}
            />
          )}

          {/* Selection transformer */}
          <Transformer
            ref={trRef}
            flipEnabled={false}
            rotateEnabled={true}
            boundBoxFunc={(_oldBox, newBox) => {
              if (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20) return _oldBox;
              return newBox;
            }}
            borderStroke="#0084FF"
            anchorStroke="#0084FF"
            anchorFill="#fff"
            anchorSize={8}
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
              }}
              onBlur={(e) => {
                updateObject({ id: editingId, props: { ...obj.props, text: e.target.value } });
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  updateObject({ id: editingId, props: { ...obj.props, text: (e.target as HTMLInputElement).value } });
                  setEditingId(null);
                }
              }}
            />
          );
        }
        const isText = obj.type === "text";
        return (
          <textarea
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
            }}
            onBlur={(e) => {
              updateObject({ id: editingId, props: { ...obj.props, text: e.target.value } });
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                updateObject({ id: editingId, props: { ...obj.props, text: (e.target as HTMLTextAreaElement).value } });
                setEditingId(null);
              }
            }}
          />
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

      {/* Vertical Toolbar - Left Sidebar */}
      <div style={{
        position: "absolute", left: 0, top: 48, bottom: 0, width: SIDEBAR_W, zIndex: 10,
        background: "rgba(22, 33, 62, 0.95)", borderRight: "1px solid #334155",
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 8, gap: 2,
      }}>
        <ToolIconBtn icon={<IconSelect />} title="Select (V)" active={toolMode === "select"} onClick={() => setToolMode("select")} />
        <ToolIconBtn icon={<IconSticky />} title="Sticky note (S)" active={toolMode === "sticky"} onClick={() => setToolMode("sticky")} />
        <ToolIconBtn icon={<IconRect />} title="Rectangle (R)" active={toolMode === "rect"} onClick={() => setToolMode("rect")} />
        <ToolIconBtn icon={<IconCircle />} title="Circle (C)" active={toolMode === "circle"} onClick={() => setToolMode("circle")} />
        <ToolIconBtn icon={<IconLine />} title="Line (L)" active={toolMode === "line"} onClick={() => setToolMode("line")} />
        <ToolIconBtn icon={<IconArrow />} title="Arrow (A)" active={toolMode === "arrow"} onClick={() => setToolMode("arrow")} />
        <ToolIconBtn icon={<IconText />} title="Text (T)" active={toolMode === "text"} onClick={() => setToolMode("text")} />
        <ToolIconBtn icon={<IconFrame />} title="Frame (F)" active={toolMode === "frame"} onClick={() => setToolMode("frame")} />
        <div style={{ width: 28, borderTop: "1px solid #334155", margin: "4px 0" }} />
        <ToolIconBtn
          icon={<IconDelete />}
          title="Delete selected (Del)"
          active={false}
          onClick={() => {
            if (selectedIds.size > 0) {
              if (selectedIds.size > 1) startBatch();
              for (const id of selectedIds) deleteObject(id);
              if (selectedIds.size > 1) commitBatch();
              setSelectedIds(new Set());
            }
          }}
          disabled={selectedIds.size === 0}
        />
        <div style={{ flex: 1 }} />
        <ToolIconBtn icon={<IconChat />} title="AI Assistant (/)" active={chatOpen} onClick={() => setChatOpen((o) => !o)} />
        <div style={{ height: 8 }} />
      </div>

      {/* AI Chat Panel */}
      {chatOpen && <ChatPanel boardId={boardId} onClose={() => setChatOpen(false)} />}

      {/* Color picker - shown when objects are selected */}
      {selectedIds.size > 0 && (() => {
        const firstId = [...selectedIds][0];
        const firstObj = objects.get(firstId);
        if (!firstObj) return null;
        if (firstObj.type === "frame") return null;
        const propKey = firstObj.type === "sticky" || firstObj.type === "text" ? "color" : firstObj.type === "line" ? "stroke" : "fill";
        const currentColor = firstObj.props[propKey];
        return (
          <div style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 6, zIndex: 10, padding: "6px 10px",
            background: "rgba(22, 33, 62, 0.95)", border: "1px solid #334155",
            borderRadius: 8,
          }}>
            {COLOR_PRESETS.map((color) => (
              <button
                key={color}
                title={color}
                onClick={() => {
                  if (selectedIds.size > 1) startBatch();
                  for (const id of selectedIds) {
                    const obj = objects.get(id);
                    if (!obj) continue;
                    const key = obj.type === "sticky" || obj.type === "text" ? "color" : obj.type === "line" ? "stroke" : "fill";
                    updateObject({ id, props: { ...obj.props, [key]: color } });
                  }
                  if (selectedIds.size > 1) commitBatch();
                }}
                style={{
                  width: 28, height: 28, borderRadius: "50%", border: "2px solid",
                  borderColor: currentColor === color ? "#fff" : "transparent",
                  background: color, cursor: "pointer", padding: 0,
                  outline: currentColor === color ? "2px solid #3b82f6" : "none",
                  outlineOffset: 1,
                }}
              />
            ))}
          </div>
        );
      })()}

      {/* Zoom controls */}
      <div style={{ position: "absolute", bottom: 16, right: 16, display: "flex", gap: 4, zIndex: 10 }}>
        <ZoomBtn label="-" onClick={() => setScale((s) => Math.max(MIN_ZOOM, s / 1.2))} />
        <ZoomBtn label="Reset" onClick={() => { setScale(1); setStagePos({ x: 0, y: 0 }); }} />
        <ZoomBtn label="+" onClick={() => setScale((s) => Math.min(MAX_ZOOM, s * 1.2))} />
      </div>
    </div>
  );
}

function ToolIconBtn({ icon, title, active, onClick, disabled }: {
  icon: React.ReactNode; title: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
      background: active ? "#3b82f6" : "transparent",
      border: active ? "1px solid #60a5fa" : "1px solid transparent",
      borderRadius: 6, color: disabled ? "#475569" : active ? "#fff" : "#94a3b8",
      cursor: disabled ? "default" : "pointer", padding: 0,
    }}>
      {icon}
    </button>
  );
}

function IconSelect() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4l7.07 16.97 2.51-7.39 7.39-2.51L4 4z"/>
      <path d="M13.5 13.5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

function IconSticky() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8.5L15.5 3z"/>
      <polyline points="14 3 14 9 21 9"/>
    </svg>
  );
}

function IconRect() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
    </svg>
  );
}

function IconCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9"/>
    </svg>
  );
}

function IconLine() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="5" y1="19" x2="19" y2="5"/>
    </svg>
  );
}

function IconArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="19" x2="17" y2="7"/>
      <polyline points="10 7 17 7 17 14"/>
    </svg>
  );
}

function IconText() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  );
}

function IconFrame() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="16" rx="2" strokeDasharray="4 2"/>
      <line x1="3" y1="5" x2="10" y2="5" strokeWidth="2.5"/>
    </svg>
  );
}

function IconDelete() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  );
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: label === "Reset" ? 52 : 32, height: 32,
      background: "rgba(22, 33, 62, 0.9)", border: "1px solid #334155",
      borderRadius: 4, color: "#eee", cursor: "pointer", fontSize: "0.875rem",
    }}>
      {label}
    </button>
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

function renderGrid(pos: { x: number; y: number }, scale: number, size: { width: number; height: number }) {
  const gridSize = 50;
  const dots: React.ReactElement[] = [];
  const startX = Math.floor(-pos.x / scale / gridSize) * gridSize - gridSize;
  const startY = Math.floor(-pos.y / scale / gridSize) * gridSize - gridSize;
  const endX = startX + size.width / scale + gridSize * 2;
  const endY = startY + size.height / scale + gridSize * 2;
  const maxDots = 2000;
  let count = 0;
  for (let x = startX; x < endX; x += gridSize) {
    for (let y = startY; y < endY; y += gridSize) {
      if (count++ >= maxDots) break;
      dots.push(<Rect key={`${x},${y}`} x={x - 1} y={y - 1} width={2} height={2} fill="rgba(255,255,255,0.08)" listening={false} />);
    }
    if (count >= maxDots) break;
  }
  return dots;
}
