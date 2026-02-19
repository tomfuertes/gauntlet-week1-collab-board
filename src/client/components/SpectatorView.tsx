import { useState, useEffect, useRef, useCallback } from "react";
import { Stage, Layer, Rect, Text, Group, Ellipse, Line as KonvaLine, Arrow, Image as KonvaImage } from "react-konva";
import type { BoardObject } from "@shared/types";
import { AI_USER_ID } from "@shared/types";
import { useSpectatorSocket } from "../hooks/useSpectatorSocket";
import { colors } from "../theme";
import { Cursors } from "./Cursors";
import { BoardGrid } from "./BoardGrid";
import "../styles/animations.css";

// clap, laugh, fire, heart, wow, theater masks
const REACTION_EMOJIS = ["\uD83D\uDC4F", "\uD83D\uDE02", "\uD83D\uDD25", "\u2764\uFE0F", "\uD83D\uDE2E", "\uD83C\uDFAD"] as const;
const HEADER_H = 48;
const REACTION_BAR_H = 56;

// Renders a base64 image (same pattern as ReplayViewer)
function SpectatorImageObj({ obj }: { obj: BoardObject }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!obj.props.src) { setError(true); return; }
    setError(false);
    setImg(null);
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => { if (!cancelled) setImg(image); };
    image.onerror = () => { if (!cancelled) setError(true); };
    image.src = obj.props.src;
    return () => { cancelled = true; };
  }, [obj.props.src]);
  const base = { x: obj.x, y: obj.y, rotation: obj.rotation };
  return (
    <Group {...base}>
      {error ? (
        <Rect width={obj.width} height={obj.height} fill="rgba(239,68,68,0.08)" stroke="#ef4444" strokeWidth={1} dash={[4, 4]} cornerRadius={4} />
      ) : img ? (
        <KonvaImage image={img} width={obj.width} height={obj.height} cornerRadius={4} />
      ) : (
        <Rect width={obj.width} height={obj.height} fill="rgba(99,102,241,0.08)" stroke="#6366f1" strokeWidth={1} dash={[4, 4]} cornerRadius={4} />
      )}
    </Group>
  );
}

function renderObject(obj: BoardObject) {
  const base = { x: obj.x, y: obj.y, rotation: obj.rotation };

  if (obj.type === "frame") {
    return (
      <Group key={obj.id} {...base}>
        <Rect width={obj.width} height={obj.height} fill="rgba(99,102,241,0.06)" stroke="#6366f1" strokeWidth={2} dash={[10, 5]} cornerRadius={4} />
        <Text x={8} y={-20} text={obj.props.text || "Frame"} fontSize={13} fill="#6366f1" fontStyle="600" />
      </Group>
    );
  }
  if (obj.type === "sticky") {
    return (
      <Group key={obj.id} {...base}>
        <Rect width={obj.width} height={obj.height} fill={obj.props.color || "#fbbf24"} cornerRadius={8} shadowBlur={5} shadowColor="rgba(0,0,0,0.3)" />
        <Text x={10} y={10} text={obj.props.text || ""} fontSize={14} fill="#1a1a2e" width={obj.width - 20} />
      </Group>
    );
  }
  if (obj.type === "rect") {
    return (
      <Group key={obj.id} {...base}>
        <Rect width={obj.width} height={obj.height} fill={obj.props.fill || "#3b82f6"} stroke={obj.props.stroke || "#2563eb"} strokeWidth={2} cornerRadius={4} />
      </Group>
    );
  }
  if (obj.type === "circle") {
    return (
      <Group key={obj.id} {...base}>
        <Ellipse x={obj.width / 2} y={obj.height / 2} radiusX={obj.width / 2} radiusY={obj.height / 2} fill={obj.props.fill || "#8b5cf6"} stroke={obj.props.stroke || "#7c3aed"} strokeWidth={2} />
      </Group>
    );
  }
  if (obj.type === "line") {
    const useArrow = obj.props.arrow === "end" || obj.props.arrow === "both";
    const LineComponent = useArrow ? Arrow : KonvaLine;
    return (
      <Group key={obj.id} {...base}>
        <LineComponent
          points={[0, 0, obj.width, obj.height]}
          stroke={obj.props.stroke || "#f43f5e"}
          strokeWidth={3}
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
      <Group key={obj.id} {...base}>
        <Text text={obj.props.text || ""} fontSize={16} fill={obj.props.color || "#ffffff"} width={obj.width} />
      </Group>
    );
  }
  if (obj.type === "image") {
    return <SpectatorImageObj key={obj.id} obj={obj} />;
  }
  return null;
}

interface SpectatorViewProps {
  boardId: string;
  onBack: () => void;
}

