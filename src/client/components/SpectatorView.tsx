import { useState, useEffect, useRef, useCallback } from "react";
import { Stage, Layer } from "react-konva";
import { AI_USER_ID } from "@shared/types";
import { useSpectatorSocket } from "../hooks/useSpectatorSocket";
import { colors } from "../theme";
import { Button } from "./Button";
import { BoardObjectRenderer } from "./BoardObjectRenderer";
import { Cursors } from "./Cursors";
import { BoardGrid } from "./BoardGrid";
import "../styles/animations.css";

// clap, laugh, fire, heart, wow, theater masks
const REACTION_EMOJIS = [
  "\uD83D\uDC4F",
  "\uD83D\uDE02",
  "\uD83D\uDD25",
  "\u2764\uFE0F",
  "\uD83D\uDE2E",
  "\uD83C\uDFAD",
] as const;
const HEADER_H = 48;
const REACTION_BAR_H = 56;

interface SpectatorViewProps {
  boardId: string;
  onBack: () => void;
}

export function SpectatorView({ boardId, onBack }: SpectatorViewProps) {
  const {
    connectionState,
    initialized,
    cursors,
    objects,
    presence,
    spectatorCount,
    reactions,
    sendCursor,
    sendReaction,
  } = useSpectatorSocket(boardId);
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
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
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
    },
    [scale, stagePos],
  );

  // Send cursor position to server (throttled at ~30fps)
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const now = performance.now();
      if (now - lastCursorSend.current < 33) return;
      lastCursorSend.current = now;
      // Convert screen coords to canvas coords
      const canvasX = (e.clientX - stagePos.x) / scale;
      const canvasY = (e.clientY - HEADER_H - stagePos.y) / scale;
      sendCursor(canvasX, canvasY);
    },
    [scale, stagePos, sendCursor],
  );

  const handleReaction = useCallback(
    (emoji: string) => {
      // Place reaction at center of viewport in canvas coords
      const canvasX = (size.width / 2 - stagePos.x) / scale;
      const canvasY = (stageH / 2 - stagePos.y) / scale;
      sendReaction(emoji, canvasX, canvasY);
    },
    [size.width, stageH, scale, stagePos, sendReaction],
  );

  const objectList = [...objects.values()];

  return (
    <div
      style={{ height: "100vh", background: colors.bg, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {/* Header */}
      <div
        style={{
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          color: colors.text,
          fontSize: "0.875rem",
          background: colors.overlayHeader,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Button variant="link" onClick={onBack} style={{ color: colors.textMuted, fontSize: "0.875rem" }}>
            &larr; Back
          </Button>
          <span style={{ fontWeight: 600 }}>Live View</span>
          <span
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              color: "#f87171",
              fontSize: "0.625rem",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            LIVE
          </span>
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
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Presence avatars (players only) */}
          <div style={{ display: "flex", gap: 4 }}>
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
          </div>
          {/* Spectator count */}
          {spectatorCount > 0 && (
            <span style={{ color: colors.textDim, fontSize: "0.75rem" }}>{spectatorCount} watching</span>
          )}
          <span style={{ color: colors.textDim }}>{Math.round(scale * 100)}%</span>
          <Button
            onClick={() => {
              navigator.clipboard
                .writeText(`${location.origin}/#watch/${boardId}`)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => {
                  /* clipboard blocked (unfocused, HTTP, etc.) */
                });
            }}
          >
            {copied ? "Copied!" : "Share Link"}
          </Button>
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
          <div
            style={{
              position: "absolute",
              inset: 0,
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
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.875rem" }}>Connecting to live board...</div>
            </div>
          </div>
        )}

        {/* Disconnected state */}
        {connectionState === "disconnected" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 5,
            }}
          >
            <div style={{ textAlign: "center", color: colors.textMuted }}>
              <div style={{ fontSize: "1.25rem", marginBottom: 8 }}>Board unavailable</div>
              <Button onClick={onBack} style={{ padding: "0.5rem 1rem" }}>
                Back
              </Button>
            </div>
          </div>
        )}

        <Stage width={size.width} height={stageH} scaleX={scale} scaleY={scale} x={stagePos.x} y={stagePos.y}>
          <Layer>
            <BoardGrid size={{ width: size.width, height: stageH }} scale={scale} stagePos={stagePos} />
            {objectList.map((obj) => (
              <BoardObjectRenderer key={obj.id} obj={obj} />
            ))}
            <Cursors cursors={cursors} />
          </Layer>
        </Stage>

        {/* Floating reactions overlay */}
        {reactions.map((r) => {
          // Convert canvas coords back to screen coords
          const screenX = r.x * scale + stagePos.x;
          const screenY = r.y * scale + stagePos.y;
          return (
            <span key={r.id} className="cb-reaction" style={{ left: screenX, top: screenY }}>
              {r.emoji}
            </span>
          );
        })}
      </div>

      {/* Reaction bar */}
      <div
        style={{
          height: REACTION_BAR_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          background: colors.overlayHeader,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleReaction(emoji)}
            style={{
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              fontSize: "1.5rem",
              padding: "0.25rem 0.5rem",
              cursor: "pointer",
              transition: "transform 0.1s, border-color 0.1s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.2)";
              e.currentTarget.style.borderColor = colors.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.borderColor = colors.border;
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
