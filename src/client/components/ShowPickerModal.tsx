import { useState } from "react";
import { colors } from "../theme";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ShowPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Premise {
  id: string;
  title: string;
  description: string;
  emoji: string;
}

const PREMISES: Premise[] = [
  {
    id: "ghost-therapy",
    title: "Ghost Therapy",
    description: "A therapist discovers their patient is actually a ghost",
    emoji: "👻",
  },
  {
    id: "wrong-planet",
    title: "Wrong Planet",
    description: "Two astronauts realize they've been on the wrong planet for 6 months",
    emoji: "🪐",
  },
  {
    id: "medieval-office",
    title: "Medieval Office",
    description: "A medieval knight applies for a modern office job",
    emoji: "⚔️",
  },
  {
    id: "sentient-souffle",
    title: "Sentient Souffle",
    description: "A chef's souffle becomes sentient right before a Michelin judge arrives",
    emoji: "🍮",
  },
  {
    id: "library-rivals",
    title: "Library Rivals",
    description: "Two rival librarians compete for the last overdue book fine",
    emoji: "📚",
  },
  {
    id: "hoa-nemesis",
    title: "HOA Nemesis",
    description: "A superhero discovers their nemesis is their HOA president",
    emoji: "🦸",
  },
];

export function ShowPickerModal({ isOpen, onClose }: ShowPickerModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPremise = PREMISES.find((p) => p.id === selectedId) ?? null;

  function handleSurpriseMe() {
    const idx = Math.floor(Math.random() * PREMISES.length);
    setSelectedId(PREMISES[idx].id);
  }

  async function handleStartShow() {
    if (!selectedPremise) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ premise: selectedPremise.description }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        setError(`Failed to start show: ${res.status} ${text}`);
        return;
      }
      const { boardId } = (await res.json()) as { boardId: string };
      window.location.hash = "#watch/" + boardId;
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={isOpen} onClose={onClose} width={560}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 6, fontSize: "2rem", lineHeight: 1 }}>🎭</div>
      <div
        style={{
          textAlign: "center",
          marginBottom: 6,
          color: colors.text,
          fontSize: "1.375rem",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        Watch an AI Improv Show
      </div>
      <div
        style={{
          textAlign: "center",
          marginBottom: 24,
          color: colors.textMuted,
          fontSize: "0.8125rem",
        }}
      >
        Two AI performers improvise a scene based on your chosen premise
      </div>

      {/* Premise grid: 3x2 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {PREMISES.map((premise) => {
          const selected = premise.id === selectedId;
          return (
            <button
              key={premise.id}
              onClick={() => setSelectedId(premise.id)}
              style={{
                background: selected
                  ? `linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(99, 102, 241, 0.12) 100%)`
                  : "rgba(30, 41, 59, 0.6)",
                border: `2px solid ${selected ? colors.accent : colors.border}`,
                borderRadius: 12,
                padding: "12px 10px",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s, transform 0.1s",
                transform: selected ? "translateY(-1px)" : "none",
                boxShadow: selected ? `0 0 14px ${colors.accentGlow}` : "none",
              }}
              onMouseEnter={(e) => {
                if (!selected) {
                  e.currentTarget.style.borderColor = colors.accentLight;
                  e.currentTarget.style.background = "rgba(30, 41, 59, 0.85)";
                }
              }}
              onMouseLeave={(e) => {
                if (!selected) {
                  e.currentTarget.style.borderColor = colors.border;
                  e.currentTarget.style.background = "rgba(30, 41, 59, 0.6)";
                }
              }}
            >
              <div style={{ fontSize: "1.5rem", marginBottom: 6, lineHeight: 1 }}>{premise.emoji}</div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "0.8125rem",
                  color: selected ? colors.text : colors.textMuted,
                  marginBottom: 4,
                  letterSpacing: "0.02em",
                  lineHeight: 1.2,
                }}
              >
                {premise.title}
              </div>
              <div
                style={{
                  fontSize: "0.6875rem",
                  color: selected ? colors.textMuted : colors.textSubtle,
                  lineHeight: 1.4,
                }}
              >
                {premise.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Surprise Me */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <Button variant="link" onClick={handleSurpriseMe} style={{ color: colors.accentLight, fontSize: "0.8125rem" }}>
          🎲 Surprise Me
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(248, 113, 113, 0.1)",
            border: `1px solid rgba(248, 113, 113, 0.3)`,
            color: colors.error,
            fontSize: "0.8125rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Start Show button */}
      <Button
        variant="primary"
        onClick={() => void handleStartShow()}
        disabled={!selectedPremise || loading}
        style={{
          width: "100%",
          padding: "0.875rem",
          borderRadius: 10,
          fontSize: "1rem",
          fontWeight: 700,
          background:
            selectedPremise && !loading
              ? `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentDark} 100%)`
              : colors.accentDark,
          boxShadow: selectedPremise && !loading ? `0 0 20px ${colors.accentGlow}` : "none",
          transition: "box-shadow 0.2s, background 0.2s",
          letterSpacing: "0.02em",
        }}
      >
        {loading
          ? "Starting Show..."
          : selectedPremise
            ? `🎬 Start Show - ${selectedPremise.title}`
            : "Select a Premise to Start"}
      </Button>
    </Modal>
  );
}
