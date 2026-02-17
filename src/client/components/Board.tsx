import React, { useState, useRef, useCallback, useEffect } from "react";
import { Stage, Layer, Rect, Text, Group, Transformer } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import type { AuthUser } from "../App";
import { useWebSocket, type ConnectionState } from "../hooks/useWebSocket";

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

type ToolMode = "sticky" | "rect";

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

export function Board({ user, boardId, onLogout, onBack }: { user: AuthUser; boardId: string; onLogout: () => void; onBack: () => void }) {
  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const lastCursorSend = useRef(0);
  const [toolMode, setToolMode] = useState<ToolMode>("sticky");
  const [chatOpen, setChatOpen] = useState(false);
  const trRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Group>>(new Map());

  const { connectionState, initialized, cursors, objects, presence, send, createObject, updateObject, deleteObject } = useWebSocket(boardId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Clear selection if object was deleted (by another user or AI)
  useEffect(() => {
    if (selectedId && !objects.has(selectedId)) setSelectedId(null);
  }, [selectedId, objects]);

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
      if (e.key === "Escape") { setSelectedId(null); return; }
      if (e.key === "s" || e.key === "S") setToolMode("sticky");
      if (e.key === "r" || e.key === "R") setToolMode("rect");
      if (e.key === "/") { e.preventDefault(); setChatOpen((o) => !o); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, editingId, deleteObject]);

  // Sync Transformer with selected node
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (selectedId && !editingId) {
      const node = shapeRefs.current.get(selectedId);
      if (node) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
  }, [selectedId, editingId, objects]);

  // Track mouse for cursor sync
  const handleMouseMove = useCallback((_e: KonvaEventObject<MouseEvent>) => {
    const now = Date.now();
    if (now - lastCursorSend.current < CURSOR_THROTTLE_MS) return;
    lastCursorSend.current = now;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Convert screen coords to world coords
    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;

    send({ type: "cursor", x: worldX, y: worldY });
  }, [send, stagePos, scale]);

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
  const handleObjectTransform = useCallback((e: KonvaEventObject<Event>, obj: { id: string; width: number; height: number }) => {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    updateObject({
      id: obj.id,
      x: node.x(),
      y: node.y(),
      width: Math.max(20, Math.round(obj.width * sx)),
      height: Math.max(20, Math.round(obj.height * sy)),
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

  // Double-click on empty canvas -> create object based on active tool
  const handleStageDblClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.target !== stageRef.current) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;

    setSelectedId(null);

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
        draggable
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onMouseMove={handleMouseMove}
        onClick={(e: KonvaEventObject<MouseEvent>) => { if (e.target === stageRef.current) setSelectedId(null); }}
        onDblClick={handleStageDblClick}
      >
        <Layer>
          {renderGrid(stagePos, scale, size)}

          {/* Render synced objects */}
          {[...objects.values()].map((obj) => {
            if (obj.type === "sticky") {
              return (
                <Group
                  key={obj.id}
                  ref={setShapeRef(obj.id)}
                  x={obj.x}
                  y={obj.y}
                  rotation={obj.rotation}
                  draggable
                  onClick={(e) => { e.cancelBubble = true; setSelectedId(obj.id); }}
                  onDragEnd={(e) => {
                    updateObject({ id: obj.id, x: e.target.x(), y: e.target.y() });
                  }}
                  onDblClick={(e) => {
                    e.cancelBubble = true;
                    setSelectedId(null);
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
                  onClick={(e) => { e.cancelBubble = true; setSelectedId(obj.id); }}
                  onDragEnd={(e) => {
                    updateObject({ id: obj.id, x: e.target.x(), y: e.target.y() });
                  }}
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
            return null;
          })}
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
              background: obj.props.color || "#fbbf24",
              border: "2px solid #f59e0b",
              borderRadius: 8 * scale,
              padding: 10 * scale,
              fontSize: 14 * scale,
              color: "#1a1a2e",
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

      {/* Tool selector */}
      <div style={{ position: "absolute", bottom: 16, left: 16, display: "flex", gap: 4, zIndex: 10 }}>
        <ToolBtn label="S" title="Sticky note (S)" active={toolMode === "sticky"} onClick={() => setToolMode("sticky")} />
        <ToolBtn label="R" title="Rectangle (R)" active={toolMode === "rect"} onClick={() => setToolMode("rect")} />
        <ToolBtn label="AI" title="AI Assistant (/)" active={chatOpen} onClick={() => setChatOpen((o) => !o)} />
      </div>

      {/* AI Chat Panel */}
      {chatOpen && <ChatPanel boardId={boardId} onClose={() => setChatOpen(false)} />}

      {/* Color picker - shown when an object is selected */}
      {selectedId && (() => {
        const selectedObj = objects.get(selectedId);
        if (!selectedObj) return null;
        const propKey = selectedObj.type === "sticky" ? "color" : "fill";
        const currentColor = selectedObj.props[propKey];
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
                  const freshObj = objects.get(selectedId);
                  if (!freshObj) return;
                  const key = freshObj.type === "sticky" ? "color" : "fill";
                  updateObject({ id: selectedId, props: { ...freshObj.props, [key]: color } });
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

function ToolBtn({ label, title, active, onClick }: { label: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} style={{
      minWidth: 32, height: 32, padding: "0 6px",
      background: active ? "#3b82f6" : "rgba(22, 33, 62, 0.9)",
      border: active ? "1px solid #60a5fa" : "1px solid #334155",
      borderRadius: 4, color: "#eee", cursor: "pointer", fontSize: "0.875rem",
      fontWeight: active ? 700 : 400,
    }}>
      {label}
    </button>
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
