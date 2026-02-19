import { useState, useRef, useEffect } from "react";
import { colors } from "../theme";
import { BOARD_TEMPLATES } from "../../shared/board-templates";
import "../styles/animations.css";

interface OnboardModalProps {
  onSubmit: (prompt: string) => void;
  onDismiss: () => void;
}

export function OnboardModal({ onSubmit, onDismiss }: OnboardModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value.trim().length > 0;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Escape key dismisses modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onDismiss]);

  function submit(): void {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div
      onClick={onDismiss}
      style={{
        position: "absolute", inset: 0, zIndex: 40,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
        animation: "cb-backdrop-in 0.3s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "calc(100vw - 48px)",
          background: "rgba(15, 23, 42, 0.97)",
          border: `1px solid ${colors.border}`,
          borderRadius: 20,
          padding: "2.5rem 2.5rem 2rem",
          boxShadow: `0 0 80px ${colors.accentGlow}, 0 16px 48px rgba(0,0,0,0.6)`,
          animation: "cb-overlay-in 0.4s ease-out both",
        }}
      >
        {/* Sparkle */}
        <div style={{
          textAlign: "center", marginBottom: 12,
          fontSize: "2.5rem", lineHeight: 1,
          animation: "cb-sparkle 3s ease-in-out infinite",
        }}>
          &#10024;
        </div>

        {/* Heading */}
        <div style={{
          textAlign: "center", marginBottom: 24,
          color: colors.text, fontSize: "1.375rem", fontWeight: 700,
          letterSpacing: "-0.01em",
        }}>
          What&apos;s the scene?
        </div>

        {/* Input row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key !== "Escape") e.stopPropagation();
            }}
            onKeyUp={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
            placeholder="A detective who solves crimes by smell..."
            style={{
              flex: 1, background: "rgba(30, 41, 59, 0.8)",
              border: `1px solid ${colors.border}`,
              borderRadius: 12, padding: "0.875rem 1rem",
              color: colors.text, fontSize: "0.9375rem",
              outline: "none", fontFamily: "inherit",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
          />
          <button
            onClick={submit}
            disabled={!hasValue}
            style={{
              background: hasValue ? colors.accent : colors.accentDark,
              border: "none", borderRadius: 12, color: "#fff",
              padding: "0 1.5rem", cursor: hasValue ? "pointer" : "default",
              fontSize: "0.9375rem", fontWeight: 600, flexShrink: 0,
              opacity: hasValue ? 1 : 0.5,
              transition: "opacity 0.2s, background 0.2s",
            }}
          >
            Go
          </button>
        </div>

        {/* Template chips */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8,
          justifyContent: "center",
        }}>
          {BOARD_TEMPLATES.map((chip, i) => (
            <button
              key={chip.label}
              onClick={() => { if (chip.prompt.trim()) onSubmit(chip.prompt); }}
              style={{
                background: "rgba(30, 41, 59, 0.6)",
                border: `1px solid ${colors.border}`,
                borderRadius: 20, padding: "8px 16px",
                color: colors.textMuted, fontSize: "0.8125rem",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                transition: "border-color 0.2s, color 0.2s, background 0.2s",
                animation: `cb-chip-in 0.3s ease-out ${0.15 + i * 0.04}s both`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.accent;
                e.currentTarget.style.color = colors.text;
                e.currentTarget.style.background = colors.accentSubtle;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textMuted;
                e.currentTarget.style.background = "rgba(30, 41, 59, 0.6)";
              }}
            >
              <span style={{ fontSize: "1rem" }}>{chip.icon}</span>
              {chip.label}
            </button>
          ))}
        </div>

        {/* Hint */}
        <div style={{
          textAlign: "center", marginTop: 20,
          color: colors.textSubtle, fontSize: "0.75rem",
        }}>
          or double-click the canvas to add props yourself
        </div>
      </div>
    </div>
  );
}