export function SpectatorView({ boardId, onBack }: SpectatorViewProps) {
  const { connectionState, initialized, cursors, objects, presence, spectatorCount, reactions, sendCursor, sendReaction } = useSpectatorSocket(boardId);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const lastCursorSend = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const stageH = size.height - HEADER_H - REACTION_BAR_H;

  // Pan via scroll, zoom via ctrl+scroll (same as Board.tsx)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(5, Math.max(0.1, scale * zoomFactor));
      const pointer = { x: e.clientX, y: e.clientY - HEADER_H };
      const newPos = {
        x: pointer.x - (pointer.x - stagePos.x) * (newScale / scale),
        y: pointer.y - (pointer.y - stagePos.y) * (newScale / scale),
      };
      setScale(newScale);
      setStagePos(newPos);
    } else {
      setStagePos((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
    }
  }, [scale, stagePos]);

  // Send cursor position to server (throttled at ~30fps)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const now = performance.now();
    if (now - lastCursorSend.current < 33) return;
    lastCursorSend.current = now;
    // Convert screen coords to canvas coords
    const canvasX = (e.clientX - stagePos.x) / scale;
    const canvasY = (e.clientY - HEADER_H - stagePos.y) / scale;
    sendCursor(canvasX, canvasY);
  }, [scale, stagePos, sendCursor]);

  const handleReaction = useCallback((emoji: string) => {
    // Place reaction at center of viewport in canvas coords
    const canvasX = (size.width / 2 - stagePos.x) / scale;
    const canvasY = (stageH / 2 - stagePos.y) / scale;
    sendReaction(emoji, canvasX, canvasY);
  }, [size.width, stageH, scale, stagePos, sendReaction]);

  const objectList = [...objects.values()];

  return (
    <div style={{ height: "100vh", background: colors.bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        height: HEADER_H, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", color: colors.text, fontSize: "0.875rem",
        background: colors.overlayHeader, borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: colors.textMuted, cursor: "pointer",
            fontSize: "0.875rem", padding: 0,
          }}>&larr; Back</button>
          <span style={{ fontWeight: 600 }}>Live View</span>
          <span style={{
            background: "rgba(239, 68, 68, 0.2)", color: "#f87171",
            fontSize: "0.625rem", fontWeight: 700, padding: "2px 6px",
            borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.05em",
          }}>LIVE</span>
          <span data-testid="connection-state" data-state={connectionState} style={{
            width: 8, height: 8, borderRadius: "50%", display: "inline-block",
            background: { connected: colors.success, reconnecting: colors.warning, connecting: colors.info, disconnected: colors.error }[connectionState],
          }} title={connectionState} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Presence avatars (players only) */}
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
          {/* Spectator count */}
          {spectatorCount > 0 && (
            <span style={{ color: colors.textDim, fontSize: "0.75rem" }}>
              {spectatorCount} watching
            </span>
          )}
          <span style={{ color: colors.textDim }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => {
            navigator.clipboard.writeText(`${location.origin}/#watch/${boardId}`)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => { /* clipboard blocked (unfocused, HTTP, etc.) */ });
          }} style={{ background: "none", border: `1px solid ${colors.borderLight}`, borderRadius: 4, color: colors.textMuted, padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.75rem" }}>
            {copied ? "Copied!" : "Share Link"}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={stageRef}
        style={{ flex: 1, overflow: "hidden", position: "relative", cursor: "default" }}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
      >
        {/* Loading skeleton */}
        {!initialized && connectionState !== "disconnected" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
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
                Connecting to live board...
              </div>
            </div>
          </div>
        )}

        {/* Disconnected state */}
        {connectionState === "disconnected" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 5,
          }}>
            <div style={{ textAlign: "center", color: colors.textMuted }}>
              <div style={{ fontSize: "1.25rem", marginBottom: 8 }}>Board unavailable</div>
              <button onClick={onBack} style={{
                background: "none", border: `1px solid ${colors.border}`, borderRadius: 4,
                color: colors.textMuted, padding: "0.5rem 1rem", cursor: "pointer",
              }}>Back</button>
            </div>
          </div>
        )}

        <Stage
          width={size.width}
          height={stageH}
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
        >
          <Layer>
            <BoardGrid size={{ width: size.width, height: stageH }} scale={scale} stagePos={stagePos} />
            {objectList.map((obj) => renderObject(obj))}
            <Cursors cursors={cursors} />
          </Layer>
        </Stage>

        {/* Floating reactions overlay */}
        {reactions.map((r) => {
          // Convert canvas coords back to screen coords
          const screenX = r.x * scale + stagePos.x;
          const screenY = r.y * scale + stagePos.y;
          return (
            <span
              key={r.id}
              className="cb-reaction"
              style={{ left: screenX, top: screenY }}
            >
              {r.emoji}
            </span>
          );
        })}
      </div>

      {/* Reaction bar */}
      <div style={{
        height: REACTION_BAR_H, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
        background: colors.overlayHeader, borderTop: `1px solid ${colors.border}`,
      }}>
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleReaction(emoji)}
            style={{
              background: "none", border: `1px solid ${colors.border}`, borderRadius: 8,
              fontSize: "1.5rem", padding: "0.25rem 0.5rem", cursor: "pointer",
              transition: "transform 0.1s, border-color 0.1s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.2)"; e.currentTarget.style.borderColor = colors.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.borderColor = colors.border; }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
