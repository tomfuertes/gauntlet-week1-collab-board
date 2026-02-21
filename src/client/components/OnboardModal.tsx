import { useState, useRef, useEffect, useCallback } from "react";
import { colors } from "../theme";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { TextInput } from "./TextInput";
import { Select } from "./Select";
import { BOARD_TEMPLATES } from "../../shared/board-templates";
import { GAME_MODES, AI_MODELS, DEFAULT_PERSONAS } from "../../shared/types";
import type { GameMode, AIModel, Persona, TroupeConfig } from "../../shared/types";
import "../styles/animations.css";

interface OnboardModalProps {
  onSubmit: (
    prompt: string,
    gameMode: GameMode,
    aiModel: AIModel,
    personaId: string | null,
    templateId?: string,
    troupeConfig?: TroupeConfig,
  ) => void;
  onDismiss: () => void;
  personas?: Persona[];
}

// Wizard steps
type WizardStep = 0 | 1 | 2;
const STEP_LABELS = ["Build Your Troupe", "Invite Performers", "The Get"];

const MODEL_OPTIONS = AI_MODELS.map((m) => ({ value: m.id, label: m.label }));

// Default troupe: both personas enabled with the default model
function buildDefaultTroupeModels(personas: Persona[]): Map<string, AIModel> {
  const map = new Map<string, AIModel>();
  for (const p of personas) {
    map.set(p.id, "claude-haiku-4.5");
  }
  return map;
}

