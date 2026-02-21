import { AUDIENCE_Y, getAudienceFigureXs } from "./AudienceRow";
import type { CanvasBubble } from "../hooks/useSpectatorSocket";

// KEY-DECISION 2026-02-21: HTML overlay (not Konva shapes) for speech bubbles because:
// text wrapping, CSS fade animations, and speech bubble tails are trivial in HTML/CSS
// but require significant complexity in Konva (custom Shape, manual text sizing, render cycle).
// Overlays are positioned by converting world-space canvas coords to screen-space.

interface CanvasSpeechBubblesProps {
  bubbles: CanvasBubble[];
  spectatorCount: number;
  scale: number;
  stagePos: { x: number; y: number };
  /** Pixel offset from top of viewport to top of the stage div (accounts for header) */
  headerH: number;
}

/** Hash a string to an integer 0-255 (deterministic, not cryptographic) */
function hashUserId(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) & 0xff;
  }
  return h;
}

export function CanvasSpeechBubbles({ bubbles, spectatorCount, scale, stagePos, headerH }: CanvasSpeechBubblesProps) {
  if (bubbles.length === 0) return null;

  return (
    <>
      {bubbles.map((bubble) => {
        let worldX: number;
        let worldY: number;

        if (bubble.isHeckle) {
          // Position above the heckler's audience seat (deterministic by userId)
          const displayCount = Math.max(3, spectatorCount);
          const xs = getAudienceFigureXs(displayCount);
          if (xs.length === 0) return null;
          const figIdx = hashUserId(bubble.userId) % xs.length;
          worldX = xs[figIdx];
          worldY = AUDIENCE_Y - 60; // above the audience head
        } else {
          // Performer chat: center band (400-800 world px), spread by userId hash
          const hash = hashUserId(bubble.userId);
          worldX = 400 + (hash / 255) * 400;
          worldY = 200; // upper third of the stage
        }

        const screenX = worldX * scale + stagePos.x;
        const screenY = worldY * scale + stagePos.y + headerH;
        const age = Date.now() - bubble.ts;
        // Start fading at 3.5s, fully gone at 5s
        const opacity = age > 3500 ? Math.max(0, 1 - (age - 3500) / 1500) : 1;

        return (
          <div
            key={bubble.id}
            style={{
              position: "absolute",
              left: screenX,
              top: screenY,
              transform: "translate(-50%, -100%)",
              background: bubble.isHeckle ? "rgba(251,191,36,0.92)" : "rgba(30,41,59,0.95)",
              color: bubble.isHeckle ? "#1c1200" : "#e2e8f0",
              border: `1.5px solid ${bubble.isHeckle ? "rgba(251,191,36,0.6)" : "rgba(100,116,139,0.5)"}`,
              borderRadius: 10,
              padding: "5px 10px",
              fontSize: 12,
              maxWidth: 180,
              wordBreak: "break-word",
              lineHeight: 1.4,
              pointerEvents: "none",
              zIndex: 20,
              opacity,
              transition: "opacity 0.3s",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {bubble.isHeckle ? (
              <span>📣 &ldquo;{bubble.text}&rdquo;</span>
            ) : (
              <>
                <span
                  style={{
                    display: "block",
                    fontSize: 10,
                    color: "#94a3b8",
                    marginBottom: 2,
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                  }}
                >
                  {bubble.username}
                </span>
                {bubble.text}
              </>
            )}
            {/* Speech bubble tail */}
            <div
              style={{
                position: "absolute",
                bottom: -7,
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderTop: `7px solid ${bubble.isHeckle ? "rgba(251,191,36,0.92)" : "rgba(30,41,59,0.95)"}`,
              }}
            />
          </div>
        );
      })}
    </>
  );
}
