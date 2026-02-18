import { useState, useEffect, useRef, useCallback } from "react";
import { colors } from "../theme";

// Spec targets from docs/encrypted/spec.md - Performance Targets table
const TARGETS = {
  fps: { green: 55, yellow: 30 },        // 60fps target
  wsLatency: { green: 50, yellow: 100 },  // <50ms cursor sync
};

function statusColor(value: number, thresholds: { green: number; yellow: number }, lowerIsBetter = false): string {
  if (lowerIsBetter) {
    if (value <= thresholds.green) return colors.success;
    if (value <= thresholds.yellow) return colors.warning;
    return colors.error;
  }
  if (value >= thresholds.green) return colors.success;
  if (value >= thresholds.yellow) return colors.warning;
  return colors.error;
}

function rollingAvg(buffer: number[], value: number, maxLen: number): number {
  buffer.push(value);
  if (buffer.length > maxLen) buffer.shift();
  return buffer.reduce((a, b) => a + b, 0) / buffer.length;
}

interface PerfOverlayProps {
  objectCount: number;
  cursorCount: number;
  connectionState: string;
  stageRef: React.RefObject<unknown>;
  wsLatencyRef: React.RefObject<number>;
}

export function PerfOverlay({ objectCount, cursorCount, connectionState, stageRef, wsLatencyRef }: PerfOverlayProps) {
  const isDev = typeof window !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
  const [visible, setVisible] = useState(isDev);
  const [fps, setFps] = useState(0);
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [konvaNodes, setKonvaNodes] = useState(0);

  const fpsBuffer = useRef<number[]>([]);
  const fpsRef = useRef(0); // measured at rAF rate, read at render rate
  const lastFrameTime = useRef(performance.now());
  const rafId = useRef(0);
  const wsBuffer = useRef<number[]>([]);

  // Toggle with Shift+P or backtick
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "P" && e.shiftKey) || e.key === "`") {
        e.preventDefault();
        setVisible(prev => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // FPS: measure at rAF rate but only write to ref (no state update per frame)
  const tick = useCallback(() => {
    const now = performance.now();
    const delta = now - lastFrameTime.current;
    lastFrameTime.current = now;
    if (delta > 0) {
      const instantFps = 1000 / delta;
      fpsRef.current = rollingAvg(fpsBuffer.current, instantFps, 60);
    }
    rafId.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!visible) return;
    lastFrameTime.current = performance.now();
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [visible, tick]);

  // Single 4Hz poll: flush FPS ref to state + WS latency + Konva nodes
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setFps(Math.round(fpsRef.current));

      const lat = wsLatencyRef.current;
      if (lat > 0) {
        const avg = rollingAvg(wsBuffer.current, lat, 20);
        setWsLatency(Math.round(avg));
      }

      try {
        const stage = stageRef.current;
        if (stage && typeof stage === "object" && "getLayers" in stage) {
          const getLayers = (stage as { getLayers: () => { getChildren: () => unknown[] }[] }).getLayers;
          let count = 0;
          for (const layer of getLayers.call(stage)) {
            count += layer.getChildren().length;
          }
          setKonvaNodes(count);
        }
      } catch {
        // Konva ref may not be available yet
      }
    }, 250);
    return () => clearInterval(id);
  }, [visible, stageRef, wsLatencyRef]);

  if (!visible) return null;

  const rows: [string, string | number, string][] = [
    ["FPS", fps, statusColor(fps, TARGETS.fps)],
    ["Objects", objectCount, colors.text],
    ["WS", wsLatency !== null ? `${wsLatency}ms` : "--", wsLatency !== null ? statusColor(wsLatency, TARGETS.wsLatency, true) : colors.textDim],
    ["Users", cursorCount, colors.text],
    ["Nodes", konvaNodes, colors.textMuted],
    ["Conn", connectionState, connectionState === "connected" ? colors.success : connectionState === "disconnected" ? colors.error : colors.warning],
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
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: colors.textMuted }}>{label}</span>
          <span style={{ color, fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
