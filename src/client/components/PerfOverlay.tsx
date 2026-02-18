import { useState, useEffect, useRef } from "react";
import { colors } from "../theme";

// Spec targets from docs/encrypted/spec.md - Performance Targets table
const TARGETS = {
  fps: { green: 55, yellow: 30 }, // 60fps target
  msgAge: { green: 500, yellow: 2000 }, // ms since last server message
};

const IS_DEV =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

function statusColor(
  value: number,
  thresholds: { green: number; yellow: number },
  lowerIsBetter = false,
): string {
  if (lowerIsBetter) {
    if (value <= thresholds.green) return colors.success;
    if (value <= thresholds.yellow) return colors.warning;
    return colors.error;
  }
  if (value >= thresholds.green) return colors.success;
  if (value >= thresholds.yellow) return colors.warning;
  return colors.error;
}

function connColor(state: string): string {
  switch (state) {
    case "connected":
      return colors.success;
    case "disconnected":
      return colors.error;
    default:
      return colors.warning;
  }
}

interface PerfOverlayProps {
  objectCount: number;
  cursorCount: number;
  connectionState: string;
  stageRef: React.RefObject<unknown>;
  lastServerMessageAt: React.RefObject<number>;
}

export function PerfOverlay({
  objectCount,
  cursorCount,
  connectionState,
  stageRef,
  lastServerMessageAt,
}: PerfOverlayProps) {
  const [visible, setVisible] = useState(IS_DEV);
  const [fps, setFps] = useState<number | null>(null);
  const [msgAge, setMsgAge] = useState<number | null>(null);
  const [konvaNodes, setKonvaNodes] = useState(0);

  const fpsBuffer = useRef<number[]>([]);
  const fpsRef = useRef(0);
  const lastFrameTime = useRef(0);
  const rafId = useRef(0);

  // Toggle with Shift+P or backtick
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if ((e.key === "P" && e.shiftKey) || e.key === "`") {
        e.preventDefault();
        setVisible((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // FPS: measure at rAF rate, write to ref (no state update per frame)
  useEffect(() => {
    if (!visible) return;
    fpsBuffer.current = [];
    fpsRef.current = 0;
    lastFrameTime.current = performance.now();

    const tick = () => {
      const now = performance.now();
      const delta = now - lastFrameTime.current;
      lastFrameTime.current = now;
      if (delta > 0) {
        const instantFps = Math.min(1000 / delta, 240);
        if (Number.isFinite(instantFps)) {
          fpsBuffer.current.push(instantFps);
          if (fpsBuffer.current.length > 60) fpsBuffer.current.shift();
          fpsRef.current =
            fpsBuffer.current.reduce((a, b) => a + b, 0) /
            fpsBuffer.current.length;
        }
      }
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [visible]);

  // Single 4Hz poll: flush FPS ref to state + msg age + Konva nodes
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setFps(Math.round(fpsRef.current));

      // Time since last server message (0 = no messages yet)
      const lastMsg = lastServerMessageAt.current;
      if (lastMsg > 0) {
        setMsgAge(Math.round(performance.now() - lastMsg));
      }

      // Konva node count - guard handles ref-not-ready; let real errors surface
      const stage = stageRef.current;
      if (stage && typeof stage === "object" && "getLayers" in stage) {
        try {
          const typedStage = stage as {
            getLayers: () => { getChildren: () => unknown[] }[];
          };
          let count = 0;
          for (const layer of typedStage.getLayers()) {
            count += layer.getChildren().length;
          }
          setKonvaNodes(count);
        } catch (err) {
          console.warn("[PerfOverlay] Konva node count failed:", err);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps -- stageRef, lastServerMessageAt are stable refs

  if (!visible) return null;

  const rows: [string, string | number, string][] = [
    [
      "FPS",
      fps !== null ? fps : "--",
      fps !== null ? statusColor(fps, TARGETS.fps) : colors.textDim,
    ],
    ["Objects", objectCount, colors.text],
    [
      "Msg age",
      msgAge !== null ? `${msgAge}ms` : "--",
      msgAge !== null
        ? statusColor(msgAge, TARGETS.msgAge, true)
        : colors.textDim,
    ],
    ["Users", cursorCount, colors.text],
    ["Nodes", konvaNodes, colors.textMuted],
    ["Conn", connectionState, connColor(connectionState)],
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 56,
        left: 56,
        zIndex: 30,
        background: "rgba(15, 23, 42, 0.85)",
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "6px 10px",
        fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', monospace",
        fontSize: 11,
        lineHeight: "16px",
        pointerEvents: "none",
        userSelect: "none",
        backdropFilter: "blur(4px)",
      }}
    >
      {rows.map(([label, value, color]) => (
        <div
          key={label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ color: colors.textMuted }}>{label}</span>
          <span style={{ color, fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
