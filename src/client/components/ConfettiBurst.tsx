import React, { useRef, useEffect } from "react";
import "../styles/animations.css";

const CONFETTI_COLORS = [
  "#6366f1",
  "#818cf8",
  "#f472b6",
  "#fbbf24",
  "#4ade80",
  "#60a5fa",
  "#f87171",
  "#a78bfa",
];

export function ConfettiBurst({
  x,
  y,
  onDone,
}: {
  x: number;
  y: number;
  onDone: () => void;
}) {
  const particles = useRef(
    Array.from({ length: 40 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.8;
      const dist = 50 + Math.random() * 120;
      return {
        cx: `${Math.cos(angle) * dist}px`,
        cy: `${Math.sin(angle) * dist + 80}px`, // gravity pull
        color:
          CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 4 + Math.random() * 6,
        delay: Math.random() * 0.15,
      };
    }),
  ).current;

  useEffect(() => {
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        pointerEvents: "none",
        zIndex: 45,
      }}
    >
      {particles.map((p, i) => (
        <div
          key={i}
          style={
            {
              position: "absolute",
              width: p.size,
              height: p.size,
              background: p.color,
              borderRadius: p.size > 7 ? "50%" : "1px",
              "--cx": p.cx,
              "--cy": p.cy,
              animation: `cb-confetti 1.4s ${p.delay}s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
              opacity: 0,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
