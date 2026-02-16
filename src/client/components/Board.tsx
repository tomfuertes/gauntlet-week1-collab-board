import React, { useState, useRef, useCallback } from "react";
import { Stage, Layer, Rect, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import type { AuthUser } from "../App";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export function Board({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Resize handler
  useState(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

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

  // Pan via drag
  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    setStagePos({ x: e.target.x(), y: e.target.y() });
  }, []);

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1a1a2e" }}>
      {/* Header bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 48, zIndex: 10,
        background: "rgba(22, 33, 62, 0.9)", borderBottom: "1px solid #334155",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", color: "#eee", fontSize: "0.875rem",
      }}>
        <span style={{ fontWeight: 600 }}>CollabBoard</span>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
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
      >
        <Layer>
          {/* Grid dots for spatial reference */}
          {renderGrid(stagePos, scale, size)}

          {/* Placeholder content */}
          <Rect x={100} y={100} width={200} height={150} fill="#fbbf24" cornerRadius={8} shadowBlur={5} shadowColor="rgba(0,0,0,0.3)" />
          <Text x={110} y={120} text="Hello CollabBoard!" fontSize={16} fill="#1a1a2e" width={180} />
          <Text x={110} y={145} text={`Logged in as ${user.displayName}`} fontSize={12} fill="#555" width={180} />
        </Layer>
      </Stage>

      {/* Zoom controls */}
      <div style={{ position: "absolute", bottom: 16, right: 16, display: "flex", gap: 4, zIndex: 10 }}>
        <ZoomBtn label="-" onClick={() => setScale((s) => Math.max(MIN_ZOOM, s / 1.2))} />
        <ZoomBtn label="Reset" onClick={() => { setScale(1); setStagePos({ x: 0, y: 0 }); }} />
        <ZoomBtn label="+" onClick={() => setScale((s) => Math.min(MAX_ZOOM, s * 1.2))} />
      </div>
    </div>
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

  // Calculate visible area in world coords
  const startX = Math.floor(-pos.x / scale / gridSize) * gridSize - gridSize;
  const startY = Math.floor(-pos.y / scale / gridSize) * gridSize - gridSize;
  const endX = startX + size.width / scale + gridSize * 2;
  const endY = startY + size.height / scale + gridSize * 2;

  // Limit dots to prevent performance issues at low zoom
  const maxDots = 2000;
  let count = 0;

  for (let x = startX; x < endX; x += gridSize) {
    for (let y = startY; y < endY; y += gridSize) {
      if (count++ >= maxDots) break;
      dots.push(
        <Rect key={`${x},${y}`} x={x - 1} y={y - 1} width={2} height={2} fill="rgba(255,255,255,0.08)" listening={false} />
      );
    }
    if (count >= maxDots) break;
  }

  return dots;
}
