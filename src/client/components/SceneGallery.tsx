import { useState, useEffect } from "react";
import { colors } from "../theme";

interface SceneMeta {
  id: string;
  name: string;
  creator: string;
  last_activity_at: string;
  eventCount: number;
}

function thumbnailGradient(name: string): string {
  const hash = name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 40%, 20%) 0%, hsl(${hue2}, 50%, 15%) 100%)`;
}

function SceneCard({ scene }: { scene: SceneMeta }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => { location.hash = `replay/${scene.id}`; }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.surface,
        border: `1px solid ${hovered ? colors.accentLight : colors.border}`,
        borderRadius: 8,
        cursor: "pointer",
        overflow: "hidden",
        transition: "border-color 0.15s, transform 0.15s",
        transform: hovered ? "translateY(-2px)" : "none",
      }}
    >
      {/* Thumbnail placeholder */}
      <div style={{
        height: 120,
        background: thumbnailGradient(scene.name),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}>
        <div style={{
          fontSize: "0.8rem",
          color: colors.textDim,
          opacity: 0.6,
          userSelect: "none",
        }}>
          {scene.eventCount} events
        </div>
        {/* Play overlay on hover */}
        {hovered && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: colors.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 20px ${colors.accentGlow}`,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
                <polygon points="6,3 18,10 6,17" />
              </svg>
            </div>
          </div>
        )}
      </div>
      {/* Card body */}
      <div style={{ padding: "0.75rem 1rem" }}>
        <div style={{
          fontWeight: 600,
          fontSize: "0.9rem",
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {scene.name}
        </div>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.75rem",
          color: colors.textDim,
        }}>
          <span>{scene.creator}</span>
          <span>{new Date(scene.last_activity_at + "Z").toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

export function SceneGallery({ onBack }: { onBack: () => void }) {
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/boards/public", { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<SceneMeta[]>;
      })
      .then(setScenes)
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error("[SceneGallery] fetch failed", err);
        setError(true);
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      {/* Header */}
      <div style={{
        height: 48, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem", background: colors.overlayHeader, borderBottom: `1px solid ${colors.border}`,
        fontSize: "0.875rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={onBack}
            style={{
              background: "none", border: "none", color: colors.accentLight,
              cursor: "pointer", fontSize: "0.875rem", padding: 0,
            }}
          >
            &larr; Back
          </button>
          <span style={{ fontWeight: 600 }}>Scene Gallery</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
        <p style={{ color: colors.textMuted, marginBottom: "1.5rem", fontSize: "0.875rem" }}>
          Watch replays of collaborative improv sessions
        </p>

        {loading ? (
          <p style={{ color: colors.textDim }}>Loading scenes...</p>
        ) : error ? (
          <div style={{
            textAlign: "center", padding: "3rem", color: colors.error,
            border: `1px dashed ${colors.borderLight}`, borderRadius: 8,
          }}>
            Failed to load scenes. Try refreshing the page.
          </div>
        ) : scenes.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "3rem", color: colors.textDim,
            border: `1px dashed ${colors.borderLight}`, borderRadius: 8,
          }}>
            No scenes yet. Create a board and start improvising!
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "1rem",
          }}>
            {scenes.map((scene) => (
              <SceneCard key={scene.id} scene={scene} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