export function OnboardModal({ onSubmit, onDismiss, personas = [...DEFAULT_PERSONAS] }: OnboardModalProps) {
  const [step, setStep] = useState<WizardStep>(0);
  // troupeModels: personaId -> model (presence in map = member is in troupe)
  const [troupeModels, setTroupeModels] = useState<Map<string, AIModel>>(() => buildDefaultTroupeModels(personas));

  // Stage manager model - defaults to first troupe member's model
  const [stageManagerModel, setStageManagerModel] = useState<AIModel>("claude-haiku-4.5");

  // Step 2: The Get
  const [value, setValue] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("yesand");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value.trim().length > 0;

  // Focus input on step 2 (The Get)
  useEffect(() => {
    if (step === 2) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [step]);

  const canAdvanceFromStep0 = troupeModels.size >= 1;

  function toggleTroupeMember(personaId: string): void {
    setTroupeModels((prev) => {
      const next = new Map(prev);
      if (next.has(personaId)) {
        // Don't remove if it's the last member
        if (next.size === 1) return prev;
        next.delete(personaId);
      } else {
        next.set(personaId, "claude-haiku-4.5");
      }
      return next;
    });
  }

  function setMemberModel(personaId: string, model: AIModel): void {
    setTroupeModels((prev) => {
      const next = new Map(prev);
      if (next.has(personaId)) next.set(personaId, model);
      return next;
    });
  }

  // Build TroupeConfig from map
  const buildTroupeConfig = useCallback((): TroupeConfig => {
    const members = [...troupeModels.entries()].map(([personaId, model]) => ({ personaId, model }));
    return { members, stageManagerModel };
  }, [troupeModels, stageManagerModel]);

  function submit(templateId?: string): void {
    const troupeConfig = buildTroupeConfig();
    // Use first member's model as the Board-level aiModel for backward compat
    const primaryModel = troupeConfig.members[0]?.model ?? "claude-haiku-4.5";

    const trimmed = value.trim();
    if (trimmed || templateId) {
      onSubmit(
        templateId ? (BOARD_TEMPLATES.find((t) => t.id === templateId)?.displayText ?? trimmed) : trimmed,
        selectedMode,
        primaryModel,
        null,
        templateId,
        troupeConfig,
      );
    }
  }

  // ── Step indicator ──────────────────────────────────────────────────────────
  function StepIndicator() {
    return (
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 20 }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i === step ? colors.accent : i < step ? colors.accentLight : colors.border,
                transition: "background 0.2s",
              }}
            />
            <span
              style={{
                fontSize: "0.625rem",
                color: i === step ? colors.accentLight : colors.textSubtle,
                fontWeight: i === step ? 600 : 400,
                transition: "color 0.2s",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // ── Navigation row ──────────────────────────────────────────────────────────
  function NavRow() {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 20,
          gap: 8,
        }}
      >
        {step > 0 ? (
          <Button variant="secondary" onClick={() => setStep((s) => (s - 1) as WizardStep)} style={{ minWidth: 72 }}>
            Back
          </Button>
        ) : (
          <Button variant="secondary" onClick={onDismiss} style={{ minWidth: 72 }}>
            Skip
          </Button>
        )}

        {step < 2 ? (
          <Button
            variant="primary"
            onClick={() => setStep((s) => (s + 1) as WizardStep)}
            disabled={step === 0 && !canAdvanceFromStep0}
            style={{ background: colors.accent, minWidth: 88, fontWeight: 600 }}
          >
            {step === 1 ? "Next" : "Next →"}
          </Button>
        ) : null}
      </div>
    );
  }

  // ── Step 0: Build Your Troupe ───────────────────────────────────────────────
  function renderTroupeBuilder() {
    return (
      <>
        <div style={{ textAlign: "center", marginBottom: 6, fontSize: "2rem", lineHeight: 1 }}>🎭</div>
        <div
          style={{
            textAlign: "center",
            marginBottom: 8,
            color: colors.text,
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          Build Your Troupe
        </div>
        <div
          style={{
            textAlign: "center",
            marginBottom: 20,
            color: colors.textMuted,
            fontSize: "0.8125rem",
          }}
        >
          Pick your AI scene partners and assign each a model
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {personas.map((persona) => {
            const inTroupe = troupeModels.has(persona.id);
            const memberModel = troupeModels.get(persona.id) ?? "claude-haiku-4.5";
            return (
              <div
                key={persona.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `2px solid ${inTroupe ? persona.color : colors.border}`,
                  background: inTroupe ? `${persona.color}10` : "rgba(30, 41, 59, 0.5)",
                  transition: "border-color 0.2s, background 0.2s",
                  cursor: "pointer",
                }}
                onClick={() => toggleTroupeMember(persona.id)}
              >
                {/* Color indicator */}
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: persona.color,
                    flexShrink: 0,
                    opacity: inTroupe ? 1 : 0.35,
                  }}
                />
                {/* Name + trait */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "0.875rem",
                      color: inTroupe ? colors.text : colors.textMuted,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {persona.name}
                  </div>
                  <div
                    style={{
                      fontSize: "0.6875rem",
                      color: colors.textDim,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {persona.trait.split("\n")[0].replace(/^You are [A-Z]+ - /, "")}
                  </div>
                </div>
                {/* Model selector - only shown when in troupe; stop propagation so card toggle doesn't fire */}
                {inTroupe && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={memberModel}
                      onChange={(v) => setMemberModel(persona.id, v as AIModel)}
                      options={MODEL_OPTIONS}
                      style={{ minWidth: 130 }}
                    />
                  </div>
                )}
                {/* Checkmark / add icon */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: inTroupe ? persona.color : "transparent",
                    border: `2px solid ${inTroupe ? persona.color : colors.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: "0.65rem",
                    color: "#fff",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  {inTroupe ? "✓" : "+"}
                </div>
              </div>
            );
          })}
        </div>

        {/* Stage Manager model selector */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px solid ${colors.border}`,
            background: "rgba(30, 41, 59, 0.4)",
          }}
        >
          <div
            style={{
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: colors.text,
              letterSpacing: "0.04em",
            }}
          >
            Stage Manager Model
          </div>
          <Select
            value={stageManagerModel}
            onChange={(v) => setStageManagerModel(v as AIModel)}
            options={MODEL_OPTIONS}
            style={{ minWidth: "100%" }}
          />
        </div>

        {!canAdvanceFromStep0 && (
          <div
            style={{
              marginTop: 10,
              textAlign: "center",
              fontSize: "0.75rem",
              color: colors.warning,
            }}
          >
            Add at least one troupe member to continue
          </div>
        )}

        <NavRow />
      </>
    );
  }

  // ── Step 1: Invite Friends ──────────────────────────────────────────────────
  function renderInviteFriends() {
    const boardUrl = window.location.href;

    function copyLink() {
      navigator.clipboard.writeText(boardUrl).catch(() => {});
    }

    return (
      <>
        <div style={{ textAlign: "center", marginBottom: 6, fontSize: "2rem", lineHeight: 1 }}>🎟️</div>
        <div
          style={{
            textAlign: "center",
            marginBottom: 8,
            color: colors.text,
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          Invite Performers
        </div>
        <div
          style={{
            textAlign: "center",
            marginBottom: 20,
            color: colors.textMuted,
            fontSize: "0.8125rem",
          }}
        >
          Share this scene with collaborators - or fly solo
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(30, 41, 59, 0.6)",
            border: `1px solid ${colors.border}`,
            marginBottom: 16,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: "0.75rem",
              color: colors.textMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {boardUrl}
          </span>
          <Button
            variant="secondary"
            onClick={copyLink}
            style={{ fontSize: "0.75rem", padding: "4px 12px", flexShrink: 0 }}
          >
            Copy
          </Button>
        </div>

        {/* Skip is prominent - solo play is the primary flow */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <Button
            variant="primary"
            onClick={() => setStep(2)}
            style={{ background: colors.accent, fontWeight: 600, padding: "0.75rem 2.5rem" }}
          >
            Continue solo →
          </Button>
        </div>

        <NavRow />
      </>
    );
  }

  // ── Step 2: The Get ─────────────────────────────────────────────────────────
  function renderTheGet() {
    return (
      <>
        <div
          style={{
            textAlign: "center",
            marginBottom: 6,
            fontSize: "2rem",
            lineHeight: 1,
            animation: "cb-sparkle 3s ease-in-out infinite",
          }}
        >
          &#10024;
        </div>
        <div
          style={{
            textAlign: "center",
            marginBottom: 20,
            color: colors.text,
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          What&apos;s the scene?
        </div>

        {/* Game mode selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, justifyContent: "center" }}>
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
                <span
                  style={{
                    fontSize: "0.5625rem",
                    fontWeight: 600,
                    color: active ? colors.accentLight : colors.textSubtle,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  {gm.difficulty}
                </span>
              </button>
            );
          })}
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
            onClick={() => submit()}
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

        {/* Template chips - only shown for yesand (beginner) mode */}
        {selectedMode === "yesand" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {BOARD_TEMPLATES.map((chip, i) => (
              <button
                key={chip.id}
                onClick={() => submit(chip.id)}
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
        )}

        <NavRow />

        {/* Hint */}
        <div
          style={{
            textAlign: "center",
            marginTop: 12,
            color: colors.textSubtle,
            fontSize: "0.75rem",
          }}
        >
          or double-click the canvas to add props yourself
        </div>
      </>
    );
  }

  return (
    <Modal open onClose={onDismiss}>
      <StepIndicator />
      {step === 0 && renderTroupeBuilder()}
      {step === 1 && renderInviteFriends()}
      {step === 2 && renderTheGet()}
    </Modal>
  );
}
