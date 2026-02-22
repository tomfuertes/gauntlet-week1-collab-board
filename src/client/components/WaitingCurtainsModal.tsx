import { colors } from "../theme";
import "../styles/animations.css";

interface WaitingCurtainsModalProps {
  /** Modal closes itself when this becomes true (first objects arrive via WS) */
  hasObjects: boolean;
}

export function WaitingCurtainsModal({ hasObjects }: WaitingCurtainsModalProps) {
  // KEY-DECISION 2026-02-22: Not using Modal component - this state is non-dismissable
  // by the user. It resolves only when the initiator's objects arrive via WS.
  if (hasObjects) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
        animation: "cb-backdrop-in 0.3s ease-out",
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: "calc(100vw - 48px)",
          background: "rgba(15, 23, 42, 0.97)",
          border: `1px solid ${colors.border}`,
          borderRadius: 20,
          padding: "2.5rem 2.5rem 2rem",
          boxShadow: `0 0 80px ${colors.accentGlow}, 0 16px 48px rgba(0,0,0,0.6)`,
          animation: "cb-overlay-in 0.4s ease-out both",
          textAlign: "center",
        }}
      >
        {/* Swaying curtain emoji */}
        <div
          style={{
            fontSize: "3rem",
            lineHeight: 1,
            marginBottom: 16,
            display: "inline-block",
            animation: "cb-curtain-sway 2.4s ease-in-out infinite",
            transformOrigin: "top center",
          }}
        >
          🎭
        </div>

        <div
          style={{
            color: colors.text,
            fontSize: "1.125rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            marginBottom: 8,
          }}
        >
          Waiting for curtains...
        </div>

        <div
          style={{
            color: colors.textMuted,
            fontSize: "0.8125rem",
            marginBottom: 24,
            lineHeight: 1.5,
          }}
        >
          Your partner is setting the stage.
          <br />
          The scene will begin shortly.
        </div>

        {/* Pulsing dots */}
        <div className="chat-bounce-dots" style={{ justifyContent: "center" }}>
          <div className="chat-dot" />
          <div className="chat-dot" />
          <div className="chat-dot" />
        </div>
      </div>
    </div>
  );
}
