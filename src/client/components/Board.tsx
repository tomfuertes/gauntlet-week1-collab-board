import React, { useState, useRef, useCallback, useEffect } from "react";
import { Stage, Layer, Rect, Text, Group } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import type { AuthUser } from "../App";
import { useWebSocket } from "../hooks/useWebSocket";
import { Cursors } from "./Cursors";
import { ChatPanel } from "./ChatPanel";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const CURSOR_THROTTLE_MS = 33; // ~30fps

// Hardcoded board ID for MVP - will be dynamic later
const BOARD_ID = "default";

type ToolMode = "sticky" | "rect";

export function Board({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const lastCursorSend = useRef(0);
  const [toolMode, setToolMode] = useState<ToolMode>("sticky");
  const [chatOpen, setChatOpen] = useState(false);

  const { connected, cursors, objects, presence, send, createObject, updateObject } = useWebSocket(BOARD_ID);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Resize handler
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keyboard shortcuts for tool switching
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "s" || e.key === "S") setToolMode("sticky");
      if (e.key === "r" || e.key === "R") setToolMode("rect");
      if (e.key === "/") { e.preventDefault(); setChatOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // Double-click on empty canvas -> create object based on active tool
  const handleStageDblClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.target !== stageRef.current) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;

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
          <span style={{ fontWeight: 600 }}>CollabBoard</span>
          <span style={{ color: connected ? "#4ade80" : "#f87171", fontSize: "0.75rem" }}>
            {connected ? "connected" : "disconnected"}
          </span>
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
                  x={obj.x}
                  y={obj.y}
                  draggable
                  onDragEnd={(e) => {
                    updateObject({ id: obj.id, x: e.target.x(), y: e.target.y() });
                  }}
                  onDblClick={(e) => {
                    e.cancelBubble = true;
                    setEditingId(obj.id);
                  }}
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
                  x={obj.x}
                  y={obj.y}
                  draggable
                  onDragEnd={(e) => {
                    updateObject({ id: obj.id, x: e.target.x(), y: e.target.y() });
                  }}
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
      {chatOpen && <ChatPanel boardId={BOARD_ID} onClose={() => setChatOpen(false)} />}

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
