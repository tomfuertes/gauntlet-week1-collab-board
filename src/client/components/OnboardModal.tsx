import { useState, useRef, useEffect } from "react";
import { colors } from "../theme";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { TextInput } from "./TextInput";
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

  function submit(): void {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <Modal open onClose={onDismiss}>
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
        <TextInput
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
            borderRadius: 12, padding: "0.875rem 1rem",
            fontSize: "0.9375rem", fontFamily: "inherit",
            transition: "border-color 0.2s",
          }}
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={!hasValue}
          style={{
            background: hasValue ? colors.accent : colors.accentDark,
            borderRadius: 12, padding: "0 1.5rem",
            fontSize: "0.9375rem", fontWeight: 600, flexShrink: 0,
            transition: "opacity 0.2s, background 0.2s",
          }}
        >
          Go
        </Button>
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
    </Modal>
  );
}
