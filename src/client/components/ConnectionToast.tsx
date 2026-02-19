import { useState, useEffect, useRef } from "react";
import type { ConnectionState } from "../hooks/useWebSocket";

const TOAST_CONFIG: Record<ConnectionState, { label: string; bg: string; border: string }> = {
  connecting: { label: "Connecting...", bg: "#78350f", border: "#f59e0b" },
  connected: { label: "Connected", bg: "#065f46", border: "#10b981" },
  reconnecting: { label: "Reconnecting...", bg: "#78350f", border: "#f59e0b" },
  disconnected: { label: "Disconnected", bg: "#7f1d1d", border: "#ef4444" },
};

export function ConnectionToast({ connectionState }: { connectionState: ConnectionState }) {
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
    <div
      style={{
        position: "absolute",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 6,
        padding: "6px 16px",
        color: "#fff",
        fontSize: "0.8rem",
        zIndex: 30,
      }}
    >
      {c.label}
    </div>
  );
}
