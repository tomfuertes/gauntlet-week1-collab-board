import { useState, useEffect } from "react";
import { colors } from "../theme";

interface GalleryBoard {
  id: string;
  name: string;
  game_mode?: string;
  creator: string;
  last_activity_at: string;
  eventCount: number;
  critic_review: string | null;
  critic_score: number | null;
  avg_rating: number | null;
  rating_count: number | null;
}

interface SceneGalleryProps {
  onBack: () => void;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span style={{ color: colors.warning, fontSize: "0.8rem" }}>
      {"★".repeat(Math.round(rating))}
      {"☆".repeat(5 - Math.round(rating))}
      <span style={{ color: colors.textSubtle, marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

export function SceneGallery({ onBack }: SceneGalleryProps) {
  const [boards, setBoards] = useState<GalleryBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"recent" | "score">("recent");

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetch(`/api/boards/public${sort === "score" ? "?sort=score" : ""}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GalleryBoard[]>;
      })
      .then((data) => {
        setBoards(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [sort]);

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      {/* Curtain accent bar */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${colors.accentDark}, ${colors.accent}, ${colors.accentLight}, #c084fc, ${colors.accentLight}, ${colors.accent}, ${colors.accentDark})`,
        }}
      />

      {/* Header */}
      <header
        style={{
          padding: "1rem 2rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            color: colors.accentLight,
            fontSize: "0.875rem",
            cursor: "pointer",
            padding: "4px 8px",
          }}
        >
          &larr; Back
        </button>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, flex: 1 }}>Scene Gallery</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["recent", "score"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{
                background: sort === s ? colors.accent : colors.surface,
                color: sort === s ? "#fff" : colors.textMuted,
                border: `1px solid ${sort === s ? colors.accent : colors.border}`,
                borderRadius: 6,
                padding: "4px 12px",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              {s === "recent" ? "Recent" : "Top Rated"}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
        {loading && (
          <p style={{ color: colors.textMuted, textAlign: "center", marginTop: "4rem" }}>Loading scenes...</p>
        )}
        {error && (
          <p style={{ color: colors.error, textAlign: "center", marginTop: "4rem" }}>Failed to load gallery: {error}</p>
        )}
        {!loading && !error && boards.length === 0 && (
          <p style={{ color: colors.textMuted, textAlign: "center", marginTop: "4rem" }}>
            No public scenes yet. Be the first to improvise!
          </p>
        )}
        {!loading && !error && boards.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "1rem",
            }}
          >
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => {
                  location.hash = `replay/${board.id}`;
                }}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: "1.25rem",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 0.15s",
                  color: colors.text,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.3 }}>{board.name}</span>
                  {board.game_mode && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        background: colors.accentSubtle,
                        color: colors.accentLight,
                        borderRadius: 4,
                        padding: "2px 6px",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {board.game_mode}
                    </span>
                  )}
                </div>

                <span style={{ fontSize: "0.8rem", color: colors.textMuted }}>by {board.creator}</span>

                {board.avg_rating !== null && board.avg_rating > 0 && <StarRating rating={board.avg_rating} />}

                {board.critic_score !== null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        background: colors.accentSubtle,
                        color: colors.accentLight,
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontWeight: 600,
                      }}
                    >
                      Critic {board.critic_score}/10
                    </span>
                  </div>
                )}

                {board.critic_review && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.78rem",
                      color: colors.textMuted,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    &ldquo;{board.critic_review}&rdquo;
                  </p>
                )}

                <span style={{ fontSize: "0.72rem", color: colors.textSubtle, marginTop: "auto" }}>
                  {board.eventCount} moves &middot; Watch replay
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
