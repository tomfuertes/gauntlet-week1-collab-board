import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "../App";
import type { DailyChallenge } from "../../shared/types";
import { BOARD_TEMPLATES } from "../../shared/board-templates";
import { colors } from "../theme";
import { Button } from "./Button";

interface BoardMeta {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  unseen_count: number;
}

interface SceneMeta {
  id: string;
  name: string;
  game_mode?: string;
  creator: string;
  last_activity_at: string;
  eventCount: number;
  critic_score?: number | null;
  critic_review?: string | null;
  avg_rating?: number | null;
  rating_count?: number | null;
}

const MODE_BADGES: Record<string, { icon: string; label: string }> = {
  hat: { icon: "\uD83C\uDFA9", label: "Hat" },
  yesand: { icon: "\uD83D\uDD17", label: "Yes-And" },
};

function thumbnailGradient(name: string): string {
  const hash = name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 40%, 20%) 0%, hsl(${hue2}, 50%, 15%) 100%)`;
}

function StarRating({ score }: { score: number }) {
  return (
    <div style={{ display: "flex", gap: 1, color: "#fbbf24", fontSize: "0.75rem", letterSpacing: "-1px" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i}>{i <= score ? "\u2605" : "\u2606"}</span>
      ))}
    </div>
  );
}

function SceneCard({ scene }: { scene: SceneMeta }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => {
        location.hash = `replay/${scene.id}`;
      }}
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
      <div
        style={{
          height: 120,
          background: thumbnailGradient(scene.name),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: "0.8rem",
            color: colors.textDim,
            opacity: 0.6,
            userSelect: "none",
          }}
        >
          {scene.eventCount} events
        </div>
        {/* Critic star rating badge - top left */}
        {scene.critic_score != null && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              background: "rgba(0,0,0,0.65)",
              borderRadius: 6,
              padding: "2px 6px",
            }}
          >
            <StarRating score={scene.critic_score} />
          </div>
        )}
        {/* Audience avg_rating badge - bottom left of thumbnail (shown when no critic score or as supplement) */}
        {scene.avg_rating != null && scene.critic_score == null && (
          <div
            title={`${scene.rating_count ?? 0} audience rating${(scene.rating_count ?? 0) !== 1 ? "s" : ""}`}
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              background: "rgba(0,0,0,0.65)",
              borderRadius: 6,
              padding: "2px 6px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.65rem",
              color: "#fbbf24",
            }}
          >
            ★ {scene.avg_rating.toFixed(1)}
            {scene.rating_count != null && (
              <span style={{ color: "rgba(255,255,255,0.45)" }}>({scene.rating_count})</span>
            )}
          </div>
        )}
        {scene.game_mode && MODE_BADGES[scene.game_mode] && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "rgba(0,0,0,0.6)",
              borderRadius: 6,
              padding: "2px 6px",
              fontSize: "0.6875rem",
              color: colors.textMuted,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span>{MODE_BADGES[scene.game_mode].icon}</span>
            {MODE_BADGES[scene.game_mode].label}
          </div>
        )}
        {/* Play overlay on hover */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: colors.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 0 20px ${colors.accentGlow}`,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
                <polygon points="6,3 18,10 6,17" />
              </svg>
            </div>
          </div>
        )}
      </div>
      {/* Card body */}
      <div style={{ padding: "0.75rem 1rem" }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.9rem",
            marginBottom: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {scene.name}
        </div>
        {/* Critic review text */}
        {scene.critic_review && (
          <div
            title={scene.critic_review}
            style={{
              fontSize: "0.75rem",
              color: colors.textDim,
              fontStyle: "italic",
              marginBottom: 6,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            &ldquo;{scene.critic_review}&rdquo;
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.75rem",
            color: colors.textDim,
          }}
        >
          <span>{scene.creator}</span>
          <span>
            {(() => {
              // last_activity_at is a D1 datetime string (no timezone suffix); append Z for UTC
              // COALESCE on the server ensures non-null, but guard here for belt-and-suspenders
              const d = scene.last_activity_at ? new Date(scene.last_activity_at + "Z") : null;
              return d && !isNaN(d.getTime()) ? d.toLocaleDateString() : "";
            })()}
          </span>
        </div>
      </div>
    </div>
  );
}

export function BoardList({
  user,
  onSelectBoard,
  onLogout,
}: {
  user: AuthUser;
  onSelectBoard: (id: string) => void;
  onLogout: () => void;
}) {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  const [enteringChallenge, setEnteringChallenge] = useState(false);
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [scenesLoading, setScenesLoading] = useState(true);
  const [scenesError, setScenesError] = useState(false);
  const [sceneSort, setSceneSort] = useState<"recent" | "top" | "low">("recent");

  const fetchBoards = useCallback((signal?: AbortSignal) => {
    return fetch("/api/boards", { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<BoardMeta[]>;
      })
      .then(setBoards)
      .catch(() => {
        // Only reset to empty on initial load (loading=true); preserve stale data on poll failures
        if (!signal?.aborted) setBoards((prev) => (prev.length ? prev : []));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchBoards(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    // Poll every 30s for activity badges
    const interval = setInterval(() => fetchBoards(), 30_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchBoards]);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/challenges/today", { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DailyChallenge>) : Promise.reject(r.status)))
      .then(setChallenge)
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(JSON.stringify({ event: "challenge:today:fetch:error", error: String(err) }));
      })
      .finally(() => {
        if (!ac.signal.aborted) setChallengeLoading(false);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setScenesLoading(true);
    setScenesError(false);
    const url = sceneSort === "top" ? "/api/boards/public?sort=score" : "/api/boards/public";
    fetch(url, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<SceneMeta[]>;
      })
      .then((data) => {
        // Client-side sort for "Lowest Rated" (ascending score, scored scenes first)
        if (sceneSort === "low") {
          data = [...data].sort((a, b) => {
            if (a.critic_score == null && b.critic_score == null) return 0;
            if (a.critic_score == null) return 1;
            if (b.critic_score == null) return -1;
            return a.critic_score - b.critic_score;
          });
        }
        setScenes(data);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        console.error(JSON.stringify({ event: "community:scenes:fetch:error", error: String(err) }));
        setScenesError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setScenesLoading(false);
      });
    return () => ac.abort();
  }, [sceneSort]);

  const handleAcceptChallenge = async () => {
    if (!challenge) return;
    setEnteringChallenge(true);
    try {
      const res = await fetch(`/api/challenges/${challenge.id}/enter`, { method: "POST" });
      if (!res.ok) {
        console.error(JSON.stringify({ event: "challenge:enter:error", status: res.status }));
        return;
      }
      const { boardId } = (await res.json()) as { boardId: string };
      onSelectBoard(boardId);
    } catch (err) {
      console.error(JSON.stringify({ event: "challenge:enter:fetch:error", error: String(err) }));
    } finally {
      setEnteringChallenge(false);
    }
  };

  const handleCreate = async () => {
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const { id, name } = (await res.json()) as { id: string; name: string };
      // Optimistic update - avoids D1 read replication lag on re-fetch
      const now = new Date().toISOString().replace("T", " ").split(".")[0];
      setBoards((prev) => [
        {
          id,
          name,
          created_by: user.id,
          created_at: now,
          updated_at: now,
          unseen_count: 0,
        },
        ...prev,
      ]);
      onSelectBoard(id);
    }
  };

  const handleDelete = async (e: React.MouseEvent, boardId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this board? This cannot be undone.")) return;
    const res = await fetch(`/api/boards/${boardId}`, { method: "DELETE" });
    if (res.ok) {
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    }
  };

  const handleLogout = async () => {
    await fetch("/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      {/* Header */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          background: colors.overlayHeader,
          borderBottom: `1px solid ${colors.border}`,
          fontSize: "0.875rem",
        }}
      >
        <span style={{ fontWeight: 600 }}>YesAInd</span>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Button
            onClick={() => {
              location.hash = "challenge";
            }}
            style={{ color: colors.warning }}
          >
            Daily Challenge
          </Button>
          <span>{user.displayName}</span>
          <Button onClick={handleLogout}>Logout</Button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
        {/* Daily Challenge card */}
        {!challengeLoading && challenge && (
          <div
            style={{
              background: `linear-gradient(135deg, rgba(250, 204, 21, 0.08) 0%, rgba(251, 146, 60, 0.08) 100%)`,
              border: `1px solid rgba(250, 204, 21, 0.3)`,
              borderRadius: 8,
              padding: "1.25rem 1.5rem",
              marginBottom: "1.5rem",
            }}
          >
            {/* Top row: label + engagement badges */}
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: 6 }}>
              <span style={{ fontSize: "1rem" }}>🎩</span>
              <span style={{ fontWeight: 700, color: colors.warning, fontSize: "0.875rem", letterSpacing: "0.05em" }}>
                TODAY'S DAILY CHALLENGE
              </span>

              {/* Streak badge - only shown when user has an active streak */}
              {(challenge.streak ?? 0) > 0 && (
                <span
                  style={{
                    // KEY-DECISION 2026-02-20: warm gradient (not solid) keeps badge from looking like a button
                    background: "linear-gradient(135deg, rgba(251, 146, 60, 0.3), rgba(239, 68, 68, 0.25))",
                    border: "1px solid rgba(251, 146, 60, 0.5)",
                    borderRadius: 12,
                    padding: "1px 8px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#fb923c",
                  }}
                >
                  🔥 {challenge.streak} day streak!
                </span>
              )}

              {/* Personal best badge - gold star, only when user has a scored attempt */}
              {challenge.bestScore != null && (
                <span
                  style={{
                    background: "rgba(251, 191, 36, 0.15)",
                    border: "1px solid rgba(251, 191, 36, 0.4)",
                    borderRadius: 12,
                    padding: "1px 8px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#fbbf24",
                  }}
                >
                  ★ Best: {challenge.bestScore}/5
                </span>
              )}
            </div>

            {/* Prompt text */}
            <div style={{ fontSize: "1rem", fontWeight: 600, color: colors.text, marginBottom: 8 }}>
              {challenge.prompt}
            </div>

            {/* Template preview hint */}
            {challenge.templateId &&
              (() => {
                const tpl = BOARD_TEMPLATES.find((t) => t.id === challenge.templateId);
                return tpl ? (
                  <div style={{ fontSize: "0.75rem", color: colors.textMuted, marginBottom: 10 }}>
                    {tpl.icon} Starter template: <em>{tpl.label}</em>
                  </div>
                ) : null;
              })()}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <Button
                variant="link"
                onClick={() => {
                  location.hash = "challenge";
                }}
                style={{ color: colors.textMuted, fontSize: "0.8125rem" }}
              >
                Leaderboard
              </Button>
              {challenge.userBoardId ? (
                <Button
                  onClick={() => onSelectBoard(challenge.userBoardId!)}
                  style={{ background: colors.success, color: "#000", fontWeight: 600 }}
                >
                  Continue Your Scene
                </Button>
              ) : (
                <Button
                  onClick={handleAcceptChallenge}
                  style={{ background: colors.warning, color: "#000", fontWeight: 700 }}
                >
                  {enteringChallenge ? "Starting..." : "Accept Challenge"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Create New Board - prominent, full-width, above the board grid */}
        <Button
          variant="primary"
          onClick={handleCreate}
          style={{
            width: "100%",
            padding: "0.875rem",
            marginBottom: "2rem",
            borderRadius: 8,
            fontSize: "1rem",
            fontWeight: 600,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          + Create New Board
        </Button>

        {/* Your Boards section */}
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>Your Boards</h2>

        {loading ? (
          <p style={{ color: colors.textDim }}>Loading boards...</p>
        ) : boards.length === 0 ? (
          <p style={{ color: colors.textDim, marginBottom: "2rem" }}>No boards yet - create one above!</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "1rem",
              marginBottom: "2rem",
            }}
          >
            {boards.map((board) => (
              <div
                key={board.id}
                onClick={() => onSelectBoard(board.id)}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: "1.5rem",
                  cursor: "pointer",
                  minHeight: 120,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  transition: "border-color 0.15s",
                  position: "relative",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.accentLight)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.border)}
              >
                {/* Unseen activity badge */}
                {board.unseen_count > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      background: colors.accent,
                      color: "#fff",
                      borderRadius: 10,
                      minWidth: 20,
                      height: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "0 5px",
                      boxShadow: `0 0 8px ${colors.accentGlow}`,
                    }}
                  >
                    {board.unseen_count > 99 ? "99+" : board.unseen_count}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{board.name}</div>
                  <div style={{ fontSize: "0.75rem", color: colors.textDim }}>
                    {new Date(board.updated_at + "Z").toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="danger"
                  onClick={(e) => handleDelete(e, board.id)}
                  style={{ alignSelf: "flex-end", fontSize: "0.7rem", padding: "0.2rem 0.5rem", marginTop: 8 }}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Community Scenes section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Community Scenes</h2>
          <select
            value={sceneSort}
            onChange={(e) => setSceneSort(e.target.value as "recent" | "top" | "low")}
            style={{
              background: colors.surface,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: "0.25rem 0.5rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            <option value="recent">Recent</option>
            <option value="top">Top Rated</option>
            <option value="low">Lowest Rated</option>
          </select>
        </div>
        <p style={{ color: colors.textMuted, marginBottom: "1rem", fontSize: "0.875rem" }}>
          Watch replays of collaborative improv sessions
        </p>

        {scenesLoading ? (
          <p style={{ color: colors.textDim }}>Loading scenes...</p>
        ) : scenesError ? (
          <div
            style={{
              textAlign: "center",
              padding: "3rem",
              color: colors.error,
              border: `1px dashed ${colors.borderLight}`,
              borderRadius: 8,
            }}
          >
            Failed to load community scenes. Try refreshing the page.
          </div>
        ) : scenes.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "3rem",
              color: colors.textDim,
              border: `1px dashed ${colors.borderLight}`,
              borderRadius: 8,
            }}
          >
            No scenes yet. Create a board and start improvising!
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "1rem",
            }}
          >
            {scenes.map((scene) => (
              <SceneCard key={scene.id} scene={scene} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
