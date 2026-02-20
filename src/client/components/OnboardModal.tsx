import { useState, useRef, useEffect } from "react";
import { colors } from "../theme";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { TextInput } from "./TextInput";
import { BOARD_TEMPLATES } from "../../shared/board-templates";
import { GAME_MODES, AI_MODELS, DEFAULT_PERSONAS } from "../../shared/types";
import type { GameMode, AIModel, Persona } from "../../shared/types";
import "../styles/animations.css";

interface OnboardModalProps {
  onSubmit: (
    prompt: string,
    gameMode: GameMode,
    aiModel: AIModel,
    personaId: string | null,
    templateId?: string,
  ) => void;
  onDismiss: () => void;
  personas?: Persona[];
}

export function OnboardModal({ onSubmit, onDismiss, personas = [...DEFAULT_PERSONAS] }: OnboardModalProps) {
  const [value, setValue] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("freeform");
  const [selectedModel, setSelectedModel] = useState<AIModel>("claude-haiku-4.5");
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value.trim().length > 0;
  const isHat = selectedMode === "hat";

  useEffect(() => {
    if (!isHat) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isHat]);

  function submit(): void {
    if (isHat) {
      onSubmit(
        "Start a Scenes From a Hat game. Draw the first prompt and set the scene.",
        "hat",
        selectedModel,
        selectedPersonaId,
      );
      return;
    }
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed, selectedMode, selectedModel, selectedPersonaId);
  }

  return (
    <Modal open onClose={onDismiss}>
      {/* Sparkle */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 12,
          fontSize: "2.5rem",
          lineHeight: 1,
          animation: "cb-sparkle 3s ease-in-out infinite",
        }}
      >
        &#10024;
      </div>

      {/* Heading */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 20,
          color: colors.text,
          fontSize: "1.375rem",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        What&apos;s the scene?
      </div>

      {/* Game mode selector */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          justifyContent: "center",
        }}
      >
        {GAME_MODES.map((gm) => {
          const active = selectedMode === gm.mode;
          return (
            <button
              key={gm.mode}
              onClick={() => setSelectedMode(gm.mode)}
              style={{
                flex: 1,
                background: active ? colors.accentSubtle : "rgba(30, 41, 59, 0.6)",
                border: `2px solid ${active ? colors.accent : colors.border}`,
                borderRadius: 12,
                padding: "12px 8px",
                color: active ? colors.text : colors.textMuted,
                fontSize: "0.8125rem",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                transition: "border-color 0.2s, color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = colors.accentLight;
                  e.currentTarget.style.color = colors.text;
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.color = colors.textMuted;
                }
              }}
            >
              <span style={{ fontSize: "1.5rem" }}>{gm.icon}</span>
              <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{gm.label}</span>
              <span style={{ fontSize: "0.6875rem", color: colors.textDim }}>{gm.description}</span>
            </button>
          );
        })}
      </div>

      {/* Character picker - "Pick your improv partner" */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: "0.75rem",
            color: colors.textMuted,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          Pick your improv partner
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {/* "Anyone" pill - null claim */}
          <button
            onClick={() => setSelectedPersonaId(null)}
            style={{
              background: selectedPersonaId === null ? colors.accentSubtle : "rgba(30, 41, 59, 0.6)",
              border: `2px solid ${selectedPersonaId === null ? colors.accent : colors.border}`,
              borderRadius: 20,
              padding: "6px 14px",
              color: selectedPersonaId === null ? colors.text : colors.textMuted,
              fontSize: "0.8125rem",
              cursor: "pointer",
              transition: "border-color 0.2s, color 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => {
              if (selectedPersonaId !== null) {
                e.currentTarget.style.borderColor = colors.accentLight;
                e.currentTarget.style.color = colors.text;
              }
            }}
            onMouseLeave={(e) => {
              if (selectedPersonaId !== null) {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.color = colors.textMuted;
              }
            }}
          >
            Anyone
          </button>
          {/* One pill per persona with colored border */}
          {personas.map((persona) => {
            const active = selectedPersonaId === persona.id;
            return (
              <button
                key={persona.id}
                onClick={() => setSelectedPersonaId(active ? null : persona.id)}
                style={{
                  background: active ? `${persona.color}18` : "rgba(30, 41, 59, 0.6)",
                  border: `2px solid ${active ? persona.color : colors.border}`,
                  borderRadius: 20,
                  padding: "6px 14px",
                  color: active ? colors.text : colors.textMuted,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  transition: "border-color 0.2s, color 0.2s, background 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = persona.color;
                    e.currentTarget.style.color = colors.text;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = colors.border;
                    e.currentTarget.style.color = colors.textMuted;
                  }
                }}
              >
                <span style={{ color: persona.color }}>&#9679;</span> {persona.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Model selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: "0.75rem", color: colors.textMuted }}>AI Model</span>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as AIModel)}
          style={{
            background: colors.overlayHeader,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.text,
            fontSize: "0.75rem",
            padding: "2px 8px",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Input row - hidden for hat mode (auto-submits with default prompt) */}
      {isHat ? (
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Button
            variant="primary"
            onClick={submit}
            style={{
              background: colors.accent,
              borderRadius: 12,
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
            }}
          >
            Draw from the hat
          </Button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <TextInput
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key !== "Escape") e.stopPropagation();
              }}
              onKeyUp={(e) => {
                if (e.key !== "Escape") e.stopPropagation();
              }}
              placeholder="A detective who solves crimes by smell..."
              style={{
                flex: 1,
                background: "rgba(30, 41, 59, 0.8)",
                borderRadius: 12,
                padding: "0.875rem 1rem",
                fontSize: "0.9375rem",
                fontFamily: "inherit",
                transition: "border-color 0.2s",
              }}
            />
            <Button
              variant="primary"
              onClick={submit}
              disabled={!hasValue}
              style={{
                background: hasValue ? colors.accent : colors.accentDark,
                borderRadius: 12,
                padding: "0 1.5rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                flexShrink: 0,
                transition: "opacity 0.2s, background 0.2s",
              }}
            >
              Go
            </Button>
          </div>

          {/* Template chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
            }}
          >
            {BOARD_TEMPLATES.map((chip, i) => (
              <button
                key={chip.id}
                onClick={() => {
                  onSubmit(chip.displayText, selectedMode, selectedModel, selectedPersonaId, chip.id);
                }}
                style={{
                  background: "rgba(30, 41, 59, 0.6)",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 20,
                  padding: "8px 16px",
                  color: colors.textMuted,
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
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
        </>
      )}

      {/* Hint */}
      <div
        style={{
          textAlign: "center",
          marginTop: 20,
          color: colors.textSubtle,
          fontSize: "0.75rem",
        }}
      >
        or double-click the canvas to add props yourself
      </div>
    </Modal>
  );
}
