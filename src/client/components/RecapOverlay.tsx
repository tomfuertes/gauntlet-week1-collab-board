import { useState, useEffect, useCallback } from "react";
import "../styles/animations.css";

interface RecapOverlayProps {
  narration: string;
  onDismiss: () => void;
}

// KEY-DECISION 2026-02-20: 30 chars/sec matches a measured TV narrator pace -
// fast enough to feel live, slow enough to read comfortably without skipping.
const CHARS_PER_SEC = 30;

// Time (ms) to wait after typing completes before auto-dismissing.
const AUTO_DISMISS_DELAY_MS = 3500;

export function RecapOverlay({ narration, onDismiss }: RecapOverlayProps) {
  const [titleVisible, setTitleVisible] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  const [typing, setTyping] = useState(false);
  const [fading, setFading] = useState(false);

  const dismiss = useCallback(() => {
    setFading(true);
    setTimeout(onDismiss, 900);
  }, [onDismiss]);

  // Title fades in shortly after mount
  useEffect(() => {
    const t = setTimeout(() => setTitleVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  // Start typewriter after title finishes fading in (~800ms transition + 300ms delay)
  useEffect(() => {
    if (!titleVisible) return;
    const t = setTimeout(() => setTyping(true), 1000);
    return () => clearTimeout(t);
  }, [titleVisible]);

  // Typewriter character-by-character effect
  useEffect(() => {
    if (!typing) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedText(narration.slice(0, i));
      if (i >= narration.length) {
        clearInterval(interval);
        setTimeout(dismiss, AUTO_DISMISS_DELAY_MS);
      }
    }, 1000 / CHARS_PER_SEC);
    return () => clearInterval(interval);
  }, [typing, narration, dismiss]);

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0, 0, 0, 0.88)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        opacity: fading ? 0 : 1,
        transition: fading ? "opacity 0.9s ease" : "opacity 0.4s ease",
      }}
    >
      {/* Skip button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 6,
          color: "rgba(255,255,255,0.6)",
          padding: "4px 12px",
          fontSize: "0.8125rem",
          cursor: "pointer",
          letterSpacing: "0.03em",
        }}
      >
        Skip
      </button>

      <div style={{ maxWidth: 600, padding: "0 24px", textAlign: "center" }}>
        {/* "Previously on YesAInd..." title */}
        <div
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "clamp(1rem, 3.5vw, 1.5rem)",
            fontWeight: 700,
            color: "rgba(255, 255, 255, 0.45)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 36,
            opacity: titleVisible ? 1 : 0,
            transition: "opacity 0.8s ease",
          }}
        >
          Previously on YesAInd...
        </div>

        {/* Narration text with typewriter cursor */}
        <div
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "clamp(1rem, 2.5vw, 1.2rem)",
            color: "#f5f5f5",
            lineHeight: 1.75,
            textShadow: "0 1px 12px rgba(0,0,0,0.6)",
            minHeight: "8em",
          }}
        >
          {displayedText}
          {typing && displayedText.length < narration.length && <span className="cb-recap-cursor">|</span>}
        </div>

        {/* "Click anywhere to skip" hint fades in once typing starts */}
        <div
          style={{
            marginTop: 32,
            fontSize: "0.75rem",
            color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.05em",
            opacity: typing ? 1 : 0,
            transition: "opacity 1s ease",
          }}
        >
          click anywhere to skip
        </div>
      </div>
    </div>
  );
}
